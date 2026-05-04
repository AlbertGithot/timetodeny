from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, Sequence
from urllib.parse import urlparse

import requests

from .utils import cache_key, parse_tags, short_tags


class DapiError(RuntimeError):
    pass


@dataclass(frozen=True)
class Post:
    id: int
    tags: tuple[str, ...]
    rating: str
    preview_url: str
    sample_url: str
    file_url: str
    source: str
    score: int
    raw: dict[str, Any]

    @classmethod
    def from_api(cls, item: dict[str, Any]) -> "Post":
        post_id = int(item.get("id") or 0)
        tags = tuple(parse_tags(str(item.get("tags") or "")))
        return cls(
            id=post_id,
            tags=tags,
            rating=str(item.get("rating") or ""),
            preview_url=normalize_url(str(item.get("preview_url") or "")),
            sample_url=normalize_url(str(item.get("sample_url") or "")),
            file_url=normalize_url(str(item.get("file_url") or "")),
            source=str(item.get("source") or ""),
            score=safe_int(item.get("score"), 0),
            raw=dict(item),
        )

    @classmethod
    def from_json(cls, item: dict[str, Any]) -> "Post":
        return cls(
            id=int(item["id"]),
            tags=tuple(item.get("tags") or ()),
            rating=str(item.get("rating") or ""),
            preview_url=str(item.get("preview_url") or ""),
            sample_url=str(item.get("sample_url") or ""),
            file_url=str(item.get("file_url") or ""),
            source=str(item.get("source") or ""),
            score=safe_int(item.get("score"), 0),
            raw=dict(item.get("raw") or {}),
        )

    @property
    def image_url(self) -> str:
        return self.sample_url or self.preview_url or self.file_url

    def url_for_mode(self, mode: str) -> str:
        if mode == "preview":
            return self.preview_url or self.sample_url or self.file_url
        if mode == "full":
            return self.file_url or self.sample_url or self.preview_url
        return self.sample_url or self.preview_url or self.file_url

    def as_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tags": list(self.tags),
            "rating": self.rating,
            "preview_url": self.preview_url,
            "sample_url": self.sample_url,
            "file_url": self.file_url,
            "source": self.source,
            "score": self.score,
            "raw": self.raw,
        }

    def caption(self, mode: str) -> str:
        return f"post #{self.id} · rating: {self.rating or '-'} · mode: {mode}\n{short_tags(self.tags, 16)}"


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def normalize_url(value: str) -> str:
    if not value:
        return ""
    if value.startswith("//"):
        return f"https:{value}"
    parsed = urlparse(value)
    if parsed.scheme:
        return value
    return f"https://{value.lstrip('/')}"


class DapiClient:
    def __init__(
        self,
        base_url: str,
        *,
        limit: int = 100,
        request_delay_seconds: float = 1.0,
        cache_ttl_seconds: int = 300,
    ) -> None:
        self.base_url = base_url
        self.limit = limit
        self.request_delay_seconds = request_delay_seconds
        self.cache_ttl_seconds = cache_ttl_seconds
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "TimeToDenyTelegramBot/1.0"})
        self._cache: dict[str, tuple[float, list[Post]]] = {}
        self._lock = threading.Lock()
        self._last_request = 0.0

    def search(self, tags: Sequence[str] | str, *, pid: int = 0, limit: int | None = None) -> list[Post]:
        tag_list = parse_tags(tags) if isinstance(tags, str) else list(tags)
        search_limit = limit or self.limit
        key = f"{cache_key(tag_list, pid)} limit:{search_limit}"
        now = time.monotonic()
        with self._lock:
            cached = self._cache.get(key)
            if cached and self.cache_ttl_seconds > 0 and now - cached[0] <= self.cache_ttl_seconds:
                return list(cached[1])

            wait = self.request_delay_seconds - (now - self._last_request)
            if wait > 0:
                time.sleep(wait)
            self._last_request = time.monotonic()

        params = {
            "page": "dapi",
            "s": "post",
            "q": "index",
            "json": "1",
            "tags": " ".join(tag_list),
            "limit": str(search_limit),
            "pid": str(max(0, pid)),
        }
        try:
            response = self.session.get(self.base_url, params=params, timeout=20)
            response.raise_for_status()
            data = response.json()
        except requests.RequestException as exc:
            raise DapiError("service unavailable") from exc
        except ValueError as exc:
            raise DapiError("invalid api response") from exc

        posts = self._parse_posts(data)
        with self._lock:
            self._cache[key] = (time.monotonic(), posts)
        return list(posts)

    def _parse_posts(self, data: Any) -> list[Post]:
        if isinstance(data, list):
            raw_posts = data
        elif isinstance(data, dict):
            raw_posts = data.get("post") or data.get("posts") or []
        else:
            raw_posts = []

        posts = []
        for item in raw_posts:
            if not isinstance(item, dict):
                continue
            post = Post.from_api(item)
            if post.id:
                posts.append(post)
        return posts
