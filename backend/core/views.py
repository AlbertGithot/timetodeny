from __future__ import annotations

import csv
import time
from io import StringIO
from uuid import UUID

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db.models import Count
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect, StreamingHttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .models import AdminSession, AdminSetting, Attachment, Chat, GeneratedFile, Message, ModelRegistry, RequestLog
from .seed import ensure_defaults
from .serializers import (
    chat_queryset,
    chat_to_detail,
    chat_to_summary,
    message_to_dict,
    model_to_dict,
    request_to_dict,
    session_to_dict,
)
from .services import (
    build_local_draft,
    chunk_text,
    stream_llamacpp,
    system_snapshot,
    wants_file,
    wants_image,
)
from .utils import client_ip, json_response, log_admin_action, make_token, parse_json, require_admin, sse, user_agent


def index(request: HttpRequest):
    return HttpResponseRedirect(settings.TTD_FRONTEND_ORIGIN)


def api_index(request: HttpRequest):
    return json_response(
        {
            "ok": True,
            "service": "timetodeny-backend",
            "frontend": settings.TTD_FRONTEND_ORIGIN,
            "health": "/api/health",
            "note": "Open the frontend URL for the chat UI. Django serves the API, not the Next.js page.",
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


@csrf_exempt
def chat_stream(request: HttpRequest):
    ensure_defaults()
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)

    data = parse_json(request)
    prompt = data.get("message") or ""
    mode = data.get("mode") or "instant"
    model_name = data.get("model") or selected_model_name()
    attachments = data.get("attachments") or []
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

    selected = ModelRegistry.objects.filter(name=model_name).first()
    system_prompt = selected.system_prompt if selected else ""

    def generate():
        content = ""
        token_count = 0
        try:
            yield sse(
                "meta",
                {
                    "chatId": str(chat.id),
                    "userMessageId": str(user_msg.id),
                    "assistantMessageId": str(assistant.id),
                    "ts": timezone.localtime(assistant.created_at).strftime("%H:%M:%S"),
                },
            )

            use_llamacpp = settings.TTD_MODEL_BACKEND in {"llamacpp", "llama.cpp"} and not wants_file(prompt) and not wants_image(prompt)
            if use_llamacpp:
                for token in stream_llamacpp(prompt, mode, model_name, system_prompt):
                    content += token
                    token_count += max(1, len(token.split()))
                    yield sse("token", {"text": token})
            else:
                public_image_base = request.build_absolute_uri(f"{settings.MEDIA_URL}generated/images/")
                draft = build_local_draft(prompt, mode, model_name, public_image_base, len(attachments))
                if draft.thinking:
                    assistant.thinking = draft.thinking
                    yield sse("thinking", {"text": draft.thinking})
                for token in chunk_text(draft.content):
                    content += token
                    yield sse("token", {"text": token})
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

            elapsed = max(0.001, time.monotonic() - started)
            assistant.content = content
            assistant.total_tokens = token_count
            assistant.tokens_per_sec = token_count / elapsed
            assistant.save()

            log.status = "success"
            log.response = content
            log.tokens = token_count
            log.latency_ms = int(elapsed * 1000)
            log.save()

            chat.save(update_fields=["updated_at"])
            saved = Message.objects.prefetch_related("attachments", "generated_files").get(id=assistant.id)
            yield sse("done", {"message": message_to_dict(saved), "chat": chat_to_summary(chat)})
        except Exception as exc:
            elapsed = max(0.001, time.monotonic() - started)
            log.status = "error"
            log.error_details = str(exc)
            log.latency_ms = int(elapsed * 1000)
            log.save()
            assistant.content = content or "Generation failed."
            assistant.test_passed = False
            assistant.test_output = str(exc)
            assistant.save()
            yield sse("error", {"error": str(exc)})

    response = StreamingHttpResponse(generate(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response


def selected_model_name() -> str:
    ensure_defaults()
    selected = ModelRegistry.objects.filter(selected=True).first()
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
    if request.method == "GET":
        models = [model_to_dict(model) for model in ModelRegistry.objects.all()]
        return json_response({"ok": True, "models": models})
    return json_response({"ok": False, "error": "Method not allowed"}, status=405)


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

    local_path = ""
    status = "ready"
    size = "-"
    if data.get("download") or str(getattr(settings, "TTD_ALLOW_HF_DOWNLOAD", "0")) == "1":
        try:
            from huggingface_hub import hf_hub_download

            local_path = hf_hub_download(repo_id=repo_id, filename=filename, local_dir=settings.TTD_MODEL_DIR)
            size = file_size_label(local_path)
        except Exception as exc:
            status = "error"
            local_path = str(exc)

    model = ModelRegistry.objects.create(
        name=filename.replace(".gguf", ""),
        repo_id=repo_id,
        filename=filename,
        model_type=model_type,
        quantization=quantization,
        status=status,
        size=size,
        vram="-",
        download_progress=100 if status == "ready" else 0,
        local_path=local_path,
    )
    log_admin_action(request, f"Installed model registry entry: {model.name}", session)
    return json_response({"ok": True, "model": model_to_dict(model)}, status=201)


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
        ModelRegistry.objects.exclude(id=model.id).update(selected=False)
        model.selected = True
    elif action == "deselect":
        model.selected = False
    elif action == "hide":
        model.hidden = True
    elif action == "show":
        model.hidden = False
    elif action == "delete":
        name = model.name
        model.delete()
        log_admin_action(request, f"Deleted model: {name}", session)
        return json_response({"ok": True})
    elif action == "prompt":
        model.system_prompt = data.get("prompt") or ""
    elif action == "reload":
        model.status = "ready"
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
    selected = ModelRegistry.objects.filter(selected=True).first()
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


@csrf_exempt
def admin_login(request: HttpRequest):
    ensure_defaults()
    if request.method != "POST":
        return json_response({"ok": False, "error": "Method not allowed"}, status=405)
    data = parse_json(request)
    password = data.get("password") or ""
    setting = AdminSetting.objects.filter(key="admin_password").first()
    if not setting or not check_password(password, setting.value):
        RequestLog.objects.create(
            ip=client_ip(request),
            user_agent=user_agent(request),
            model="admin",
            mode="auth",
            query="admin login",
            response="",
            status="error",
            error_details="Invalid admin password",
        )
        return json_response({"ok": False, "error": "Invalid credentials"}, status=401)

    session = AdminSession.objects.create(token=make_token(), ip=client_ip(request), user_agent=user_agent(request))
    log_admin_action(request, "Authenticated successfully", session)
    return json_response({"ok": True, "token": session.token, "session": session_to_dict(session)})


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


def admin_sessions(request: HttpRequest):
    session, error = require_admin(request)
    if error:
        return error
    log_admin_action(request, "Viewed Sessions tab", session)
    sessions = [session_to_dict(item) for item in AdminSession.objects.prefetch_related("actions").all()[:250]]
    return json_response({"ok": True, "sessions": sessions})


def file_size_label(path: str) -> str:
    try:
        size = settings.TTD_MODEL_DIR.joinpath(path).stat().st_size if not path.startswith("/") else __import__("pathlib").Path(path).stat().st_size
    except OSError:
        return "-"
    gb = size / (1024 ** 3)
    if gb >= 1:
        return f"{gb:.2f}GB"
    return f"{size / (1024 ** 2):.1f}MB"
