from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .api import Post


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.RLock()

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def init(self) -> None:
        with self._lock, self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY,
                    mode TEXT NOT NULL DEFAULT 'sample',
                    safe_mode INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    tags TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_history_user_created ON history(user_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS favorites (
                    user_id INTEGER NOT NULL,
                    post_id INTEGER NOT NULL,
                    post_json TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(user_id, post_id),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites(user_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS blacklist (
                    user_id INTEGER NOT NULL,
                    tag TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(user_id, tag),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS recent_posts (
                    user_id INTEGER NOT NULL,
                    post_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(user_id, post_id),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_recent_user_created ON recent_posts(user_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS search_sessions (
                    chat_id INTEGER NOT NULL,
                    message_id INTEGER NOT NULL,
                    tags TEXT NOT NULL,
                    sent_post_ids TEXT NOT NULL,
                    current_post_json TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(chat_id, message_id)
                );
                """
            )

    def ensure_user(self, user_id: int, *, safe_default: bool = True) -> None:
        with self._lock, self.connect() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO users(id, safe_mode) VALUES(?, ?)",
                (user_id, 1 if safe_default else 0),
            )

    def get_user(self, user_id: int, *, safe_default: bool = True) -> dict[str, Any]:
        self.ensure_user(user_id, safe_default=safe_default)
        with self._lock, self.connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return {
            "id": int(row["id"]),
            "mode": row["mode"],
            "safe_mode": bool(row["safe_mode"]),
        }

    def set_mode(self, user_id: int, mode: str, *, safe_default: bool = True) -> None:
        self.ensure_user(user_id, safe_default=safe_default)
        with self._lock, self.connect() as conn:
            conn.execute(
                "UPDATE users SET mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (mode, user_id),
            )

    def set_safe_mode(self, user_id: int, enabled: bool, *, safe_default: bool = True) -> None:
        self.ensure_user(user_id, safe_default=safe_default)
        with self._lock, self.connect() as conn:
            conn.execute(
                "UPDATE users SET safe_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (1 if enabled else 0, user_id),
            )

    def reset_user(self, user_id: int, *, safe_default: bool = True) -> None:
        with self._lock, self.connect() as conn:
            conn.execute("DELETE FROM history WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM favorites WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM blacklist WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM recent_posts WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM search_sessions WHERE chat_id = ?", (user_id,))
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        self.ensure_user(user_id, safe_default=safe_default)

    def add_history(self, user_id: int, tags: str, limit: int, *, safe_default: bool = True) -> None:
        self.ensure_user(user_id, safe_default=safe_default)
        with self._lock, self.connect() as conn:
            conn.execute("INSERT INTO history(user_id, tags) VALUES(?, ?)", (user_id, tags))
            conn.execute(
                """
                DELETE FROM history
                WHERE id IN (
                    SELECT id FROM history
                    WHERE user_id = ?
                    ORDER BY created_at DESC, id DESC
                    LIMIT -1 OFFSET ?
                )
                """,
                (user_id, limit),
            )

    def get_history(self, user_id: int, limit: int) -> list[str]:
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                "SELECT tags FROM history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
        return [str(row["tags"]) for row in rows]

    def add_blacklist_tags(self, user_id: int, tags: list[str], *, safe_default: bool = True) -> None:
        self.ensure_user(user_id, safe_default=safe_default)
        with self._lock, self.connect() as conn:
            conn.executemany(
                "INSERT OR IGNORE INTO blacklist(user_id, tag) VALUES(?, ?)",
                [(user_id, tag) for tag in tags],
            )

    def remove_blacklist_tags(self, user_id: int, tags: list[str]) -> None:
        with self._lock, self.connect() as conn:
            conn.executemany(
                "DELETE FROM blacklist WHERE user_id = ? AND tag = ?",
                [(user_id, tag) for tag in tags],
            )

    def get_blacklist(self, user_id: int) -> list[str]:
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                "SELECT tag FROM blacklist WHERE user_id = ? ORDER BY tag",
                (user_id,),
            ).fetchall()
        return [str(row["tag"]) for row in rows]

    def add_recent(self, user_id: int, post_id: int, limit: int, *, safe_default: bool = True) -> None:
        self.ensure_user(user_id, safe_default=safe_default)
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                INSERT INTO recent_posts(user_id, post_id, created_at)
                VALUES(?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, post_id) DO UPDATE SET created_at = CURRENT_TIMESTAMP
                """,
                (user_id, post_id),
            )
            conn.execute(
                """
                DELETE FROM recent_posts
                WHERE rowid IN (
                    SELECT rowid FROM recent_posts
                    WHERE user_id = ?
                    ORDER BY created_at DESC
                    LIMIT -1 OFFSET ?
                )
                """,
                (user_id, limit),
            )

    def get_recent_ids(self, user_id: int, limit: int) -> set[int]:
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                "SELECT post_id FROM recent_posts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
        return {int(row["post_id"]) for row in rows}

    def add_favorite(self, user_id: int, post: Post, *, safe_default: bool = True) -> None:
        self.ensure_user(user_id, safe_default=safe_default)
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                INSERT INTO favorites(user_id, post_id, post_json, created_at)
                VALUES(?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, post_id) DO UPDATE SET
                    post_json = excluded.post_json,
                    created_at = CURRENT_TIMESTAMP
                """,
                (user_id, post.id, json.dumps(post.as_json(), ensure_ascii=False)),
            )

    def get_favorites(self, user_id: int, limit: int) -> list[Post]:
        with self._lock, self.connect() as conn:
            rows = conn.execute(
                "SELECT post_json FROM favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
        return [Post.from_json(json.loads(row["post_json"])) for row in rows]

    def get_favorite(self, user_id: int, post_id: int) -> Post | None:
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT post_json FROM favorites WHERE user_id = ? AND post_id = ?",
                (user_id, post_id),
            ).fetchone()
        return Post.from_json(json.loads(row["post_json"])) if row else None

    def save_session(self, chat_id: int, message_id: int, tags: str, sent_ids: list[int], post: Post) -> None:
        with self._lock, self.connect() as conn:
            conn.execute(
                """
                INSERT INTO search_sessions(chat_id, message_id, tags, sent_post_ids, current_post_json, updated_at)
                VALUES(?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(chat_id, message_id) DO UPDATE SET
                    tags = excluded.tags,
                    sent_post_ids = excluded.sent_post_ids,
                    current_post_json = excluded.current_post_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    chat_id,
                    message_id,
                    tags,
                    json.dumps(sent_ids),
                    json.dumps(post.as_json(), ensure_ascii=False),
                ),
            )

    def get_session(self, chat_id: int, message_id: int) -> dict[str, Any] | None:
        with self._lock, self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM search_sessions WHERE chat_id = ? AND message_id = ?",
                (chat_id, message_id),
            ).fetchone()
        if not row:
            return None
        return {
            "tags": str(row["tags"]),
            "sent_ids": [int(value) for value in json.loads(row["sent_post_ids"] or "[]")],
            "post": Post.from_json(json.loads(row["current_post_json"])),
        }

