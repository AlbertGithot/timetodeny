from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-change-me")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"

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

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

TTD_FRONTEND_ORIGIN = os.environ.get("TTD_FRONTEND_ORIGIN", "http://127.0.0.1:4028")
TTD_MODEL_BACKEND = os.environ.get("TTD_MODEL_BACKEND", "mock").lower()
TTD_LLAMA_CPP_URL = os.environ.get("TTD_LLAMA_CPP_URL", "http://127.0.0.1:8080")
TTD_LLAMA_CPP_N_PREDICT = int(os.environ.get("TTD_LLAMA_CPP_N_PREDICT", "1024"))
TTD_LLAMA_CPP_CTX_SIZE = int(os.environ.get("TTD_LLAMA_CPP_CTX_SIZE", "8192"))
TTD_MODEL_DIR = Path(os.environ.get("TTD_MODEL_DIR", BACKEND_DIR / "models"))
TTD_GENERATED_DIR = Path(os.environ.get("TTD_GENERATED_DIR", MEDIA_ROOT / "generated"))
TTD_REQUEST_TIMEOUT_SECONDS = int(os.environ.get("TTD_REQUEST_TIMEOUT_SECONDS", "120"))
TTD_ALLOW_HF_DOWNLOAD = os.environ.get("TTD_ALLOW_HF_DOWNLOAD", "0")
