from __future__ import annotations

from pathlib import Path

from django.conf import settings

from .models import ModelRegistry


def model_root() -> Path:
    root = Path(settings.TTD_MODEL_DIR).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def file_size_label(path: str | Path) -> str:
    try:
        size = Path(path).stat().st_size
    except OSError:
        return "-"
    gb = size / (1024**3)
    if gb >= 1:
        return f"{gb:.2f}GB"
    return f"{size / (1024**2):.1f}MB"


def infer_quantization(filename: str) -> str:
    upper = filename.upper()
    for marker in ("Q8_0", "Q6_K", "Q5_K_M", "Q5_K_S", "Q4_K_M", "Q4_K_S", "Q3_K_M", "Q2_K", "F16"):
        if marker in upper:
            return marker
    return "Q4_K_M"


def infer_model_type(filename: str) -> str:
    lower = filename.lower()
    if any(marker in lower for marker in ("coder", "code", "programming")):
        return "code"
    if any(marker in lower for marker in ("vision", "vl", "clip", "siglip", "flux", "sdxl", "diffusion")):
        return "vision"
    return "text"


def local_model_files() -> list[Path]:
    root = model_root()
    return sorted(path.resolve() for path in root.glob("**/*.gguf") if path.is_file())


def path_inside_model_root(path: Path) -> bool:
    root = model_root()
    resolved = path.expanduser().resolve()
    return resolved == root or root in resolved.parents


def delete_local_model_file(local_path: str) -> bool:
    if not local_path:
        return False

    try:
        candidate = Path(local_path).expanduser()
        if not candidate.is_absolute():
            candidate = model_root() / candidate
        candidate = candidate.resolve()
    except OSError:
        return False

    if not path_inside_model_root(candidate) or not candidate.is_file():
        return False

    try:
        candidate.unlink()
    except OSError:
        return False

    parent = candidate.parent
    root = model_root()
    while parent != root and root in parent.parents:
        try:
            parent.rmdir()
        except OSError:
            break
        parent = parent.parent
    return True


def _path_for_model(model: ModelRegistry, existing_files: list[Path]) -> Path | None:
    if model.local_path:
        try:
            path = Path(model.local_path).expanduser().resolve()
            if path in existing_files:
                return path
        except OSError:
            return None

    filename = Path(model.filename).name if model.filename else ""
    if filename:
        for path in existing_files:
            if path.name == filename:
                return path
    return None


def _relative_filename(path: Path) -> str:
    try:
        return str(path.relative_to(model_root()))
    except ValueError:
        return path.name


def sync_model_registry_with_files() -> list[ModelRegistry]:
    files = local_model_files()
    known_paths: set[Path] = set()

    for model in list(ModelRegistry.objects.all()):
        path = _path_for_model(model, files)
        if not path:
            model.delete()
            continue
        if path in known_paths:
            model.delete()
            continue

        known_paths.add(path)
        updates: list[str] = []
        if model.local_path != str(path):
            model.local_path = str(path)
            updates.append("local_path")
        if model.status != "ready":
            model.status = "ready"
            updates.append("status")
        size = file_size_label(path)
        if model.size != size:
            model.size = size
            updates.append("size")
        if model.download_progress != 100:
            model.download_progress = 100
            updates.append("download_progress")
        if not model.filename:
            model.filename = _relative_filename(path)
            updates.append("filename")
        if not model.quantization or model.quantization == "-":
            model.quantization = infer_quantization(path.name)
            updates.append("quantization")
        if updates:
            updates.append("updated_at")
            model.save(update_fields=updates)

    for path in files:
        if path in known_paths:
            continue
        ModelRegistry.objects.create(
            name=path.stem,
            repo_id="local",
            filename=_relative_filename(path),
            model_type=infer_model_type(path.name),
            size=file_size_label(path),
            status="ready",
            vram="-",
            selected=False,
            hidden=False,
            system_prompt="",
            quantization=infer_quantization(path.name),
            download_progress=100,
            local_path=str(path),
        )

    ready_models = list(ModelRegistry.objects.filter(status="ready").order_by("-selected", "hidden", "name"))
    selected = [model for model in ready_models if model.selected]
    if len(selected) > 1:
        keep = selected[0]
        ModelRegistry.objects.filter(selected=True).exclude(id=keep.id).update(selected=False)
        for model in ready_models:
            model.selected = model.id == keep.id
    elif not selected and ready_models:
        ready_models[0].selected = True
        ready_models[0].save(update_fields=["selected", "updated_at"])

    return list(ModelRegistry.objects.filter(status="ready").order_by("-selected", "hidden", "name"))
