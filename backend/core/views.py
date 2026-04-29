from __future__ import annotations

import csv
import html as html_lib
import mimetypes
import os
import shutil
import subprocess
import threading
import time
import urllib.request
from io import StringIO
from pathlib import Path, PurePosixPath
from urllib.parse import quote, urlparse
from uuid import UUID

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import close_old_connections, connection
from django.db.models import Count
from django.http import FileResponse, HttpRequest, HttpResponse, StreamingHttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .chat_runtime import GenerationStopped, generation_slot, queue_status, raise_if_generation_stopped, request_generation_stop
from .llama_runtime import ensure_llama_server, llama_runtime_status, restart_llama_server, stop_managed_llama
from .model_registry import delete_local_model_file, file_size_label, sync_model_registry_with_files
from .models import AdminSession, AdminSetting, Attachment, Chat, GeneratedFile, Message, ModelInstallJob, ModelRegistry, RequestLog
from .seed import ensure_defaults
from .serializers import (
    chat_queryset,
    chat_to_detail,
    chat_to_summary,
    install_job_to_dict,
    message_to_dict,
    model_to_dict,
    request_to_dict,
    session_to_dict,
)
from .services import (
    build_local_draft,
    chunk_text,
    create_model_file_artifacts,
    language_from_filename,
    postprocess_assistant_response,
    safe_filename,
    search_huggingface_models,
    safety_blocked_test_output,
    should_block_generated_test,
    stream_llamacpp,
    system_snapshot,
    test_generated_file,
    test_generated_content,
    wants_file,
    wants_image,
)
from .utils import client_ip, json_response, log_admin_action, make_token, parse_json, require_admin, sse, user_agent
from .workspaces import (
    cleanup_old_workspaces,
    apply_pending_workspace_file,
    create_workspace_zip,
    diff_pending_workspace_file,
    diff_workspace_file,
    directory_size,
    list_workspace_tree,
    read_pending_workspace_file,
    read_workspace_file,
    reject_pending_workspace_file,
    rollback_workspace_file,
    safe_workspace_path,
    stage_workspace_file,
    write_workspace_file,
)


_LOGIN_FAILURES: dict[str, list[float]] = {}
_FRONTEND_BUILD_LOCK = threading.Lock()
_FRONTEND_BUILD_ATTEMPTED = False
_FRONTEND_BUILD_ERROR = ""


def index(request: HttpRequest):
    return frontend_entry(request)


def frontend_entry(request: HttpRequest, asset_path: str = ""):
    file_path = _resolve_frontend_file(request.path_info or "/")
    if file_path:
        status = 404 if file_path.name == "404.html" and request.path_info.rstrip("/") not in {"", "/404"} else 200
        return _serve_frontend_file(file_path, status=status)
    return _frontend_unavailable_response(request, status=404)


def _public_frontend_origin(request: HttpRequest) -> str:
    configured = settings.TTD_FRONTEND_ORIGIN.rstrip("/")
    parsed = urlparse(configured)
    configured_host = (parsed.hostname or "").lower()
    request_host = request.get_host()
    request_hostname = request_host.split(":", 1)[0].lower()

    if configured_host in {"127.0.0.1", "localhost", "0.0.0.0"} and request_hostname not in {
        "127.0.0.1",
        "localhost",
        "0.0.0.0",
    }:
        return f"{request.scheme}://{request_host}"
    return configured


def _frontend_build_root() -> Path:
    return settings.TTD_FRONTEND_BUILD_ROOT.resolve()


def _frontend_dir() -> Path:
    return settings.TTD_FRONTEND_DIR.resolve()


def _find_npm_executable() -> str | None:
    local_node_bin = settings.PROJECT_ROOT / ".runtime" / "node" / "current" / "bin"
    local_npm = local_node_bin / "npm"
    if local_npm.is_file():
        return str(local_npm)
    return shutil.which("npm")


def _ensure_frontend_export_available() -> bool:
    global _FRONTEND_BUILD_ATTEMPTED, _FRONTEND_BUILD_ERROR

    build_root = _frontend_build_root()
    if (build_root / "index.html").is_file():
        return True

    if not settings.TTD_AUTO_BUILD_FRONTEND:
        return False

    with _FRONTEND_BUILD_LOCK:
        if (build_root / "index.html").is_file():
            return True
        if _FRONTEND_BUILD_ATTEMPTED:
            return False

        _FRONTEND_BUILD_ATTEMPTED = True
        frontend_dir = _frontend_dir()
        package_json = frontend_dir / "package.json"
        npm = _find_npm_executable()
        if not package_json.is_file():
            _FRONTEND_BUILD_ERROR = f"package.json not found in {frontend_dir}"
            return False
        if not npm:
            _FRONTEND_BUILD_ERROR = "npm was not found in PATH or .runtime/node/current/bin"
            return False

        env = os.environ.copy()
        local_node_bin = settings.PROJECT_ROOT / ".runtime" / "node" / "current" / "bin"
        if local_node_bin.is_dir():
            env["PATH"] = f"{local_node_bin}{os.pathsep}{env.get('PATH', '')}"
        env.setdefault("NEXT_PUBLIC_API_BASE", "/api")

        try:
            result = subprocess.run(
                [npm, "run", "build"],
                cwd=frontend_dir,
                env=env,
                capture_output=True,
                text=True,
                timeout=settings.TTD_FRONTEND_BUILD_TIMEOUT_SECONDS,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            _FRONTEND_BUILD_ERROR = str(exc)
            return False

        if result.returncode != 0:
            output = (result.stderr or result.stdout or "npm run build failed").strip()
            _FRONTEND_BUILD_ERROR = output[-4000:]
            return False

        if not (build_root / "index.html").is_file():
            _FRONTEND_BUILD_ERROR = f"npm run build finished, but {build_root / 'index.html'} was not created"
            return False

        _FRONTEND_BUILD_ERROR = ""
        return True


def _resolve_frontend_file(request_path: str) -> Path | None:
    _ensure_frontend_export_available()
    build_root = _frontend_build_root()
    if not build_root.exists():
        return None

    normalized = (request_path or "/").split("?", 1)[0]
    normalized = normalized.lstrip("/")
    route_aliases = {
        "admin": "admin-panel",
        "chat": "chat-interface",
        "welcome": "welcome-screen",
    }
    normalized = route_aliases.get(normalized.rstrip("/"), normalized)
    candidates: list[str] = []

    if not normalized:
        candidates.append("index.html")
    else:
        relative = PurePosixPath(normalized)
        if ".." in relative.parts:
            return None

        if relative.suffix:
            candidates.append(relative.as_posix())
        else:
            candidates.append(f"{relative.as_posix()}/index.html")
            candidates.append(f"{relative.as_posix()}.html")

    for candidate in candidates:
        resolved = _safe_frontend_path(build_root, candidate)
        if resolved and resolved.is_file():
            return resolved

    fallback_404 = _safe_frontend_path(build_root, "404.html")
    if fallback_404 and fallback_404.is_file():
        return fallback_404

    return None


def _safe_frontend_path(build_root: Path, relative_path: str) -> Path | None:
    relative = PurePosixPath(relative_path)
    if relative.is_absolute() or ".." in relative.parts:
        return None

    resolved = (build_root / Path(*relative.parts)).resolve()
    if resolved != build_root and build_root not in resolved.parents:
        return None
    return resolved


def _serve_frontend_file(file_path: Path, status: int = 200) -> FileResponse:
    content_type, encoding = mimetypes.guess_type(file_path.name)
    response = FileResponse(open(file_path, "rb"), content_type=content_type or "application/octet-stream")
    response.status_code = status
    if encoding:
        response["Content-Encoding"] = encoding

    if file_path.suffix == ".html":
        response["Cache-Control"] = "no-cache"
    elif file_path.suffix in {".js", ".css"} or "_next" in file_path.parts:
        response["Cache-Control"] = "public, max-age=31536000, immutable"
    else:
        response["Cache-Control"] = "public, max-age=3600"
    return response


def _frontend_unavailable_response(request: HttpRequest, status: int = 503) -> HttpResponse:
    public_frontend_origin = _public_frontend_origin(request)
    build_root = _frontend_build_root()
    build_error = ""
    if _FRONTEND_BUILD_ERROR:
        build_error = f"<p>Auto-build error: <code>{html_lib.escape(_FRONTEND_BUILD_ERROR)}</code></p>"

    html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Time To Deny</title>
    <style>
      body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; background: #050607; color: #d7fff2; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
      main {{ width: min(820px, calc(100vw - 32px)); border: 1px solid rgba(255, 84, 112, .28); padding: 24px; background: rgba(255, 84, 112, .06); }}
      h1 {{ margin: 0 0 12px; font-size: 20px; color: #ff5470; }}
      p {{ color: #c8d2ce; line-height: 1.6; }}
      code {{ color: #7ef7c9; }}
      a {{ color: #6bcfff; }}
    </style>
  </head>
  <body>
    <main>
      <h1>Frontend build is unavailable</h1>
      <p>Django is reachable on <code>{public_frontend_origin}</code>, but the exported frontend files were not found under <code>{build_root}</code>.</p>
      <p>Run <code>./linux.sh start</code> or <code>npm run build</code> in <code>frontend/</code> and then try again.</p>
      {build_error}
      <p>API health stays available at <a href="/api/health">/api/health</a>.</p>
      <p>Requested path: <code>{request.path}</code></p>
    </main>
  </body>
</html>"""
    return HttpResponse(html, status=status)


def api_index(request: HttpRequest):
    public_frontend_origin = _public_frontend_origin(request)
    return json_response(
        {
            "ok": True,
            "service": "timetodeny-backend",
            "frontend": public_frontend_origin,
            "health": "/api/health",
            "note": "The chat UI is served directly by Django from the exported Next.js build.",
        }
    )


def health(request: HttpRequest):
    ensure_defaults()
    return json_response(
        {
            "ok": True,
            "service": "timetodeny-backend",
            "modelBackend": settings.TTD_MODEL_BACKEND,
            "llamaCppUrl": settings.TTD_LLAMA_CPP_URL,
        }
    )


def runtime_status(request: HttpRequest):
    ensure_defaults()
    sync_model_registry_with_files()
    selected = ModelRegistry.objects.filter(selected=True, status="ready").first()
    if settings.TTD_MODEL_BACKEND not in {"llamacpp", "llama.cpp"}:
        return json_response(
            {
                "ok": True,
                "runtime": {
                    "backend": settings.TTD_MODEL_BACKEND,
                    "state": "ready",
                    "label": "mock ready",
                    "selectedModel": selected.name if selected else "mock",
                },
            }
        )

    runtime = llama_runtime_status()
    if not selected:
        state = "offline"
        label = "no model"
    elif runtime.get("ready"):
        state = "ready"
        label = "ready"
    elif runtime.get("portOpen"):
        state = "loading"
        label = "model loading"
    else:
        state = "offline"
        label = "offline"

    return json_response(
        {
            "ok": True,
            "runtime": {
                "backend": runtime.get("backend"),
                "state": state,
                "label": label,
                "selectedModel": runtime.get("selectedModel") or (selected.name if selected else None),
                "portOpen": runtime.get("portOpen"),
                "ready": runtime.get("ready"),
                "health": runtime.get("health"),
            },
        }
    )


@csrf_exempt
def chats_collection(request: HttpRequest):
    ensure_defaults()
    if request.method == "GET":
        chats = [chat_to_summary(chat) for chat in chat_queryset()]
        return json_response({"ok": True, "chats": chats})

    if request.method == "POST":
        data = parse_json(request)
        chat = Chat.objects.create(
            title=(data.get("title") or "New conversation")[:200],
            mode=data.get("mode") or "instant",
            active_model=data.get("model") or selected_model_name(),
        )
        return json_response({"ok": True, "chat": chat_to_detail(chat)}, status=201)

    return json_response({"ok": False, "error": "Method not allowed"}, status=405)


@csrf_exempt
def chat_detail(request: HttpRequest, chat_id: UUID):
    ensure_defaults()
    chat = Chat.objects.filter(id=chat_id).first()
    if not chat:
        return json_response({"ok": False, "error": "Chat not found"}, status=404)

    if request.method == "GET":
        return json_response({"ok": True, "chat": chat_to_detail(chat)})

    if request.method == "DELETE":
        chat.delete()
        return json_response({"ok": True})

    return json_response({"ok": False, "error": "Method not allowed"}, status=405)


def normalize_chat_attachments(raw: object) -> tuple[list[dict], str | None]:
    if raw is None:
        return [], None
    if not isinstance(raw, list):
        return [], "attachments must be a list"
    if settings.TTD_MAX_ATTACHMENTS > 0 and len(raw) > settings.TTD_MAX_ATTACHMENTS:
        return [], f"too many attachments (max {settings.TTD_MAX_ATTACHMENTS})"

    attachments: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            return [], "attachment must be an object"
        content = str(item.get("content") or "")
        if settings.TTD_MAX_ATTACHMENT_CHARS > 0 and len(content) > settings.TTD_MAX_ATTACHMENT_CHARS:
            return [], f"attachment {item.get('name') or 'file'} is too large"
        attachments.append(
            {
                "name": str(item.get("name") or "attachment")[:255],
                "type": str(item.get("type") or "file")[:24],
                "size": str(item.get("size") or "")[:64],
                "content": content,
            }
        )
    return attachments, None


def chat_context(chat: Chat, current_message_id: UUID) -> list[dict[str, str]]:
    limit = max(0, settings.TTD_CHAT_CONTEXT_MESSAGES)
    if limit == 0:
        return []
    messages = (
        chat.messages.exclude(id=current_message_id)
        .exclude(content="")
        .filter(role__in=["user", "assistant"])
        .order_by("-created_at")[:limit]
    )
    return [{"role": msg.role, "content": msg.content} for msg in reversed(list(messages))]


def _clamp_int(value, default: int, low: int, high: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(low, min(high, parsed))


def model_context_limit(model: ModelRegistry | None, mode: str) -> int:
    if not model:
        return max(0, settings.TTD_CHAT_CONTEXT_MESSAGES)
    if mode == "expert":
        return int(model.expert_context_messages)
    return int(model.instant_context_messages)


def model_generation_options(model: ModelRegistry | None, mode: str) -> dict:
    max_tokens = 0
    if model:
        max_tokens = model.expert_max_tokens if mode == "expert" else model.instant_max_tokens
    elif settings.TTD_LLAMA_CPP_N_PREDICT > 0:
        max_tokens = settings.TTD_LLAMA_CPP_N_PREDICT
    return {
        "max_tokens": max_tokens,
        "temperature": 0.12 if mode == "expert" else 0.18,
        "prompt_cache_enabled": model.prompt_cache_enabled if model else True,
        "run_tests": model.run_tests if model else True,
        "max_test_files": max(0, int(model.max_test_files)) if model else 2,
    }


def summarize_old_context(messages: list[Message], max_chars: int) -> str:
    if not messages:
        return ""
    items = []
    for msg in messages[-8:]:
        content = " ".join(msg.content.split())
        if not content:
            continue
        role = "user" if msg.role == "user" else "assistant"
        items.append(f"{role}: {content[:260]}")
    summary = "Earlier conversation summary:\n" + "\n".join(items)
    return summary[:max_chars]


def smart_chat_context(chat: Chat, current_message_id: UUID, model: ModelRegistry | None, mode: str) -> list[dict[str, str]]:
    limit = model_context_limit(model, mode)
    if limit <= 0:
        return []

    rows = list(
        chat.messages.exclude(id=current_message_id)
        .exclude(content="")
        .filter(role__in=["user", "assistant"])
        .order_by("created_at")
    )
    if not rows:
        return []

    recent = rows[-limit:]
    older = rows[:-limit]
    context: list[dict[str, str]] = []
    char_budget = max(1800, limit * (1800 if mode == "expert" else 900))
    used = 0

    summary = summarize_old_context(older, 1400 if mode == "expert" else 700)
    if summary:
        context.append({"role": "system", "content": summary})
        used += len(summary)

    remaining_messages: list[dict[str, str]] = []
    for msg in reversed(recent):
        content = msg.content.strip()
        if not content:
            continue
        per_message_limit = 5000 if mode == "expert" else 1800
        clipped = content[:per_message_limit]
        if used + len(clipped) > char_budget and remaining_messages:
            break
        used += len(clipped)
        remaining_messages.append({"role": msg.role, "content": clipped})

    context.extend(reversed(remaining_messages))
    return context


def model_supports_mode(model: ModelRegistry, mode: str) -> bool:
    if mode == "expert":
        return model.use_for_expert
    return model.use_for_instant


def choose_response_model(requested_name: str, mode: str, prompt: str) -> ModelRegistry | None:
    candidates = list(
        ModelRegistry.objects.filter(status="ready", hidden=False, model_type__in=["text", "code"])
    )
    if not candidates:
        candidates = list(ModelRegistry.objects.filter(status="ready", model_type__in=["text", "code"]))
    requested = (requested_name or "").strip()
    if requested and requested.lower() not in {"__auto__", "auto", "registry-auto"}:
        for model in candidates:
            if model.name == requested:
                return model

    auto_candidates = [model for model in candidates if model.auto_select and model_supports_mode(model, mode)]
    if not auto_candidates:
        auto_candidates = [model for model in candidates if model_supports_mode(model, mode)] or candidates
    if not auto_candidates:
        return None

    code_task = wants_file(prompt) or any(marker in prompt.lower() for marker in ["код", "code", "python", "typescript", "react", "django"])

    def score(model: ModelRegistry) -> tuple[int, str]:
        value = 0
        if model.selected:
            value += 50
        if code_task and model.model_type == "code":
            value += 80
        if not code_task and model.model_type == "text":
            value += 20
        if mode == "instant" and model.quantization.upper() in {"Q2_K", "Q3_K_M", "Q4_K_S", "Q4_K_M"}:
            value += 10
        if mode == "expert" and model.quantization.upper() in {"Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0"}:
            value += 8
        return value, model.name

    return sorted(auto_candidates, key=score, reverse=True)[0]


def update_model_performance(model: ModelRegistry, data: dict) -> None:
    performance = data.get("performance") if isinstance(data.get("performance"), dict) else data
    model.auto_select = bool_from_payload(performance.get("autoSelect"), model.auto_select)
    model.use_for_instant = bool_from_payload(performance.get("useForInstant"), model.use_for_instant)
    model.use_for_expert = bool_from_payload(performance.get("useForExpert"), model.use_for_expert)
    model.prompt_cache_enabled = bool_from_payload(performance.get("promptCacheEnabled"), model.prompt_cache_enabled)
    model.run_tests = bool_from_payload(performance.get("runTests"), model.run_tests)
    model.instant_context_messages = _clamp_int(performance.get("instantContextMessages"), model.instant_context_messages, 0, 32)
    model.expert_context_messages = _clamp_int(performance.get("expertContextMessages"), model.expert_context_messages, 0, 64)
    model.instant_max_tokens = _clamp_int(performance.get("instantMaxTokens"), model.instant_max_tokens, 0, 8192)
    model.expert_max_tokens = _clamp_int(performance.get("expertMaxTokens"), model.expert_max_tokens, 0, 16384)
    model.llama_context_size = _clamp_int(performance.get("llamaContextSize"), model.llama_context_size, 0, 131072)
    model.llama_threads = _clamp_int(performance.get("llamaThreads"), model.llama_threads, 0, 256)
    model.llama_gpu_layers = _clamp_int(performance.get("llamaGpuLayers"), model.llama_gpu_layers, -1, 999)
    model.max_test_files = _clamp_int(performance.get("maxTestFiles"), model.max_test_files, 0, 32)


def generation_metadata(status: str, phase: str, activity: str, progress: int) -> dict:
    return {
        "status": status,
        "phase": phase,
        "activity": activity,
        "progress": max(0, min(100, int(progress))),
    }


def set_generation_state(message: Message, status: str, phase: str, activity: str, progress: int) -> None:
    metadata = message.metadata if isinstance(message.metadata, dict) else {}
    metadata["generation"] = generation_metadata(status, phase, activity, progress)
    message.metadata = metadata
    message.save(update_fields=["metadata", "updated_at"])


def save_generation_progress(
    message: Message,
    content: str,
    token_count: int,
    status: str,
    phase: str,
    activity: str,
    progress: int,
) -> None:
    metadata = message.metadata if isinstance(message.metadata, dict) else {}
    metadata["generation"] = generation_metadata(status, phase, activity, progress)
    message.content = content
    message.total_tokens = token_count
    message.metadata = metadata
    message.save(update_fields=["content", "total_tokens", "metadata", "updated_at"])


def activity_for_stream(content: str, token_count: int, mode: str) -> tuple[str, str, int]:
    lowered = content.lower()
    if "```ttd-file" in lowered:
        progress = min(88, 36 + max(1, token_count // 8))
        after_marker = lowered.rsplit("```ttd-file", 1)[-1]
        if "\n" not in after_marker or len(after_marker.strip()) < 80:
            return "files", "Создаю файл(-ы)...", progress
        return "files", "Заполняю кодом файл(-ы)...", progress
    if mode == "expert" and token_count > 40:
        progress = min(90, 30 + max(1, token_count // 10))
        return "polish", "Окончательно довожу до идеала...", progress
    if token_count < 32:
        progress = min(45, 16 + max(1, token_count // 4))
        return "plan", "Планирую структуру ответа...", progress
    progress = min(88, 18 + max(1, token_count // 8))
    return "chat", "Пишу в чат...", progress


def status_event_payload(message: Message) -> dict:
    generation = message.metadata.get("generation", {}) if isinstance(message.metadata, dict) else {}
    return {
        "messageId": str(message.id),
        "status": generation.get("status") or "streaming",
        "phase": generation.get("phase") or "working",
        "activity": generation.get("activity") or "Модель работает над вашим запросом...",
        "progress": int(generation.get("progress") or 0),
    }


def run_chat_generation_job(
    *,
    chat_id: UUID,
    assistant_id: UUID,
    log_id: UUID,
    prompt: str,
    mode: str,
    model_name: str,
    selected_model_id: UUID | None,
    system_prompt: str,
    history: list[dict[str, str]],
    generation_options: dict,
    public_image_base: str,
    attachment_count: int,
    started: float,
) -> None:
    close_old_connections()
    content = ""
    token_count = 0
    last_save = 0.0

    try:
        chat = Chat.objects.get(id=chat_id)
        assistant = Message.objects.get(id=assistant_id)
        log = RequestLog.objects.get(id=log_id)
        selected = ModelRegistry.objects.filter(id=selected_model_id).first() if selected_model_id else None

        queued = queue_status()["busy"]
        if queued:
            set_generation_state(assistant, "streaming", "queued", "Модель работает над вашим запросом: ждет свободный слот...", 3)

        use_llamacpp = settings.TTD_MODEL_BACKEND in {"llamacpp", "llama.cpp"} and not wants_image(prompt)
        with generation_slot(str(chat.id)) as slot:
            if slot["waitSeconds"] > 0.05:
                set_generation_state(assistant, "streaming", "starting", "Очередь прошла. Запускаю генерацию...", 8)

            if use_llamacpp:
                set_generation_state(assistant, "streaming", "loading", "Поднимаю llama.cpp и выбранную модель...", 10)
                ensure_llama_server(selected)
                set_generation_state(assistant, "streaming", "plan", "Подбираю контекст и быстрые параметры ответа...", 15)
                for token in stream_llamacpp(
                    prompt,
                    mode,
                    model_name,
                    system_prompt,
                    history=history,
                    stop_checker=raise_if_generation_stopped,
                    options=generation_options,
                ):
                    content += token
                    token_count += max(1, len(token.split()))
                    phase, activity, progress = activity_for_stream(content, token_count, mode)
                    now = time.monotonic()
                    if now - last_save >= 0.25 or phase == "files":
                        save_generation_progress(assistant, content, token_count, "streaming", phase, activity, progress)
                        last_save = now

                set_generation_state(assistant, "streaming", "files", "Проверяю, создала ли модель файл(-ы)...", 90)
                artifacts, passed, output, cleaned = create_model_file_artifacts(
                    prompt,
                    content,
                    str(chat.id),
                    allow_fallback=False,
                    run_tests=bool(generation_options.get("run_tests", True)),
                    max_test_files=int(generation_options.get("max_test_files", 2)),
                )
                if artifacts:
                    set_generation_state(assistant, "streaming", "tests", "Сохраняю и проверяю файл(-ы)...", 94)
                    assistant.test_passed = passed
                    assistant.test_output = output
                    for file in artifacts:
                        GeneratedFile.objects.create(
                            message=assistant,
                            name=file.name,
                            language=file.language,
                            content=file.content,
                            file_type=file.file_type,
                            disk_path=file.disk_path,
                        )
                    content = cleaned
                content, needs_continuation = postprocess_assistant_response(
                    content,
                    max_tokens=int(generation_options.get("max_tokens") or 0),
                    token_count=token_count,
                )
            else:
                set_generation_state(assistant, "streaming", "draft", "Готовлю локальный ответ...", 15)
                draft = build_local_draft(
                    prompt,
                    mode,
                    model_name,
                    public_image_base,
                    attachment_count,
                    chat_id=str(chat.id),
                )
                if draft.thinking:
                    assistant.thinking = draft.thinking
                    assistant.save(update_fields=["thinking", "updated_at"])
                    set_generation_state(assistant, "streaming", "thinking", "Думаю над задачей...", 25)
                for token in chunk_text(draft.content):
                    raise_if_generation_stopped()
                    content += token
                    token_count += max(1, len(token.split()))
                    phase, activity, progress = activity_for_stream(content, token_count, mode)
                    save_generation_progress(assistant, content, token_count, "streaming", phase, activity, progress)
                    time.sleep(0.015)
                token_count = draft.tokens
                assistant.test_passed = draft.test_passed
                assistant.test_output = draft.test_output
                for file in draft.files:
                    GeneratedFile.objects.create(
                        message=assistant,
                        name=file.name,
                        language=file.language,
                        content=file.content,
                        file_type=file.file_type,
                        disk_path=file.disk_path,
                    )
                content, needs_continuation = postprocess_assistant_response(content, token_count=token_count)

        elapsed = max(0.001, time.monotonic() - started)
        assistant.content = content
        assistant.total_tokens = token_count
        assistant.tokens_per_sec = token_count / elapsed
        metadata = assistant.metadata if isinstance(assistant.metadata, dict) else {}
        metadata["generation"] = generation_metadata("success", "done", "Все готово.", 100)
        metadata["needsContinuation"] = needs_continuation
        assistant.metadata = metadata
        assistant.save()

        log.status = "success"
        log.response = content
        log.tokens = token_count
        log.latency_ms = int(elapsed * 1000)
        log.save()
        chat.save(update_fields=["updated_at"])
    except GenerationStopped as exc:
        elapsed = max(0.001, time.monotonic() - started)
        try:
            assistant = Message.objects.get(id=assistant_id)
            assistant.content = content or "Generation stopped."
            assistant.total_tokens = token_count
            assistant.test_passed = False
            assistant.test_output = str(exc)
            metadata = assistant.metadata if isinstance(assistant.metadata, dict) else {}
            metadata["generation"] = generation_metadata("error", "stopped", "Генерация остановлена.", 100)
            assistant.metadata = metadata
            assistant.save()
            log = RequestLog.objects.get(id=log_id)
            log.status = "error"
            log.error_details = str(exc)
            log.latency_ms = int(elapsed * 1000)
            log.response = content
            log.tokens = token_count
            log.save()
        except Message.DoesNotExist:
            pass
    except Exception as exc:
        elapsed = max(0.001, time.monotonic() - started)
        try:
            assistant = Message.objects.get(id=assistant_id)
            assistant.content = content or "Generation failed."
            assistant.test_passed = False
            assistant.test_output = str(exc)
            metadata = assistant.metadata if isinstance(assistant.metadata, dict) else {}
            metadata["generation"] = generation_metadata("error", "error", "Генерация упала.", 100)
            assistant.metadata = metadata
            assistant.save()
            log = RequestLog.objects.get(id=log_id)
            log.status = "error"
            log.error_details = str(exc)
            log.latency_ms = int(elapsed * 1000)
            log.save()
        except Message.DoesNotExist:
            pass
    finally:
        close_old_connections()


def stream_generation_updates(chat: Chat, assistant: Message, log: RequestLog, *, run_inline=None):
    last_content = ""
    last_status = ""
    last_progress = -1
    last_heartbeat = 0.0
    inline_ran = False
    while True:
        if run_inline and not inline_ran:
            inline_ran = True
            run_inline()

        current = Message.objects.prefetch_related("attachments", "generated_files").filter(id=assistant.id).first()
        if not current:
            yield sse("error", {"error": "Chat was deleted while generation was running"})
            return

        status_payload = status_event_payload(current)
        status_key = f"{status_payload['status']}:{status_payload['phase']}:{status_payload['activity']}"
        now = time.monotonic()
        should_send_status = (
            status_key != last_status
            or status_payload["progress"] != last_progress
            or now - last_heartbeat >= 5
        )
        if should_send_status:
            last_status = status_key
            last_progress = status_payload["progress"]
            last_heartbeat = now
            yield sse("status", status_payload)

        if current.content.startswith(last_content):
            delta = current.content[len(last_content) :]
        else:
            delta = current.content
        if delta:
            last_content = current.content
            yield sse("token", {"text": delta})

        generation = current.metadata.get("generation", {}) if isinstance(current.metadata, dict) else {}
        if generation.get("status") == "success":
            saved_chat = Chat.objects.filter(id=chat.id).first()
            yield sse("done", {"message": message_to_dict(current), "chat": chat_to_summary(saved_chat or chat)})
            return
        if generation.get("status") == "error":
            yield sse("error", {"error": current.test_output or "Generation failed", "message": message_to_dict(current)})
            return

        time.sleep(0.2)


@csrf_exempt
def chat_stream(request: HttpRequest):
    ensure_defaults()
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)

    data = parse_json(request)
    prompt = str(data.get("message") or "")
    if settings.TTD_MAX_PROMPT_CHARS > 0 and len(prompt) > settings.TTD_MAX_PROMPT_CHARS:
        return json_response({"ok": False, "error": f"prompt is too long (max {settings.TTD_MAX_PROMPT_CHARS} chars)"}, status=413)
    mode = data.get("mode") or "instant"
    requested_model_name = data.get("model") or "__auto__"
    attachments, attachment_error = normalize_chat_attachments(data.get("attachments") or [])
    if attachment_error:
        return json_response({"ok": False, "error": attachment_error}, status=413)
    sync_model_registry_with_files()
    selected_model = choose_response_model(str(requested_model_name), mode, prompt)
    if selected_model:
        model_name = selected_model.name
    else:
        model_name = selected_model_name()
    started = time.monotonic()

    chat = get_or_create_chat(data.get("chatId"), prompt, mode, model_name)
    user_msg = Message.objects.create(chat=chat, role="user", content=prompt)
    for item in attachments:
        Attachment.objects.create(
            message=user_msg,
            name=(item.get("name") or "attachment")[:255],
            file_type=item.get("type") or "file",
            size=item.get("size") or "",
            content=item.get("content") or "",
        )

    log = RequestLog.objects.create(
        ip=client_ip(request),
        user_agent=user_agent(request),
        model=model_name,
        mode=mode,
        query=prompt,
        status="streaming",
        chat=chat,
    )
    assistant = Message.objects.create(chat=chat, role="assistant", content="")
    chat.mode = mode
    chat.active_model = model_name
    if chat.title == "New conversation":
        chat.title = title_from_prompt(prompt)
    chat.save(update_fields=["mode", "active_model", "title", "updated_at"])

    selected = selected_model or ModelRegistry.objects.filter(name=model_name).first()
    system_prompt = selected.system_prompt if selected else ""
    history = smart_chat_context(chat, user_msg.id, selected, mode)
    generation_options = model_generation_options(selected, mode)
    assistant.metadata = {
        "generation": generation_metadata(
            "streaming",
            "queued" if queue_status()["busy"] else "starting",
            "Модель работает над вашим запросом...",
            1,
        )
    }
    assistant.save(update_fields=["metadata", "updated_at"])
    public_image_base = request.build_absolute_uri(f"{settings.MEDIA_URL}generated/images/")

    job_kwargs = {
        "chat_id": chat.id,
        "assistant_id": assistant.id,
        "log_id": log.id,
        "prompt": prompt,
        "mode": mode,
        "model_name": model_name,
        "selected_model_id": selected.id if selected else None,
        "system_prompt": system_prompt,
        "history": history,
        "generation_options": generation_options,
        "public_image_base": public_image_base,
        "attachment_count": len(attachments),
        "started": started,
    }

    run_inline = connection.in_atomic_block
    if not run_inline:
        thread = threading.Thread(target=run_chat_generation_job, kwargs=job_kwargs, daemon=True)
        thread.start()

    def generate():
        queued = queue_status()["busy"]
        yield sse(
            "meta",
            {
                "chatId": str(chat.id),
                "userMessageId": str(user_msg.id),
                "assistantMessageId": str(assistant.id),
                "ts": timezone.localtime(assistant.created_at).strftime("%H:%M:%S"),
                "queued": queued,
            },
        )
        if run_inline:
            yield from stream_generation_updates(chat, assistant, log, run_inline=lambda: run_chat_generation_job(**job_kwargs))
            return

        yield from stream_generation_updates(chat, assistant, log)

    response = StreamingHttpResponse(generate(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response


@csrf_exempt
def chat_stop(request: HttpRequest):
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)
    request_generation_stop()
    stop_managed_llama()
    return json_response({"ok": True, "queue": queue_status()})


def selected_model_name() -> str:
    ensure_defaults()
    sync_model_registry_with_files()
    selected = ModelRegistry.objects.filter(selected=True, status="ready").first()
    return selected.name if selected else "local-assistant"


def get_or_create_chat(chat_id: str | None, prompt: str, mode: str, model_name: str) -> Chat:
    if chat_id:
        chat = Chat.objects.filter(id=chat_id).first()
        if chat:
            return chat
    return Chat.objects.create(title=title_from_prompt(prompt), mode=mode, active_model=model_name)


def title_from_prompt(prompt: str) -> str:
    cleaned = " ".join((prompt or "").split())
    return (cleaned[:60] or "New conversation") + ("..." if len(cleaned) > 60 else "")


@csrf_exempt
def models_collection(request: HttpRequest):
    ensure_defaults()
    sync_model_registry_with_files()
    if request.method == "GET":
        models = [model_to_dict(model) for model in ModelRegistry.objects.filter(status="ready")]
        return json_response({"ok": True, "models": models})
    return json_response({"ok": False, "error": "Method not allowed"}, status=405)


def models_search(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error

    query = (request.GET.get("q") or "").strip()
    model_type = (request.GET.get("type") or "").strip().lower()
    try:
        limit = int(request.GET.get("limit") or "8")
    except ValueError:
        limit = 8
    limit = max(1, min(limit, 24))

    try:
        results = search_huggingface_models(query, model_type, limit)
    except RuntimeError as exc:
        return json_response({"ok": False, "error": str(exc)}, status=502)

    log_admin_action(request, f"Searched HuggingFace models: {query or 'gguf'}", session)
    return json_response({"ok": True, "results": results})


def bool_from_payload(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return bool(value)


def validate_gguf_filename(filename: str) -> None:
    relative = PurePosixPath(filename)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("filename must be a safe relative HuggingFace file path")
    if not filename.lower().endswith(".gguf"):
        raise ValueError("filename must end in .gguf")


def download_huggingface_model(repo_id: str, filename: str) -> tuple[str, str]:
    validate_gguf_filename(filename)
    settings.TTD_MODEL_DIR.mkdir(parents=True, exist_ok=True)

    try:
        from huggingface_hub import hf_hub_download
    except ImportError as exc:
        raise RuntimeError("huggingface_hub is not installed on the backend") from exc

    local_path = Path(hf_hub_download(repo_id=repo_id, filename=filename, local_dir=str(settings.TTD_MODEL_DIR))).resolve()
    if not local_path.is_file():
        raise RuntimeError(f"HuggingFace download finished but file was not found: {local_path}")
    return str(local_path), file_size_label(str(local_path))


INSTALL_TERMINAL_STATUSES = {"ready", "failed", "cancelled"}


def huggingface_resolve_url(repo_id: str, filename: str) -> str:
    return f"https://huggingface.co/{quote(repo_id.strip(), safe='/')}/resolve/main/{quote(filename.strip(), safe='/')}"


def install_target_path(repo_id: str, filename: str) -> Path:
    validate_gguf_filename(filename)
    root = Path(settings.TTD_MODEL_DIR).expanduser().resolve()
    folder = safe_filename(repo_id.replace("/", "__"), "huggingface_model")
    relative = PurePosixPath(filename)
    target = (root / folder / Path(*relative.parts)).resolve()
    if root != target and root not in target.parents:
        raise ValueError("resolved model path escaped model directory")
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


def append_install_log(job: ModelInstallJob, line: str) -> None:
    ts = timezone.localtime().strftime("%H:%M:%S")
    job.log = f"{job.log}[{ts}] {line}\n"[-8000:]


def install_job_cancelled(job_id: UUID) -> bool:
    return ModelInstallJob.objects.filter(id=job_id, status="cancelled").exists()


def update_install_progress(
    job: ModelInstallJob,
    *,
    status: str | None = None,
    progress: int | None = None,
    downloaded: int | None = None,
    total: int | None = None,
    speed: float | None = None,
    eta: int | None = None,
    log_line: str | None = None,
) -> None:
    fields: list[str] = []
    if status is not None:
        job.status = status
        fields.append("status")
    if progress is not None:
        job.progress = max(0, min(100, int(progress)))
        fields.append("progress")
    if downloaded is not None:
        job.bytes_downloaded = max(0, int(downloaded))
        fields.append("bytes_downloaded")
    if total is not None:
        job.bytes_total = max(0, int(total))
        fields.append("bytes_total")
    if speed is not None:
        job.speed_bps = max(0, float(speed))
        fields.append("speed_bps")
    if eta is not None:
        job.eta_seconds = max(0, int(eta))
        fields.append("eta_seconds")
    if log_line:
        append_install_log(job, log_line)
        fields.append("log")
    if fields:
        fields.append("updated_at")
        job.save(update_fields=fields)


def download_huggingface_model_for_job(job: ModelInstallJob) -> tuple[str, str]:
    if str(getattr(settings, "TTD_ALLOW_HF_DOWNLOAD", "1")) != "1":
        raise RuntimeError("HuggingFace downloads are disabled by TTD_ALLOW_HF_DOWNLOAD")

    target = install_target_path(job.repo_id, job.filename)
    temporary = target.with_name(f"{target.name}.part")
    url = huggingface_resolve_url(job.repo_id, job.filename)
    headers = {"User-Agent": "TimeToDeny/1.0"}
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    update_install_progress(job, status="downloading", progress=2, log_line=f"Connecting to {url}")
    request = urllib.request.Request(url, headers=headers)
    started = time.monotonic()
    last_update = 0.0
    downloaded = 0
    total = 0

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            total = int(response.headers.get("Content-Length") or 0)
            update_install_progress(job, total=total, log_line=f"Download started: {job.filename}")
            with open(temporary, "wb") as handle:
                while True:
                    if install_job_cancelled(job.id):
                        raise RuntimeError("Installation cancelled")
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
                    downloaded += len(chunk)
                    now = time.monotonic()
                    if now - last_update < 0.7 and (not total or downloaded < total):
                        continue
                    elapsed = max(0.001, now - started)
                    speed = downloaded / elapsed
                    if total:
                        progress = 3 + int((downloaded / total) * 92)
                        eta = int((total - downloaded) / speed) if speed > 0 else 0
                    else:
                        progress = min(95, 5 + int(downloaded / (64 * 1024 * 1024)))
                        eta = 0
                    update_install_progress(
                        job,
                        progress=progress,
                        downloaded=downloaded,
                        total=total,
                        speed=speed,
                        eta=eta,
                    )
                    last_update = now

        if total and downloaded < total:
            raise RuntimeError(f"Downloaded {downloaded} of {total} bytes")
        temporary.replace(target)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise

    update_install_progress(job, progress=95, downloaded=downloaded, total=total, log_line="Download finished")
    return str(target), file_size_label(target)


def run_model_install_job(job_id: UUID) -> None:
    close_old_connections()
    try:
        job = ModelInstallJob.objects.get(id=job_id)
        if job.status == "cancelled":
            return
        update_install_progress(job, status="downloading", progress=1, log_line="Install job started")
        local_path, size = download_huggingface_model_for_job(job)

        job.refresh_from_db()
        if job.status == "cancelled":
            append_install_log(job, "Install job cancelled")
            job.save(update_fields=["log", "updated_at"])
            return

        update_install_progress(job, status="verifying", progress=96, log_line="Verifying local GGUF file")
        path = Path(local_path)
        if not path.is_file():
            raise RuntimeError(f"Downloaded file is missing: {path}")

        model_name = PurePosixPath(job.filename).name.removesuffix(".gguf")
        model, _created = ModelRegistry.objects.update_or_create(
            repo_id=job.repo_id,
            filename=job.filename,
            defaults={
                "name": model_name,
                "model_type": job.model_type,
                "quantization": job.quantization,
                "status": "ready",
                "size": size,
                "vram": "-",
                "download_progress": 100,
                "local_path": local_path,
            },
        )
        job.model = model
        job.status = "ready"
        job.progress = 100
        job.local_path = local_path
        job.error_details = ""
        append_install_log(job, f"Ready: {model.name}")
        job.save(update_fields=["model", "status", "progress", "local_path", "error_details", "log", "updated_at"])
        sync_model_registry_with_files()
    except Exception as exc:
        try:
            job = ModelInstallJob.objects.get(id=job_id)
        except ModelInstallJob.DoesNotExist:
            return
        if job.status == "cancelled":
            append_install_log(job, "Install job cancelled")
            job.save(update_fields=["log", "updated_at"])
            return
        job.status = "failed"
        job.error_details = str(exc)
        append_install_log(job, f"Failed: {exc}")
        job.save(update_fields=["status", "error_details", "log", "updated_at"])
    finally:
        close_old_connections()


def start_model_install_job(job: ModelInstallJob) -> None:
    if connection.in_atomic_block:
        run_model_install_job(job.id)
        return
    thread = threading.Thread(target=run_model_install_job, args=(job.id,), daemon=True)
    thread.start()


@csrf_exempt
def model_install_jobs(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error

    if request.method == "GET":
        jobs = ModelInstallJob.objects.select_related("model").all()[:40]
        return json_response({"ok": True, "jobs": [install_job_to_dict(job) for job in jobs]})

    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)

    data = parse_json(request)
    repo_id = data.get("repoId") or data.get("repo_id") or ""
    filename = data.get("filename") or ""
    model_type = data.get("modelType") or data.get("type") or "text"
    quantization = data.get("quantization") or "Q4_K_M"
    if not repo_id or not filename:
        return json_response({"ok": False, "error": "repoId and filename are required"}, status=400)
    if model_type not in {"text", "vision", "code"}:
        return json_response({"ok": False, "error": "modelType must be text, vision, or code"}, status=400)
    try:
        validate_gguf_filename(filename)
    except ValueError as exc:
        return json_response({"ok": False, "error": str(exc)}, status=400)
    if str(getattr(settings, "TTD_ALLOW_HF_DOWNLOAD", "1")) != "1":
        return json_response({"ok": False, "error": "HuggingFace downloads are disabled by TTD_ALLOW_HF_DOWNLOAD"}, status=403)

    job = ModelInstallJob.objects.create(
        repo_id=repo_id,
        filename=filename,
        model_type=model_type,
        quantization=quantization,
        requested_by_ip=client_ip(request),
        requested_by_user_agent=user_agent(request),
    )
    log_admin_action(request, f"Queued model install: {repo_id}/{filename}", session)
    start_model_install_job(job)
    job.refresh_from_db()
    return json_response({"ok": True, "job": install_job_to_dict(job)}, status=201)


@csrf_exempt
def model_install_job_cancel(request: HttpRequest, job_id: UUID):
    session, error = require_admin(request)
    if error:
        return error
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)
    job = ModelInstallJob.objects.select_related("model").filter(id=job_id).first()
    if not job:
        return json_response({"ok": False, "error": "Install job not found"}, status=404)
    if job.status not in INSTALL_TERMINAL_STATUSES:
        job.status = "cancelled"
        job.error_details = "Cancelled by admin"
        append_install_log(job, "Cancellation requested")
        job.save(update_fields=["status", "error_details", "log", "updated_at"])
        log_admin_action(request, f"Cancelled model install: {job.repo_id}/{job.filename}", session)
    return json_response({"ok": True, "job": install_job_to_dict(job)})


@csrf_exempt
def model_install_job_retry(request: HttpRequest, job_id: UUID):
    session, error = require_admin(request)
    if error:
        return error
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)
    old = ModelInstallJob.objects.filter(id=job_id).first()
    if not old:
        return json_response({"ok": False, "error": "Install job not found"}, status=404)
    if old.status not in INSTALL_TERMINAL_STATUSES:
        return json_response({"ok": False, "error": "Install job is still running"}, status=400)
    job = ModelInstallJob.objects.create(
        repo_id=old.repo_id,
        filename=old.filename,
        model_type=old.model_type,
        quantization=old.quantization,
        requested_by_ip=client_ip(request),
        requested_by_user_agent=user_agent(request),
    )
    log_admin_action(request, f"Retried model install: {job.repo_id}/{job.filename}", session)
    start_model_install_job(job)
    job.refresh_from_db()
    return json_response({"ok": True, "job": install_job_to_dict(job)}, status=201)


@csrf_exempt
def model_install(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    data = parse_json(request)
    repo_id = data.get("repoId") or data.get("repo_id") or ""
    filename = data.get("filename") or ""
    model_type = data.get("modelType") or data.get("type") or "text"
    quantization = data.get("quantization") or "Q4_K_M"
    if not repo_id or not filename:
        return json_response({"ok": False, "error": "repoId and filename are required"}, status=400)

    try:
        validate_gguf_filename(filename)
    except ValueError as exc:
        return json_response({"ok": False, "error": str(exc)}, status=400)

    model_name = PurePosixPath(filename).name.removesuffix(".gguf")
    download_requested = bool_from_payload(data.get("download"), default=True)
    if download_requested and str(getattr(settings, "TTD_ALLOW_HF_DOWNLOAD", "1")) != "1":
        return json_response({"ok": False, "error": "HuggingFace downloads are disabled by TTD_ALLOW_HF_DOWNLOAD"}, status=403)

    model, created = ModelRegistry.objects.update_or_create(
        repo_id=repo_id,
        filename=filename,
        defaults={
            "name": model_name,
            "model_type": model_type,
            "quantization": quantization,
            "status": "downloading" if download_requested else "unloaded",
            "size": "-",
            "vram": "-",
            "download_progress": 0,
            "local_path": "",
        },
    )
    if not download_requested:
        log_admin_action(request, f"Registered model without download: {model.name}", session)
        return json_response({"ok": True, "model": model_to_dict(model)}, status=201 if created else 200)

    try:
        local_path, size = download_huggingface_model(repo_id, filename)
    except Exception as exc:
        model.status = "error"
        model.local_path = str(exc)
        model.download_progress = 0
        model.save(update_fields=["status", "local_path", "download_progress", "updated_at"])
        log_admin_action(request, f"Model install failed: {model.name}: {exc}", session)
        return json_response({"ok": False, "error": f"Model download failed: {exc}", "model": model_to_dict(model)}, status=502)

    model.status = "ready"
    model.size = size
    model.local_path = local_path
    model.download_progress = 100
    model.save(update_fields=["status", "size", "local_path", "download_progress", "updated_at"])
    sync_model_registry_with_files()
    log_admin_action(request, f"Downloaded model: {model.name}", session)
    return json_response({"ok": True, "model": model_to_dict(model)}, status=201 if created else 200)


@csrf_exempt
def models_import_local(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)
    models = [model_to_dict(model) for model in sync_model_registry_with_files()]
    log_admin_action(request, f"Imported local GGUF models from {settings.TTD_MODEL_DIR}", session)
    return json_response({"ok": True, "models": models, "modelDir": str(settings.TTD_MODEL_DIR)})


@csrf_exempt
def model_action(request: HttpRequest, model_id: UUID, action: str):
    session, error = require_admin(request)
    if error:
        return error
    model = ModelRegistry.objects.filter(id=model_id).first()
    if not model:
        return json_response({"ok": False, "error": "Model not found"}, status=404)

    data = parse_json(request) if request.body else {}
    if action == "select":
        if model.status != "ready" or not model.local_path or not Path(model.local_path).is_file():
            sync_model_registry_with_files()
            return json_response({"ok": False, "error": "Model file is missing. Reinstall the model first."}, status=400)
        ModelRegistry.objects.exclude(id=model.id).update(selected=False)
        model.selected = True
        stop_managed_llama()
    elif action == "deselect":
        model.selected = False
    elif action == "hide":
        model.hidden = True
    elif action == "show":
        model.hidden = False
    elif action == "delete":
        name = model.name
        was_selected = model.selected
        delete_local_model_file(model.local_path)
        model.delete()
        if was_selected:
            stop_managed_llama()
        sync_model_registry_with_files()
        log_admin_action(request, f"Deleted model: {name}", session)
        return json_response({"ok": True})
    elif action == "prompt":
        model.system_prompt = data.get("prompt") or ""
    elif action == "settings":
        update_model_performance(model, data)
        if model.selected:
            stop_managed_llama()
    elif action == "reload":
        if not model.repo_id or not model.filename:
            return json_response({"ok": False, "error": "Model has no HuggingFace repo/filename to reload"}, status=400)
        model.status = "downloading"
        model.download_progress = 0
        model.save(update_fields=["status", "download_progress", "updated_at"])
        try:
            local_path, size = download_huggingface_model(model.repo_id, model.filename)
        except Exception as exc:
            model.status = "error"
            model.local_path = str(exc)
            model.download_progress = 0
            model.save(update_fields=["status", "local_path", "download_progress", "updated_at"])
            log_admin_action(request, f"Model reload failed: {model.name}: {exc}", session)
            return json_response({"ok": False, "error": f"Model download failed: {exc}", "model": model_to_dict(model)}, status=502)
        model.status = "ready"
        model.size = size
        model.local_path = local_path
        model.download_progress = 100
        sync_model_registry_with_files()
    else:
        return json_response({"ok": False, "error": "Unknown model action"}, status=400)

    model.save()
    log_admin_action(request, f"Model action {action}: {model.name}", session)
    return json_response({"ok": True, "model": model_to_dict(model)})


@csrf_exempt
def models_show_all(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    ModelRegistry.objects.update(hidden=False)
    log_admin_action(request, "Showed all models", session)
    return json_response({"ok": True})


@csrf_exempt
def models_hide_all(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    ModelRegistry.objects.update(hidden=True)
    log_admin_action(request, "Hid all models", session)
    return json_response({"ok": True})


def models_compatibility(request: HttpRequest):
    ensure_defaults()
    sync_model_registry_with_files()
    selected = ModelRegistry.objects.filter(selected=True, status="ready").first()
    text_ready = ModelRegistry.objects.filter(model_type__in=["text", "code"], status="ready").exists()
    vision_ready = ModelRegistry.objects.filter(model_type="vision", status="ready").exists()
    ok = bool(selected and selected.model_type in ["text", "code"] and text_ready)
    reason = "Selected response model is compatible with chat."
    if not selected:
        reason = "No response model selected."
    elif selected.model_type == "vision":
        reason = "Vision model is selected as primary response model; choose text/code for chat."
    elif not vision_ready:
        reason = "Chat model is OK, but no ready vision model is available for image requests."
    return json_response({"ok": True, "compatible": ok, "reason": reason, "visionReady": vision_ready})


def models_runtime(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    sync_model_registry_with_files()
    log_admin_action(request, "Viewed llama.cpp runtime health", session)
    return json_response({"ok": True, "runtime": llama_runtime_status()})


@csrf_exempt
def models_runtime_restart(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)
    sync_model_registry_with_files()
    selected = ModelRegistry.objects.filter(selected=True, status="ready").first()
    if not selected:
        return json_response({"ok": False, "error": "No ready model selected"}, status=400)
    try:
        runtime = restart_llama_server(selected)
    except Exception as exc:
        log_admin_action(request, f"llama.cpp restart failed: {exc}", session)
        return json_response({"ok": False, "error": str(exc), "runtime": llama_runtime_status()}, status=502)
    log_admin_action(request, f"Restarted llama.cpp runtime: {selected.name}", session)
    return json_response({"ok": True, "runtime": runtime})


def login_rate_limited(ip: str) -> tuple[bool, int]:
    now = time.monotonic()
    window = settings.TTD_LOGIN_RATE_LIMIT_WINDOW_SECONDS
    attempts = _LOGIN_FAILURES.get(ip, [])
    attempts = [stamp for stamp in attempts if now - stamp < window]
    _LOGIN_FAILURES[ip] = attempts
    remaining = max(0, settings.TTD_LOGIN_RATE_LIMIT_ATTEMPTS - len(attempts))
    return remaining == 0, remaining


def record_login_failure(ip: str) -> None:
    now = time.monotonic()
    attempts = _LOGIN_FAILURES.setdefault(ip, [])
    attempts.append(now)


def clear_login_failures(ip: str) -> None:
    _LOGIN_FAILURES.pop(ip, None)


@csrf_exempt
def admin_login(request: HttpRequest):
    ensure_defaults()
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)
    data = parse_json(request)
    password = data.get("password") or ""
    ip = client_ip(request)
    limited, _remaining = login_rate_limited(ip)
    if limited:
        return json_response({"ok": False, "error": "Too many failed attempts. Wait a few minutes."}, status=429)
    setting = AdminSetting.objects.filter(key="admin_password").first()
    if not setting or not check_password(password, setting.value):
        record_login_failure(ip)
        RequestLog.objects.create(
            ip=ip,
            user_agent=user_agent(request),
            model="admin",
            mode="auth",
            query="admin login",
            response="",
            status="error",
            error_details="Invalid admin password",
        )
        return json_response({"ok": False, "error": "Invalid credentials"}, status=401)

    clear_login_failures(ip)
    session = AdminSession.objects.create(token=make_token(), ip=ip, user_agent=user_agent(request))
    log_admin_action(request, "Authenticated successfully", session)
    return json_response(
        {
            "ok": True,
            "token": session.token,
            "session": session_to_dict(session),
            "mustChangePassword": check_password("1111", setting.value),
        }
    )


@csrf_exempt
def admin_logout(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    session.status = "ended"
    session.logout_time = timezone.now()
    session.save(update_fields=["status", "logout_time", "updated_at"])
    log_admin_action(request, "Session ended (logout)", session)
    return json_response({"ok": True})


@csrf_exempt
def admin_change_password(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    data = parse_json(request)
    current = data.get("currentPassword") or ""
    new = data.get("newPassword") or ""
    setting = AdminSetting.objects.get(key="admin_password")
    if not check_password(current, setting.value):
        return json_response({"ok": False, "error": "Current password incorrect"}, status=400)
    if len(new) < 4:
        return json_response({"ok": False, "error": "New password must be at least 4 characters"}, status=400)
    setting.value = make_password(new)
    setting.save(update_fields=["value", "updated_at"])
    log_admin_action(request, "Changed admin password", session)
    return json_response({"ok": True})


@csrf_exempt
def admin_kick_all(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    AdminSession.objects.filter(status="active").exclude(id=session.id).update(status="ended", logout_time=timezone.now())
    log_admin_action(request, "Kicked all active admin sessions", session)
    return json_response({"ok": True})


def admin_requests(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    log_admin_action(request, "Viewed Request Database tab", session)
    entries = [request_to_dict(entry) for entry in RequestLog.objects.all()[:250]]
    counts = RequestLog.objects.values("status").annotate(count=Count("status"))
    summary = {item["status"]: item["count"] for item in counts}
    summary["total"] = RequestLog.objects.count()
    return json_response({"ok": True, "requests": entries, "counts": summary})


def admin_requests_export(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "ip", "timestamp", "model", "mode", "query", "response", "status", "latency_ms", "tokens", "error"])
    for entry in RequestLog.objects.all()[:1000]:
        writer.writerow([
            entry.id,
            entry.ip,
            entry.created_at.isoformat(),
            entry.model,
            entry.mode,
            entry.query,
            entry.response,
            entry.status,
            entry.latency_ms,
            entry.tokens,
            entry.error_details,
        ])
    log_admin_action(request, "Exported request database CSV", session)
    response = HttpResponse(output.getvalue(), content_type="text/csv")
    response["Content-Disposition"] = 'attachment; filename="ttd_requests.csv"'
    return response


def admin_server(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    interval = request.GET.get("interval", "30min")
    log_admin_action(request, f"Viewed Server Load tab ({interval})", session)
    return json_response({"ok": True, **system_snapshot(interval)})


def bytes_label(value: int) -> str:
    if value >= 1024**3:
        return f"{value / (1024**3):.2f}GB"
    if value >= 1024**2:
        return f"{value / (1024**2):.1f}MB"
    if value >= 1024:
        return f"{value / 1024:.1f}KB"
    return f"{value}B"


def runtime_log_paths() -> dict[str, Path]:
    log_dir = Path(settings.PROJECT_ROOT) / ".runtime" / "logs"
    return {
        "backend": log_dir / "backend.log",
        "frontend": log_dir / "frontend.log",
        "llama": log_dir / "llama.log",
    }


def tail_file(path: Path, lines: int) -> str:
    try:
        return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:])
    except OSError:
        return ""


def admin_logs(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    service = (request.GET.get("service") or "all").lower()
    try:
        lines = max(20, min(1000, int(request.GET.get("lines") or settings.TTD_LOG_TAIL_LINES)))
    except ValueError:
        lines = settings.TTD_LOG_TAIL_LINES

    paths = runtime_log_paths()
    if service != "all":
        paths = {service: paths[service]} if service in paths else {}
    logs = {
        name: {"path": str(path), "content": tail_file(path, lines), "exists": path.is_file()}
        for name, path in paths.items()
    }
    log_admin_action(request, f"Viewed runtime logs ({service})", session)
    return json_response({"ok": True, "logs": logs})


def admin_disk(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    db_name = settings.DATABASES["default"].get("NAME")
    paths = {
        "project": Path(settings.PROJECT_ROOT),
        "models": Path(settings.TTD_MODEL_DIR),
        "generated": Path(settings.TTD_GENERATED_DIR),
        "media": Path(settings.MEDIA_ROOT),
        "logs": Path(settings.PROJECT_ROOT) / ".runtime" / "logs",
        "llamaSource": Path(settings.PROJECT_ROOT) / "llamaserver",
    }
    if db_name:
        paths["database"] = Path(db_name)
    entries = []
    for name, path in paths.items():
        size = directory_size(path) if path.exists() else 0
        entries.append({"name": name, "path": str(path), "exists": path.exists(), "bytes": size, "size": bytes_label(size)})
    log_admin_action(request, "Viewed disk usage", session)
    return json_response({"ok": True, "entries": entries})


@csrf_exempt
def admin_cleanup(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)
    data = parse_json(request)
    days = int(data.get("days") or 7)
    truncate_logs = bool_from_payload(data.get("truncateLogs"), default=False)
    result = cleanup_old_workspaces(days)
    truncated = []
    if truncate_logs:
        for name, path in runtime_log_paths().items():
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                path.write_text("", encoding="utf-8")
                truncated.append(name)
            except OSError:
                pass
    log_admin_action(request, f"Cleanup completed: {result['removed']} workspaces removed", session)
    return json_response({"ok": True, "cleanup": result, "truncatedLogs": truncated})


def admin_backup(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    engine = settings.DATABASES["default"].get("ENGINE", "")
    db_name = settings.DATABASES["default"].get("NAME")
    if "sqlite3" not in engine or not db_name:
        return json_response({"ok": False, "error": "Automatic DB file backup is only available for SQLite."}, status=501)
    db_path = Path(db_name)
    if not db_path.is_file():
        return json_response({"ok": False, "error": "Database file not found"}, status=404)
    log_admin_action(request, "Downloaded SQLite backup", session)
    return FileResponse(open(db_path, "rb"), as_attachment=True, filename=f"ttd-db-{int(time.time())}.sqlite3")


def admin_sessions(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    log_admin_action(request, "Viewed Sessions tab", session)
    sessions = [session_to_dict(item) for item in AdminSession.objects.prefetch_related("actions").all()[:250]]
    return json_response({"ok": True, "sessions": sessions})


@csrf_exempt
def workspace_detail(request: HttpRequest, chat_id: UUID):
    if request.method != "GET":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)
    if not Chat.objects.filter(id=chat_id).exists():
        return json_response({"ok": False, "error": "Chat not found"}, status=404)
    return json_response({"ok": True, "workspace": list_workspace_tree(chat_id)})


@csrf_exempt
def workspace_file(request: HttpRequest, chat_id: UUID):
    if not Chat.objects.filter(id=chat_id).exists():
        return json_response({"ok": False, "error": "Chat not found"}, status=404)
    if request.method == "GET":
        path = request.GET.get("path") or ""
        try:
            return json_response({"ok": True, "file": read_workspace_file(chat_id, path)})
        except FileNotFoundError:
            return json_response({"ok": False, "error": "File not found"}, status=404)
        except ValueError as exc:
            return json_response({"ok": False, "error": str(exc)}, status=400)
    if request.method == "POST":
        data = parse_json(request)
        relative_path = data.get("path") or ""
        try:
            write_workspace_file(chat_id, relative_path, data.get("content") or "")
            return json_response({"ok": True, "file": read_workspace_file(chat_id, relative_path)})
        except ValueError as exc:
            return json_response({"ok": False, "error": str(exc)}, status=400)
    return json_response({"ok": False, "error": "Method not allowed"}, status=405)


def workspace_zip(request: HttpRequest, chat_id: UUID):
    if not Chat.objects.filter(id=chat_id).exists():
        return json_response({"ok": False, "error": "Chat not found"}, status=404)
    archive = create_workspace_zip(chat_id)
    return FileResponse(open(archive, "rb"), as_attachment=True, filename=archive.name)


def workspace_diff(request: HttpRequest, chat_id: UUID):
    if not Chat.objects.filter(id=chat_id).exists():
        return json_response({"ok": False, "error": "Chat not found"}, status=404)
    try:
        return json_response({"ok": True, "diff": diff_workspace_file(chat_id, request.GET.get("path") or "")})
    except FileNotFoundError:
        return json_response({"ok": False, "error": "File/version not found"}, status=404)
    except ValueError as exc:
        return json_response({"ok": False, "error": str(exc)}, status=400)


@csrf_exempt
def workspace_pending_file(request: HttpRequest, chat_id: UUID):
    if not Chat.objects.filter(id=chat_id).exists():
        return json_response({"ok": False, "error": "Chat not found"}, status=404)
    if request.method == "GET":
        path = request.GET.get("path") or ""
        try:
            return json_response(
                {
                    "ok": True,
                    "file": read_pending_workspace_file(chat_id, path),
                    "diff": diff_pending_workspace_file(chat_id, path),
                }
            )
        except FileNotFoundError:
            return json_response({"ok": False, "error": "Pending file not found"}, status=404)
        except ValueError as exc:
            return json_response({"ok": False, "error": str(exc)}, status=400)
    if request.method == "POST":
        data = parse_json(request)
        relative_path = data.get("path") or ""
        try:
            stage_workspace_file(chat_id, relative_path, data.get("content") or "")
            return json_response(
                {
                    "ok": True,
                    "file": read_pending_workspace_file(chat_id, relative_path),
                    "diff": diff_pending_workspace_file(chat_id, relative_path),
                }
            )
        except ValueError as exc:
            return json_response({"ok": False, "error": str(exc)}, status=400)
    return json_response({"ok": False, "error": "Method not allowed"}, status=405)


@csrf_exempt
def workspace_pending_apply(request: HttpRequest, chat_id: UUID):
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)
    if not Chat.objects.filter(id=chat_id).exists():
        return json_response({"ok": False, "error": "Chat not found"}, status=404)
    data = parse_json(request)
    try:
        return json_response({"ok": True, "file": apply_pending_workspace_file(chat_id, data.get("path") or "")})
    except FileNotFoundError:
        return json_response({"ok": False, "error": "Pending file not found"}, status=404)
    except ValueError as exc:
        return json_response({"ok": False, "error": str(exc)}, status=400)


@csrf_exempt
def workspace_pending_reject(request: HttpRequest, chat_id: UUID):
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)
    if not Chat.objects.filter(id=chat_id).exists():
        return json_response({"ok": False, "error": "Chat not found"}, status=404)
    data = parse_json(request)
    try:
        return json_response({"ok": True, "rejected": reject_pending_workspace_file(chat_id, data.get("path") or "")})
    except FileNotFoundError:
        return json_response({"ok": False, "error": "Pending file not found"}, status=404)
    except ValueError as exc:
        return json_response({"ok": False, "error": str(exc)}, status=400)


@csrf_exempt
def workspace_pending_test(request: HttpRequest, chat_id: UUID):
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)
    if not Chat.objects.filter(id=chat_id).exists():
        return json_response({"ok": False, "error": "Chat not found"}, status=404)
    data = parse_json(request)
    relative_path = data.get("path") or ""
    try:
        file = read_pending_workspace_file(chat_id, relative_path)
        language = language_from_filename(relative_path)
        if should_block_generated_test("", relative_path, file["content"]):
            return json_response(
                {
                    "ok": True,
                    "result": {
                        "path": file["path"],
                        "passed": False,
                        "blocked": True,
                        "output": safety_blocked_test_output(),
                    },
                }
            )
        passed, output = test_generated_content(file["content"], relative_path, language)
        return json_response({"ok": True, "result": {"path": file["path"], "passed": passed, "blocked": False, "output": output}})
    except FileNotFoundError:
        return json_response({"ok": False, "error": "Pending file not found"}, status=404)
    except ValueError as exc:
        return json_response({"ok": False, "error": str(exc)}, status=400)


@csrf_exempt
def workspace_test(request: HttpRequest, chat_id: UUID):
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)
    if not Chat.objects.filter(id=chat_id).exists():
        return json_response({"ok": False, "error": "Chat not found"}, status=404)
    data = parse_json(request)
    relative_path = data.get("path") or ""
    try:
        file = read_workspace_file(chat_id, relative_path)
        if should_block_generated_test("", relative_path, file["content"]):
            return json_response(
                {
                    "ok": True,
                    "result": {
                        "path": file["path"],
                        "passed": False,
                        "blocked": True,
                        "output": safety_blocked_test_output(),
                    },
                }
            )
        disk_path = safe_workspace_path(chat_id, relative_path)
        passed, output = test_generated_file(disk_path, language_from_filename(relative_path))
        return json_response({"ok": True, "result": {"path": file["path"], "passed": passed, "blocked": False, "output": output}})
    except FileNotFoundError:
        return json_response({"ok": False, "error": "File not found"}, status=404)
    except ValueError as exc:
        return json_response({"ok": False, "error": str(exc)}, status=400)


@csrf_exempt
def workspace_rollback(request: HttpRequest, chat_id: UUID):
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)
    if not Chat.objects.filter(id=chat_id).exists():
        return json_response({"ok": False, "error": "Chat not found"}, status=404)
    data = parse_json(request)
    try:
        return json_response({"ok": True, "file": rollback_workspace_file(chat_id, data.get("path") or "")})
    except FileNotFoundError:
        return json_response({"ok": False, "error": "Previous version not found"}, status=404)
    except ValueError as exc:
        return json_response({"ok": False, "error": str(exc)}, status=400)
