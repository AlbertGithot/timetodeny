from __future__ import annotations

from django.contrib.auth.hashers import make_password
from django.db import connection
from django.db.utils import OperationalError, ProgrammingError


DEFAULT_PROMPT = (
    "You are TTD, a local AI coding assistant. Stream answers, create requested files, "
    "show generated content, and report test results clearly."
)


def _tables_ready() -> bool:
    try:
        tables = set(connection.introspection.table_names())
    except (OperationalError, ProgrammingError):
        return False
    return {"core_adminsetting", "core_modelregistry"}.issubset(tables)


def ensure_defaults() -> None:
    if not _tables_ready():
        return

    from .models import AdminSetting, ModelRegistry

    AdminSetting.objects.get_or_create(
        key="admin_password",
        defaults={"value": make_password("1111")},
    )

    defaults = [
        {
            "name": "deepseek-r1:14b",
            "repo_id": "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B-GGUF",
            "filename": "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf",
            "model_type": "text",
            "size": "8.99GB",
            "status": "ready",
            "vram": "9.2GB",
            "selected": True,
            "system_prompt": DEFAULT_PROMPT,
            "quantization": "Q4_K_M",
        },
        {
            "name": "qwen2.5-coder:7b",
            "repo_id": "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
            "filename": "qwen2.5-coder-7b-instruct-q5_k_m.gguf",
            "model_type": "code",
            "size": "5.09GB",
            "status": "ready",
            "vram": "5.1GB",
            "selected": False,
            "system_prompt": "You are a code-focused local assistant. Prefer runnable, tested code.",
            "quantization": "Q5_K_M",
        },
        {
            "name": "flux-dev",
            "repo_id": "black-forest-labs/FLUX.1-dev-gguf",
            "filename": "flux1-dev-Q8_0.gguf",
            "model_type": "vision",
            "size": "15.6GB",
            "status": "ready",
            "vram": "7.8GB",
            "selected": False,
            "system_prompt": "",
            "quantization": "Q8_0",
        },
    ]

    for item in defaults:
        if not ModelRegistry.objects.filter(name=item["name"]).exists():
            ModelRegistry.objects.create(**item)
