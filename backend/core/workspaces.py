from __future__ import annotations

import difflib
import shutil
import time
import zipfile
from pathlib import Path, PurePosixPath
from uuid import UUID

from django.conf import settings


IGNORED_DIR_NAMES = {
    ".git",
    ".mypy_cache",
    ".next",
    ".pending",
    ".pytest_cache",
    ".ruff_cache",
    ".versions",
    "__pycache__",
    "node_modules",
}
IGNORED_FILE_NAMES = {".DS_Store"}
IGNORED_FILE_SUFFIXES = {".pyc", ".pyo"}


def workspace_root(chat_id: str | UUID) -> Path:
    root = Path(settings.TTD_GENERATED_DIR) / "workspaces" / str(chat_id)
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def workspace_versions_root(chat_id: str | UUID) -> Path:
    root = workspace_root(chat_id) / ".versions"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def workspace_pending_root(chat_id: str | UUID) -> Path:
    root = workspace_root(chat_id) / ".pending"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def safe_relative_path(value: str) -> Path:
    if not value or not value.strip():
        raise ValueError("path is required")
    relative = PurePosixPath(value.strip().replace("\\", "/"))
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("unsafe path")
    if any(not part for part in relative.parts):
        raise ValueError("unsafe path")
    return Path(*relative.parts)


def is_ignored_workspace_path(relative_path: Path) -> bool:
    parts = relative_path.parts
    if any(part in IGNORED_DIR_NAMES for part in parts):
        return True
    return relative_path.name in IGNORED_FILE_NAMES or relative_path.suffix in IGNORED_FILE_SUFFIXES


def safe_workspace_path(chat_id: str | UUID, relative_path: str) -> Path:
    root = workspace_root(chat_id)
    rel = safe_relative_path(relative_path)
    if is_ignored_workspace_path(rel):
        raise ValueError("workspace internals are not exposed")
    path = (root / rel).resolve()
    if path != root and root not in path.parents:
        raise ValueError("unsafe path")
    return path


def _version_dir(chat_id: str | UUID, relative_path: str) -> Path:
    rel = safe_relative_path(relative_path)
    version_dir = workspace_versions_root(chat_id) / rel
    version_dir.mkdir(parents=True, exist_ok=True)
    return version_dir


def save_version(chat_id: str | UUID, relative_path: str, path: Path) -> Path | None:
    if not path.is_file():
        return None
    version = _version_dir(chat_id, relative_path) / f"{int(time.time() * 1000)}.bak"
    shutil.copy2(path, version)
    return version


def write_workspace_file(chat_id: str | UUID, relative_path: str, content: str) -> Path:
    encoded = content.encode("utf-8")
    if settings.TTD_WORKSPACE_MAX_FILE_BYTES > 0 and len(encoded) > settings.TTD_WORKSPACE_MAX_FILE_BYTES:
        raise ValueError(f"file is too large ({len(encoded)} bytes)")
    path = safe_workspace_path(chat_id, relative_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    save_version(chat_id, relative_path, path)
    path.write_text(content, encoding="utf-8")
    return path


def safe_pending_path(chat_id: str | UUID, relative_path: str) -> Path:
    root = workspace_pending_root(chat_id)
    rel = safe_relative_path(relative_path)
    if is_ignored_workspace_path(rel):
        raise ValueError("workspace internals are not exposed")
    path = (root / rel).resolve()
    if path != root and root not in path.parents:
        raise ValueError("unsafe path")
    return path


def stage_workspace_file(chat_id: str | UUID, relative_path: str, content: str) -> Path:
    encoded = content.encode("utf-8")
    if settings.TTD_WORKSPACE_MAX_FILE_BYTES > 0 and len(encoded) > settings.TTD_WORKSPACE_MAX_FILE_BYTES:
        raise ValueError(f"file is too large ({len(encoded)} bytes)")
    path = safe_pending_path(chat_id, relative_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def read_workspace_file(chat_id: str | UUID, relative_path: str) -> dict:
    path = safe_workspace_path(chat_id, relative_path)
    if not path.is_file():
        raise FileNotFoundError(relative_path)
    size = path.stat().st_size
    if settings.TTD_WORKSPACE_MAX_FILE_BYTES > 0 and size > settings.TTD_WORKSPACE_MAX_FILE_BYTES:
        raise ValueError("file is too large to preview")
    return {
        "path": str(safe_relative_path(relative_path)),
        "name": path.name,
        "size": size,
        "content": path.read_text(encoding="utf-8", errors="replace"),
        "updatedAt": int(path.stat().st_mtime),
    }


def read_pending_workspace_file(chat_id: str | UUID, relative_path: str) -> dict:
    path = safe_pending_path(chat_id, relative_path)
    if not path.is_file():
        raise FileNotFoundError(relative_path)
    size = path.stat().st_size
    if settings.TTD_WORKSPACE_MAX_FILE_BYTES > 0 and size > settings.TTD_WORKSPACE_MAX_FILE_BYTES:
        raise ValueError("file is too large to preview")
    return {
        "path": str(safe_relative_path(relative_path)),
        "name": path.name,
        "size": size,
        "content": path.read_text(encoding="utf-8", errors="replace"),
        "updatedAt": int(path.stat().st_mtime),
    }


def list_workspace_tree(chat_id: str | UUID) -> dict:
    root = workspace_root(chat_id)
    files = []
    dirs = set()
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if is_ignored_workspace_path(rel):
            continue
        if path.is_dir():
            dirs.add(rel.as_posix())
            continue
        parent = rel.parent.as_posix()
        if parent != ".":
            dirs.add(parent)
        files.append(
            {
                "path": rel.as_posix(),
                "name": path.name,
                "type": "file",
                "size": path.stat().st_size,
                "updatedAt": int(path.stat().st_mtime),
            }
        )
    return {
        "root": str(root),
        "directories": sorted(dirs),
        "files": files,
        "pendingChanges": list_pending_changes(chat_id),
        "fileCount": len(files),
    }


def latest_version(chat_id: str | UUID, relative_path: str) -> Path | None:
    version_dir = _version_dir(chat_id, relative_path)
    versions = sorted(path for path in version_dir.glob("*.bak") if path.is_file())
    return versions[-1] if versions else None


def diff_workspace_file(chat_id: str | UUID, relative_path: str) -> dict:
    current = safe_workspace_path(chat_id, relative_path)
    if not current.is_file():
        raise FileNotFoundError(relative_path)
    previous = latest_version(chat_id, relative_path)
    if not previous:
        return {"path": str(safe_relative_path(relative_path)), "hasPrevious": False, "diff": ""}
    old = previous.read_text(encoding="utf-8", errors="replace").splitlines()
    new = current.read_text(encoding="utf-8", errors="replace").splitlines()
    diff = "\n".join(
        difflib.unified_diff(
            old,
            new,
            fromfile=f"{relative_path}@previous",
            tofile=relative_path,
            lineterm="",
        )
    )
    return {"path": str(safe_relative_path(relative_path)), "hasPrevious": True, "diff": diff}


def list_pending_changes(chat_id: str | UUID) -> list[dict]:
    root = workspace_pending_root(chat_id)
    changes = []
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if is_ignored_workspace_path(rel) or path.is_dir():
            continue
        active = safe_workspace_path(chat_id, rel.as_posix())
        changes.append(
            {
                "path": rel.as_posix(),
                "name": path.name,
                "type": "pending",
                "size": path.stat().st_size,
                "updatedAt": int(path.stat().st_mtime),
                "changeType": "modify" if active.is_file() else "create",
            }
        )
    return changes


def diff_pending_workspace_file(chat_id: str | UUID, relative_path: str) -> dict:
    pending = safe_pending_path(chat_id, relative_path)
    if not pending.is_file():
        raise FileNotFoundError(relative_path)
    current = safe_workspace_path(chat_id, relative_path)
    old = current.read_text(encoding="utf-8", errors="replace").splitlines() if current.is_file() else []
    new = pending.read_text(encoding="utf-8", errors="replace").splitlines()
    diff = "\n".join(
        difflib.unified_diff(
            old,
            new,
            fromfile=f"{relative_path}@current",
            tofile=f"{relative_path}@pending",
            lineterm="",
        )
    )
    return {
        "path": str(safe_relative_path(relative_path)),
        "hasPrevious": current.is_file(),
        "changeType": "modify" if current.is_file() else "create",
        "diff": diff,
    }


def _cleanup_empty_pending_dirs(chat_id: str | UUID, start: Path) -> None:
    root = workspace_pending_root(chat_id)
    parent = start.parent
    while parent != root and root in parent.parents:
        try:
            parent.rmdir()
        except OSError:
            break
        parent = parent.parent


def apply_pending_workspace_file(chat_id: str | UUID, relative_path: str) -> dict:
    pending = safe_pending_path(chat_id, relative_path)
    if not pending.is_file():
        raise FileNotFoundError(relative_path)
    content = pending.read_text(encoding="utf-8", errors="replace")
    write_workspace_file(chat_id, relative_path, content)
    pending.unlink()
    _cleanup_empty_pending_dirs(chat_id, pending)
    return read_workspace_file(chat_id, relative_path)


def reject_pending_workspace_file(chat_id: str | UUID, relative_path: str) -> dict:
    pending = safe_pending_path(chat_id, relative_path)
    if not pending.is_file():
        raise FileNotFoundError(relative_path)
    info = {
        "path": str(safe_relative_path(relative_path)),
        "name": pending.name,
    }
    pending.unlink()
    _cleanup_empty_pending_dirs(chat_id, pending)
    return info


def rollback_workspace_file(chat_id: str | UUID, relative_path: str) -> dict:
    current = safe_workspace_path(chat_id, relative_path)
    previous = latest_version(chat_id, relative_path)
    if not previous:
        raise FileNotFoundError("no previous version")
    current.parent.mkdir(parents=True, exist_ok=True)
    save_version(chat_id, relative_path, current)
    shutil.copy2(previous, current)
    return read_workspace_file(chat_id, relative_path)


def create_workspace_zip(chat_id: str | UUID) -> Path:
    root = workspace_root(chat_id)
    target_dir = Path(settings.TTD_GENERATED_DIR) / "workspace-zips"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"workspace-{chat_id}.zip"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(root.rglob("*")):
            rel = path.relative_to(root)
            if is_ignored_workspace_path(rel) or not path.is_file():
                continue
            archive.write(path, rel.as_posix())
    return target


def cleanup_old_workspaces(days: int) -> dict:
    root = Path(settings.TTD_GENERATED_DIR) / "workspaces"
    if not root.exists():
        return {"removed": 0, "freedBytes": 0}
    cutoff = time.time() - max(1, days) * 86400
    removed = 0
    freed = 0
    for path in root.iterdir():
        if not path.is_dir():
            continue
        try:
            newest = max((item.stat().st_mtime for item in path.rglob("*")), default=path.stat().st_mtime)
        except OSError:
            continue
        if newest >= cutoff:
            continue
        try:
            freed += directory_size(path)
            shutil.rmtree(path)
            removed += 1
        except OSError:
            continue
    return {"removed": removed, "freedBytes": freed}


def directory_size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    total = 0
    if path.exists():
        for item in path.rglob("*"):
            if item.is_file():
                try:
                    total += item.stat().st_size
                except OSError:
                    pass
    return total
