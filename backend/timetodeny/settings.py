from __future__ import annotations

import os
import secrets
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent

def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
    raw = os.environ.get(name)
    try:
        value = int(raw) if raw not in {None, ""} else default
    except ValueError:
        value = default
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def default_secret_key() -> str:
    secret_path = Path(os.environ.get("DJANGO_SECRET_KEY_FILE", PROJECT_ROOT / ".runtime" / "state" / "django_secret_key"))
    try:
        if secret_path.exists():
            saved = secret_path.read_text(encoding="utf-8").strip()
            if len(saved) >= 50:
                return saved
        secret_path.parent.mkdir(parents=True, exist_ok=True)
        generated = secrets.token_urlsafe(64)
        secret_path.write_text(generated, encoding="utf-8")
        return generated
    except OSError:
        return secrets.token_urlsafe(64)


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY") or default_secret_key()
DEBUG = env_bool("DJANGO_DEBUG", True)

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost").split(",")
    if host.strip()
]

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "core",
]

MIDDLEWARE = [
    "core.middleware.SimpleCorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "timetodeny.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

WSGI_APPLICATION = "timetodeny.wsgi.application"

if os.environ.get("MYSQL_DATABASE"):
    try:
        import pymysql

        pymysql.install_as_MySQLdb()
    except ImportError:
        pass

    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.mysql",
            "NAME": os.environ["MYSQL_DATABASE"],
            "USER": os.environ.get("MYSQL_USER", "root"),
            "PASSWORD": os.environ.get("MYSQL_PASSWORD", ""),
            "HOST": os.environ.get("MYSQL_HOST", "127.0.0.1"),
            "PORT": os.environ.get("MYSQL_PORT", "3306"),
            "OPTIONS": {"charset": "utf8mb4"},
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BACKEND_DIR / "db.sqlite3",
        }
    }

LANGUAGE_CODE = "en-us"
TIME_ZONE = os.environ.get("DJANGO_TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(os.environ.get("TTD_MEDIA_ROOT", BACKEND_DIR / "media"))
TTD_FRONTEND_BUILD_ROOT = Path(os.environ.get("TTD_FRONTEND_BUILD_ROOT", PROJECT_ROOT / "frontend" / "out"))
TTD_FRONTEND_DIR = Path(os.environ.get("TTD_FRONTEND_DIR", PROJECT_ROOT / "frontend"))
TTD_AUTO_BUILD_FRONTEND = env_bool("TTD_AUTO_BUILD_FRONTEND", True)
TTD_FRONTEND_BUILD_TIMEOUT_SECONDS = env_int("TTD_FRONTEND_BUILD_TIMEOUT_SECONDS", 240, minimum=1)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

TTD_FRONTEND_ORIGIN = os.environ.get("TTD_FRONTEND_ORIGIN", "http://127.0.0.1:8000")
TTD_MODEL_BACKEND = os.environ.get("TTD_MODEL_BACKEND", "mock").lower()
TTD_LLAMA_CPP_URL = os.environ.get("TTD_LLAMA_CPP_URL", "http://127.0.0.1:8080")
TTD_LLAMA_CPP_N_PREDICT = env_int("TTD_LLAMA_CPP_N_PREDICT", 0, minimum=0)
TTD_LLAMA_CPP_CTX_SIZE = env_int("TTD_LLAMA_CPP_CTX_SIZE", 8192, minimum=1)
TTD_LLAMA_READY_TIMEOUT_SECONDS = env_int("TTD_LLAMA_READY_TIMEOUT_SECONDS", 180, minimum=1)
TTD_MODEL_DIR = Path(os.environ.get("TTD_MODEL_DIR", PROJECT_ROOT / "models"))
TTD_GENERATED_DIR = Path(os.environ.get("TTD_GENERATED_DIR", MEDIA_ROOT / "generated"))
TTD_REQUEST_TIMEOUT_SECONDS = env_int("TTD_REQUEST_TIMEOUT_SECONDS", 900, minimum=1)
TTD_ALLOW_HF_DOWNLOAD = os.environ.get("TTD_ALLOW_HF_DOWNLOAD", "1")
TTD_MAX_PROMPT_CHARS = env_int("TTD_MAX_PROMPT_CHARS", 0, minimum=0)
TTD_MAX_ATTACHMENTS = env_int("TTD_MAX_ATTACHMENTS", 0, minimum=0)
TTD_MAX_ATTACHMENT_CHARS = env_int("TTD_MAX_ATTACHMENT_CHARS", 0, minimum=0)
TTD_CHAT_CONTEXT_MESSAGES = env_int("TTD_CHAT_CONTEXT_MESSAGES", 12, minimum=0)
TTD_ADMIN_SESSION_TTL_SECONDS = env_int("TTD_ADMIN_SESSION_TTL_SECONDS", 86400, minimum=60)
TTD_LOGIN_RATE_LIMIT_ATTEMPTS = env_int("TTD_LOGIN_RATE_LIMIT_ATTEMPTS", 5, minimum=1)
TTD_LOGIN_RATE_LIMIT_WINDOW_SECONDS = env_int("TTD_LOGIN_RATE_LIMIT_WINDOW_SECONDS", 300, minimum=1)
TTD_WORKSPACE_MAX_FILE_BYTES = env_int("TTD_WORKSPACE_MAX_FILE_BYTES", 0, minimum=0)
TTD_LOG_TAIL_LINES = env_int("TTD_LOG_TAIL_LINES", 120, minimum=1)
