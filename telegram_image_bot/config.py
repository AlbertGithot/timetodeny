from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_float(name: str, default: float, minimum: float | None = None) -> float:
    raw = os.environ.get(name)
    try:
        value = float(raw) if raw not in {None, ""} else default
    except ValueError:
        value = default
    if minimum is not None:
        value = max(minimum, value)
    return value


def env_int(name: str, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
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


def env_list(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    return [item.strip() for item in raw.split(",") if item.strip()]


def env_int_set(name: str) -> set[int]:
    values: set[int] = set()
    for item in env_list(name):
        try:
            values.add(int(item))
        except ValueError:
            continue
    return values


@dataclass(frozen=True)
class BotConfig:
    token: str
    db_path: Path
    whitelist_chat_ids: set[int]
    dapi_url: str
    api_limit: int
    api_delay_seconds: float
    cache_ttl_seconds: int
    recent_limit: int
    history_limit: int
    favorite_limit: int
    feed_interval_seconds: int
    safe_default: bool
    random_tags: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "BotConfig":
        token = os.environ.get("TG_BOT_TOKEN") or os.environ.get("TELEGRAM_BOT_TOKEN") or os.environ.get("BOT_TOKEN")
        if not token:
            raise RuntimeError("TG_BOT_TOKEN is required")

        return cls(
            token=token,
            db_path=Path(os.environ.get("TG_BOT_DB", ROOT_DIR / "bot_data" / "bot.sqlite3")),
            whitelist_chat_ids=env_int_set("TG_BOT_WHITELIST"),
            dapi_url=os.environ.get(
                "DAPI_URL",
                "https://rule34.xxx/index.php",
            ),
            api_limit=env_int("DAPI_LIMIT", 100, minimum=1, maximum=1000),
            api_delay_seconds=env_float("DAPI_DELAY_SECONDS", 1.0, minimum=0.0),
            cache_ttl_seconds=env_int("DAPI_CACHE_TTL_SECONDS", 300, minimum=0),
            recent_limit=env_int("TG_BOT_RECENT_LIMIT", 60, minimum=1),
            history_limit=env_int("TG_BOT_HISTORY_LIMIT", 20, minimum=1),
            favorite_limit=env_int("TG_BOT_FAVORITE_LIMIT", 50, minimum=1),
            feed_interval_seconds=env_int("TG_BOT_FEED_INTERVAL_SECONDS", 300, minimum=60),
            safe_default=env_bool("TG_BOT_SAFE_DEFAULT", True),
            random_tags=tuple(env_list("TG_BOT_RANDOM_TAGS")),
        )

