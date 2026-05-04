from __future__ import annotations

from collections import Counter
from html import escape
from typing import Iterable, Sequence


MODES = {"preview", "sample", "full"}

FORCED_DENY_TAGS = {
    "ageplay",
    "baby",
    "child",
    "childlike",
    "cub",
    "kid",
    "lolicon",
    "loli",
    "minor",
    "preteen",
    "shotacon",
    "shota",
    "toddler",
    "underage",
    "young",
}

DEFAULT_NEGATIVE_TAGS = {
    "guro",
    "scat",
}


def normalize_tag(tag: str) -> str:
    return tag.strip().strip(",").lower()


def parse_tags(raw: str | None) -> list[str]:
    if not raw:
        return []
    tags: list[str] = []
    for part in raw.replace(",", " ").replace("\n", " ").split():
        tag = normalize_tag(part)
        if tag:
            tags.append(tag)
    return tags


def unique_preserve_order(tags: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for tag in tags:
        if tag and tag not in seen:
            seen.add(tag)
            result.append(tag)
    return result


def positive_tag_name(tag: str) -> str:
    return tag[1:] if tag.startswith("-") else tag


def strip_minus(tags: Iterable[str]) -> list[str]:
    return [positive_tag_name(tag) for tag in tags if positive_tag_name(tag)]


def effective_tags(user_tags: Sequence[str], blacklist: Sequence[str], safe_mode: bool) -> list[str]:
    tags = [tag for tag in user_tags if positive_tag_name(tag) not in FORCED_DENY_TAGS]

    if safe_mode:
        tags = [tag for tag in tags if not tag.startswith("rating:")]
        tags.append("rating:safe")

    negative_tags = set(DEFAULT_NEGATIVE_TAGS) | set(blacklist) | FORCED_DENY_TAGS
    for tag in sorted(negative_tags):
        tag = positive_tag_name(normalize_tag(tag))
        if tag:
            tags.append(f"-{tag}")

    return unique_preserve_order(tags)


def cache_key(tags: Sequence[str], pid: int = 0) -> str:
    positives = sorted(tag for tag in tags if not tag.startswith("-"))
    negatives = sorted(tag for tag in tags if tag.startswith("-"))
    return " ".join(positives + negatives) + f" pid:{pid}"


def post_has_blocked_tag(post_tags: Sequence[str], blocked: Sequence[str]) -> bool:
    names = {positive_tag_name(tag) for tag in blocked}
    return bool(set(post_tags) & names)


def is_safe_rating(rating: str | None) -> bool:
    value = (rating or "").lower()
    return value in {"s", "safe", "rating:safe"}


def filter_posts(posts, blacklist: Sequence[str], safe_mode: bool, exclude_ids: Iterable[int] = ()):
    blocked = set(strip_minus(blacklist)) | DEFAULT_NEGATIVE_TAGS | FORCED_DENY_TAGS
    excluded = {int(post_id) for post_id in exclude_ids}
    filtered = []
    for post in posts:
        if post.id in excluded:
            continue
        if safe_mode and not is_safe_rating(post.rating):
            continue
        if post_has_blocked_tag(post.tags, blocked):
            continue
        if not post.image_url:
            continue
        filtered.append(post)
    return filtered


def collect_related_tags(posts, seed_tags: Sequence[str], limit: int = 30) -> list[str]:
    seed = set(strip_minus(seed_tags))
    counter: Counter[str] = Counter()
    for post in posts:
        counter.update(tag for tag in post.tags if tag not in seed and tag not in FORCED_DENY_TAGS)
    return [tag for tag, _ in counter.most_common(limit)]


def short_tags(tags: Sequence[str], limit: int = 20) -> str:
    selected = list(tags[:limit])
    suffix = " ..." if len(tags) > limit else ""
    return " ".join(selected) + suffix


def html_code(text: str) -> str:
    return f"<code>{escape(text)}</code>"


def html_bold(text: str) -> str:
    return f"<b>{escape(text)}</b>"
