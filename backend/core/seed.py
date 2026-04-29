from __future__ import annotations

from django.contrib.auth.hashers import make_password
from django.db import connection
from django.db.utils import OperationalError, ProgrammingError


DEFAULT_PROMPT = (
    "You are TTD, a local AI coding assistant. Stream answers, create requested files, "
    "show generated content, and report test results clearly. Always answer in the same "
    "language as the user's latest message. If the user writes in Russian, answer in Russian."
)


def _tables_ready() -> bool:
    try:
        tables = set(connection.introspection.table_names())
    except (OperationalError, ProgrammingError):
        return False
    return "core_adminsetting" in tables


def ensure_defaults() -> None:
    if not _tables_ready():
        return

    from .models import AdminSetting

    AdminSetting.objects.get_or_create(
        key="admin_password",
        defaults={"value": make_password("1111")},
    )
