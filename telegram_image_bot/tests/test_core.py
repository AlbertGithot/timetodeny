from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from telegram_image_bot.api import Post
from telegram_image_bot.db import Database
from telegram_image_bot.utils import effective_tags, filter_posts, parse_tags


class UtilsTests(unittest.TestCase):
    def test_parse_tags_supports_minus_tags_and_commas(self) -> None:
        self.assertEqual(parse_tags("cat, dog -bad\nrating:safe"), ["cat", "dog", "-bad", "rating:safe"])

    def test_effective_tags_adds_safe_blacklist_and_forced_deny(self) -> None:
        tags = effective_tags(["cat", "rating:explicit", "loli"], ["dog"], safe_mode=True)
        self.assertIn("cat", tags)
        self.assertIn("rating:safe", tags)
        self.assertIn("-dog", tags)
        self.assertIn("-loli", tags)
        self.assertNotIn("rating:explicit", tags)
        self.assertNotIn("loli", tags)


class PostFilterTests(unittest.TestCase):
    def test_filter_posts_excludes_recent_blacklist_and_unsafe(self) -> None:
        safe = Post.from_api({"id": 1, "tags": "cat", "rating": "s", "sample_url": "//example.test/1.jpg"})
        blocked = Post.from_api({"id": 2, "tags": "dog", "rating": "s", "sample_url": "//example.test/2.jpg"})
        unsafe = Post.from_api({"id": 3, "tags": "cat", "rating": "e", "sample_url": "//example.test/3.jpg"})
        recent = Post.from_api({"id": 4, "tags": "cat", "rating": "s", "sample_url": "//example.test/4.jpg"})

        posts = filter_posts([safe, blocked, unsafe, recent], ["dog"], True, exclude_ids={4})
        self.assertEqual([post.id for post in posts], [1])


class DatabaseTests(unittest.TestCase):
    def test_settings_blacklist_favorites_and_sessions_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db = Database(Path(tmp) / "bot.sqlite3")
            db.init()
            db.ensure_user(123)
            db.set_mode(123, "full")
            db.set_safe_mode(123, False)
            self.assertEqual(db.get_user(123)["mode"], "full")
            self.assertFalse(db.get_user(123)["safe_mode"])

            db.add_blacklist_tags(123, ["dog"])
            self.assertEqual(db.get_blacklist(123), ["dog"])
            db.remove_blacklist_tags(123, ["dog"])
            self.assertEqual(db.get_blacklist(123), [])

            post = Post.from_api({"id": 99, "tags": "cat", "rating": "s", "sample_url": "//example.test/99.jpg"})
            db.add_favorite(123, post)
            self.assertEqual(db.get_favorites(123, 10)[0].id, 99)

            db.save_session(123, 456, "cat rating:safe", [99], post)
            session = db.get_session(123, 456)
            self.assertIsNotNone(session)
            self.assertEqual(session["post"].id, 99)


if __name__ == "__main__":
    unittest.main()

