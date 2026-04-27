from __future__ import annotations

from django.db.models import Count

from .models import AdminSession, Chat, GeneratedFile, Message, ModelRegistry, RequestLog
from .utils import now_label, time_label


def generated_file_to_dict(file: GeneratedFile) -> dict:
    return {
        "id": str(file.id),
        "name": file.name,
        "language": file.language or None,
        "content": file.content,
        "type": file.file_type,
    }


def message_to_dict(message: Message) -> dict:
    payload = {
        "id": str(message.id),
        "role": message.role,
        "content": message.content,
        "ts": time_label(message.created_at),
    }
    generation = message.metadata.get("generation") if isinstance(message.metadata, dict) else None
    if isinstance(generation, dict):
        payload["generation"] = {
            "status": generation.get("status") or "streaming",
            "phase": generation.get("phase") or "working",
            "activity": generation.get("activity") or "Модель работает над вашим запросом...",
            "progress": int(generation.get("progress") or 0),
        }
        if generation.get("status") == "streaming":
            payload["streaming"] = True
    if message.thinking:
        payload["thinking"] = message.thinking
        payload["thinkingVisible"] = False
    if message.tokens_per_sec is not None:
        payload["tokensPerSec"] = round(message.tokens_per_sec, 1)
    if message.total_tokens:
        payload["totalTokens"] = message.total_tokens
    attachments = [
        {
            "id": str(att.id),
            "name": att.name,
            "type": att.file_type,
            "size": att.size,
            "content": att.content,
        }
        for att in message.attachments.all()
    ]
    if attachments:
        payload["attachments"] = attachments
    generated = [generated_file_to_dict(file) for file in message.generated_files.all()]
    if generated:
        payload["generatedFiles"] = generated
    if message.test_passed is not None:
        payload["testResult"] = {"passed": message.test_passed, "output": message.test_output}
    return payload


def chat_to_summary(chat: Chat) -> dict:
    count = getattr(chat, "message_count", None)
    if count is None:
        count = chat.messages.count()
    return {
        "id": str(chat.id),
        "title": chat.title,
        "model": chat.active_model,
        "mode": chat.mode,
        "ts": now_label(chat.updated_at),
        "msgs": count,
    }


def chat_to_detail(chat: Chat) -> dict:
    return {
        **chat_to_summary(chat),
        "messages": [message_to_dict(msg) for msg in chat.messages.prefetch_related("attachments", "generated_files").all()],
    }


def model_to_dict(model: ModelRegistry) -> dict:
    return {
        "id": str(model.id),
        "name": model.name,
        "repoId": model.repo_id,
        "filename": model.filename,
        "type": model.model_type,
        "size": model.size,
        "status": model.status,
        "vram": model.vram,
        "selected": model.selected,
        "hidden": model.hidden,
        "systemPrompt": model.system_prompt,
        "quantization": model.quantization,
        "downloadProgress": model.download_progress,
        "localPath": model.local_path,
    }


def request_to_dict(entry: RequestLog) -> dict:
    latency = "-" if entry.status == "streaming" else f"{entry.latency_ms / 1000:.2f}s"
    return {
        "id": str(entry.id),
        "ip": entry.ip or "-",
        "ts": now_label(entry.created_at),
        "model": entry.model,
        "mode": entry.mode,
        "query": entry.query,
        "response": entry.response,
        "status": entry.status,
        "latency": latency,
        "tokens": entry.tokens,
        "errorDetails": entry.error_details or None,
    }


def session_to_dict(session: AdminSession) -> dict:
    return {
        "id": str(session.id),
        "ip": session.ip or "-",
        "loginTime": now_label(session.login_time),
        "logoutTime": now_label(session.logout_time) if session.logout_time else None,
        "status": session.status,
        "userAgent": session.user_agent,
        "actions": [f"{time_label(action.created_at)} - {action.action}" for action in session.actions.all()],
    }


def chat_queryset():
    return Chat.objects.annotate(message_count=Count("messages")).order_by("-updated_at")
