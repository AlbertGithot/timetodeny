from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from typing import Iterator


class GenerationStopped(RuntimeError):
    pass


_generation_lock = threading.Lock()
_stop_event = threading.Event()
_state_lock = threading.Lock()
_current: dict[str, object] = {"chat_id": None, "started_at": None, "queued_at": None}


def queue_status() -> dict:
    now = time.monotonic()
    with _state_lock:
        started_at = _current.get("started_at")
        queued_at = _current.get("queued_at")
        busy = _generation_lock.locked()
        return {
            "busy": busy,
            "currentChatId": _current.get("chat_id"),
            "startedAt": started_at,
            "queuedAt": queued_at,
            "startedSecondsAgo": max(0.0, now - started_at) if isinstance(started_at, (int, float)) else 0.0,
            "queuedSecondsAgo": max(0.0, now - queued_at) if isinstance(queued_at, (int, float)) else 0.0,
        }


def request_generation_stop() -> None:
    _stop_event.set()


def clear_generation_stop() -> None:
    _stop_event.clear()


def generation_stop_requested() -> bool:
    return _stop_event.is_set()


def raise_if_generation_stopped() -> None:
    if generation_stop_requested():
        raise GenerationStopped("Generation stopped by user")


@contextmanager
def generation_slot(chat_id: str) -> Iterator[dict[str, float | bool]]:
    queued = _generation_lock.locked()
    queued_at = time.monotonic()
    with _state_lock:
        _current["queued_at"] = queued_at if queued else None

    _generation_lock.acquire()
    started_at = time.monotonic()
    clear_generation_stop()
    with _state_lock:
        _current["chat_id"] = chat_id
        _current["started_at"] = started_at
        _current["queued_at"] = None

    try:
        yield {"queued": queued, "waitSeconds": max(0.0, started_at - queued_at)}
    finally:
        with _state_lock:
            _current["chat_id"] = None
            _current["started_at"] = None
            _current["queued_at"] = None
        clear_generation_stop()
        _generation_lock.release()
