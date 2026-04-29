from __future__ import annotations

import json
import secrets
from datetime import datetime
from typing import Any

from django.conf import settings
from django.http import HttpRequest, JsonResponse
from django.utils import timezone

from .models import AdminAction, AdminSession


def parse_json(request: HttpRequest) -> dict[str, Any]:
    if not request.body:
        return {}
    return json.loads(request.body.decode("utf-8"))


def json_response(payload: dict[str, Any], status: int = 200) -> JsonResponse:
    return JsonResponse(payload, status=status, json_dumps_params={"ensure_ascii": False})


def client_ip(request: HttpRequest) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR") or "127.0.0.1"


def user_agent(request: HttpRequest) -> str:
    return request.headers.get("User-Agent", "")


def now_label(value: datetime | None = None) -> str:
    value = value or timezone.now()
    return timezone.localtime(value).strftime("%Y-%m-%d %H:%M:%S")


def time_label(value: datetime | None = None) -> str:
    value = value or timezone.now()
    return timezone.localtime(value).strftime("%H:%M:%S")


def bearer_token(request: HttpRequest) -> str:
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return ""


def require_admin(request: HttpRequest) -> tuple[AdminSession | None, JsonResponse | None]:
    token = bearer_token(request)
    if not token:
        return None, json_response({"ok": False, "error": "Missing admin token"}, status=401)
    session = AdminSession.objects.filter(token=token, status="active").first()
    if not session:
        return None, json_response({"ok": False, "error": "Admin session expired"}, status=401)
    ttl = int(getattr(settings, "TTD_ADMIN_SESSION_TTL_SECONDS", 86400))
    if ttl > 0 and (timezone.now() - session.login_time).total_seconds() > ttl:
        session.status = "ended"
        session.logout_time = timezone.now()
        session.save(update_fields=["status", "logout_time", "updated_at"])
        return None, json_response({"ok": False, "error": "Admin session expired"}, status=401)
    return session, None


def make_token() -> str:
    return secrets.token_urlsafe(48)


def log_admin_action(request: HttpRequest, action: str, session: AdminSession | None = None) -> None:
    AdminAction.objects.create(session=session, ip=client_ip(request), action=action)


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
