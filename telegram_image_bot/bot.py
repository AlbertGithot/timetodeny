from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from html import escape
from typing import Any, Awaitable, Callable
from urllib.parse import urlparse

from aiogram import BaseMiddleware, Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramBadRequest, TelegramNetworkError
from aiogram.filters import Command, CommandObject
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from .api import DapiClient, DapiError, Post
from .config import BotConfig
from .db import Database
from .utils import (
    MODES,
    collect_related_tags,
    effective_tags,
    html_code,
    parse_tags,
    positive_tag_name,
    short_tags,
    strip_minus,
    unique_preserve_order,
    filter_posts,
)


@dataclass
class RateLimiter:
    min_interval_seconds: float = 1.0
    _last_seen: dict[int, float] = field(default_factory=dict)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def wait(self, user_id: int) -> None:
        async with self._lock:
            now = time.monotonic()
            last = self._last_seen.get(user_id, 0.0)
            delay = self.min_interval_seconds - (now - last)
            if delay > 0:
                await asyncio.sleep(delay)
            self._last_seen[user_id] = time.monotonic()


@dataclass
class AppState:
    config: BotConfig
    db: Database
    api: DapiClient
    limiter: RateLimiter
    feed_tasks: dict[int, asyncio.Task] = field(default_factory=dict)


class AccessMiddleware(BaseMiddleware):
    def __init__(self, whitelist_chat_ids: set[int]) -> None:
        self.whitelist_chat_ids = whitelist_chat_ids

    async def __call__(
        self,
        handler: Callable[[Any, dict[str, Any]], Awaitable[Any]],
        event: Any,
        data: dict[str, Any],
    ) -> Any:
        if not self.whitelist_chat_ids:
            return await handler(event, data)

        chat_id = None
        if isinstance(event, Message):
            chat_id = event.chat.id
        elif isinstance(event, CallbackQuery) and event.message:
            chat_id = event.message.chat.id

        if chat_id in self.whitelist_chat_ids:
            return await handler(event, data)

        if isinstance(event, Message):
            await event.answer("Доступ закрыт. Chat ID не в whitelist.")
        elif isinstance(event, CallbackQuery):
            await event.answer("Доступ закрыт.", show_alert=True)
        return None


def keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Ещё", callback_data="next"),
                InlineKeyboardButton(text="❤️", callback_data="fav"),
                InlineKeyboardButton(text="Похожее", callback_data="similar"),
            ],
            [
                InlineKeyboardButton(text="Инфо", callback_data="info"),
                InlineKeyboardButton(text="Теги", callback_data="tags"),
            ],
        ]
    )


def favorite_keyboard(posts: list[Post]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=f"#{post.id} · {post.rating or '-'}", callback_data=f"favview:{post.id}")]
            for post in posts
        ]
    )


def build_caption(post: Post, mode: str) -> str:
    return (
        f"<b>post #{post.id}</b> · rating: <code>{escape(post.rating or '-')}</code> · "
        f"mode: <code>{escape(mode)}</code>\n"
        f"{html_code(short_tags(post.tags, 16))}"
    )


def media_kind(url: str) -> str:
    path = urlparse(url).path.lower()
    if path.endswith((".mp4", ".webm", ".mov", ".m4v")):
        return "video"
    if path.endswith((".gif", ".gifv")):
        return "animation"
    if path.endswith((".jpg", ".jpeg", ".png", ".webp")):
        return "photo"
    return "document"


async def send_post(bot: Bot, chat_id: int, post: Post, mode: str) -> Message:
    url = post.url_for_mode(mode)
    caption = build_caption(post, mode)
    kind = media_kind(url)
    try:
        if kind == "video":
            return await bot.send_video(chat_id, url, caption=caption, reply_markup=keyboard())
        if kind == "animation":
            return await bot.send_animation(chat_id, url, caption=caption, reply_markup=keyboard())
        if kind == "document":
            return await bot.send_document(chat_id, url, caption=caption, reply_markup=keyboard())
        return await bot.send_photo(chat_id, url, caption=caption, reply_markup=keyboard())
    except (TelegramBadRequest, TelegramNetworkError):
        fallback = post.sample_url or post.preview_url or post.file_url
        if fallback and fallback != url:
            return await bot.send_photo(chat_id, fallback, caption=caption, reply_markup=keyboard())
        raise


async def send_text(bot: Bot, chat_id: int, text: str, message: Message | None = None) -> Message:
    if message:
        return await message.answer(text)
    return await bot.send_message(chat_id, text)


async def search_and_send(
    app: AppState,
    bot: Bot,
    chat_id: int,
    raw_tags: str,
    *,
    message: Message | None = None,
    sent_ids: list[int] | None = None,
    add_history: bool = True,
) -> bool:
    user_tags = parse_tags(raw_tags)
    if not user_tags:
        await send_text(bot, chat_id, "Пустой запрос. Используй: /search tag1 tag2 -tag3", message)
        return False

    settings = app.db.get_user(chat_id, safe_default=app.config.safe_default)
    blacklist = app.db.get_blacklist(chat_id)
    query_tags = effective_tags(user_tags, blacklist, bool(settings["safe_mode"]))
    query_string = " ".join(query_tags)

    if add_history:
        app.db.add_history(chat_id, " ".join(user_tags), app.config.history_limit, safe_default=app.config.safe_default)

    await app.limiter.wait(chat_id)
    try:
        posts = await asyncio.to_thread(app.api.search, query_tags)
    except DapiError:
        await send_text(bot, chat_id, "Сервис временно недоступен. API опять решил прилечь.", message)
        return False

    recent_ids = app.db.get_recent_ids(chat_id, app.config.recent_limit)
    already_sent = set(sent_ids or [])
    filtered = filter_posts(posts, blacklist, bool(settings["safe_mode"]), recent_ids | already_sent)
    if not filtered:
        if posts:
            await send_text(bot, chat_id, "Новых постов по этим тегам нет. Всё найденное уже показывал или отфильтровал.", message)
        else:
            await send_text(bot, chat_id, "Ничего не найдено, попробуй другие теги.", message)
        return False

    post = random.choice(filtered)
    next_sent_ids = unique_preserve_order([*(sent_ids or []), post.id])
    app.db.add_recent(chat_id, post.id, app.config.recent_limit, safe_default=app.config.safe_default)

    sent_message = await send_post(bot, chat_id, post, str(settings["mode"]))
    app.db.save_session(chat_id, sent_message.message_id, query_string, next_sent_ids, post)
    return True


def session_from_callback(app: AppState, callback: CallbackQuery) -> dict[str, Any] | None:
    if not callback.message:
        return None
    return app.db.get_session(callback.message.chat.id, callback.message.message_id)


def build_router(app: AppState) -> Router:
    router = Router()
    router.message.outer_middleware(AccessMiddleware(app.config.whitelist_chat_ids))
    router.callback_query.outer_middleware(AccessMiddleware(app.config.whitelist_chat_ids))

    @router.message(Command("start", "help"))
    async def cmd_help(message: Message) -> None:
        app.db.ensure_user(message.chat.id, safe_default=app.config.safe_default)
        await message.answer(
            "Команды:\n"
            "/search <теги> — поиск\n"
            "/random — случайный поиск\n"
            "/mode preview|sample|full — качество\n"
            "/safe on|off — safe mode\n"
            "/blacklist_add <теги>, /blacklist_remove <теги>, /blacklist\n"
            "/fav — избранное\n"
            "/history — история\n"
            "/suggest <тег> — связанные теги\n"
            "/feed <теги> — авто-выдача, /feed off — стоп\n"
            "/reset — сброс настроек"
        )

    @router.message(Command("search"))
    async def cmd_search(message: Message, command: CommandObject) -> None:
        await search_and_send(app, message.bot, message.chat.id, command.args or "", message=message)

    @router.message(Command("random"))
    async def cmd_random(message: Message) -> None:
        tags = " ".join(app.config.random_tags or ("rating:safe",))
        await search_and_send(app, message.bot, message.chat.id, tags, message=message)

    @router.message(Command("mode"))
    async def cmd_mode(message: Message, command: CommandObject) -> None:
        mode = (command.args or "").strip().lower()
        if mode not in MODES:
            await message.answer("Режимы: /mode preview, /mode sample, /mode full")
            return
        app.db.set_mode(message.chat.id, mode, safe_default=app.config.safe_default)
        await message.answer(f"Режим качества: {html_code(mode)}")

    @router.message(Command("safe"))
    async def cmd_safe(message: Message, command: CommandObject) -> None:
        arg = (command.args or "").strip().lower()
        if arg not in {"on", "off"}:
            await message.answer("Используй: /safe on или /safe off")
            return
        app.db.set_safe_mode(message.chat.id, arg == "on", safe_default=app.config.safe_default)
        await message.answer(f"Safe mode: {html_code(arg)}")

    @router.message(Command("blacklist_add"))
    async def cmd_blacklist_add(message: Message, command: CommandObject) -> None:
        tags = strip_minus(parse_tags(command.args or ""))
        if not tags:
            await message.answer("Используй: /blacklist_add tag1 tag2")
            return
        app.db.add_blacklist_tags(message.chat.id, tags, safe_default=app.config.safe_default)
        await message.answer("Добавил в blacklist: " + html_code(" ".join(tags)))

    @router.message(Command("blacklist_remove"))
    async def cmd_blacklist_remove(message: Message, command: CommandObject) -> None:
        tags = strip_minus(parse_tags(command.args or ""))
        if not tags:
            await message.answer("Используй: /blacklist_remove tag1 tag2")
            return
        app.db.remove_blacklist_tags(message.chat.id, tags)
        await message.answer("Убрал из blacklist: " + html_code(" ".join(tags)))

    @router.message(Command("blacklist"))
    async def cmd_blacklist(message: Message) -> None:
        tags = app.db.get_blacklist(message.chat.id)
        await message.answer("Blacklist пуст." if not tags else "Blacklist:\n" + html_code(" ".join(tags)))

    @router.message(Command("history"))
    async def cmd_history(message: Message) -> None:
        rows = app.db.get_history(message.chat.id, app.config.history_limit)
        if not rows:
            await message.answer("История пустая.")
            return
        await message.answer("Последние запросы:\n" + "\n".join(f"{idx}. {html_code(row)}" for idx, row in enumerate(rows, 1)))

    @router.message(Command("fav"))
    async def cmd_fav(message: Message) -> None:
        posts = app.db.get_favorites(message.chat.id, app.config.favorite_limit)
        if not posts:
            await message.answer("Избранное пустое.")
            return
        await message.answer("Избранное:", reply_markup=favorite_keyboard(posts[:20]))

    @router.message(Command("suggest"))
    async def cmd_suggest(message: Message, command: CommandObject) -> None:
        seed_tags = parse_tags(command.args or "")
        if not seed_tags:
            await message.answer("Используй: /suggest tag")
            return
        settings = app.db.get_user(message.chat.id, safe_default=app.config.safe_default)
        blacklist = app.db.get_blacklist(message.chat.id)
        query_tags = effective_tags(seed_tags[:3], blacklist, bool(settings["safe_mode"]))
        await app.limiter.wait(message.chat.id)
        try:
            posts = await asyncio.to_thread(app.api.search, query_tags)
        except DapiError:
            await message.answer("Сервис временно недоступен.")
            return
        posts = filter_posts(posts, blacklist, bool(settings["safe_mode"]))
        suggestions = collect_related_tags(posts, seed_tags, limit=30)
        if not suggestions:
            await message.answer("Связанных тегов не нашел.")
            return
        await message.answer("Похожие теги:\n" + html_code(" ".join(suggestions)))

    @router.message(Command("feed"))
    async def cmd_feed(message: Message, command: CommandObject) -> None:
        args = (command.args or "").strip()
        if args.lower() in {"off", "stop", "disable"}:
            task = app.feed_tasks.pop(message.chat.id, None)
            if task:
                task.cancel()
            await message.answer("Feed остановлен.")
            return
        if not parse_tags(args):
            await message.answer("Используй: /feed <теги> или /feed off")
            return
        old = app.feed_tasks.pop(message.chat.id, None)
        if old:
            old.cancel()
        app.feed_tasks[message.chat.id] = asyncio.create_task(feed_loop(app, message.bot, message.chat.id, args))
        await message.answer(f"Feed запущен каждые {app.config.feed_interval_seconds // 60} мин. Теги: {html_code(args)}")

    @router.message(Command("reset"))
    async def cmd_reset(message: Message) -> None:
        task = app.feed_tasks.pop(message.chat.id, None)
        if task:
            task.cancel()
        app.db.reset_user(message.chat.id, safe_default=app.config.safe_default)
        await message.answer("Настройки, blacklist, история и избранное сброшены.")

    @router.callback_query(F.data == "next")
    async def cb_next(callback: CallbackQuery) -> None:
        session = session_from_callback(app, callback)
        if not callback.message or not session:
            await callback.answer("Сессия поиска устарела.", show_alert=True)
            return
        await callback.answer("Ищу следующий...")
        await search_and_send(
            app,
            callback.bot,
            callback.message.chat.id,
            session["tags"],
            sent_ids=session["sent_ids"],
            add_history=False,
        )

    @router.callback_query(F.data == "fav")
    async def cb_fav(callback: CallbackQuery) -> None:
        session = session_from_callback(app, callback)
        if not callback.message or not session:
            await callback.answer("Пост не найден.", show_alert=True)
            return
        app.db.add_favorite(callback.message.chat.id, session["post"], safe_default=app.config.safe_default)
        await callback.answer("В избранном.")

    @router.callback_query(F.data == "similar")
    async def cb_similar(callback: CallbackQuery) -> None:
        session = session_from_callback(app, callback)
        if not callback.message or not session:
            await callback.answer("Пост не найден.", show_alert=True)
            return
        tags = [tag for tag in session["post"].tags if not tag.startswith("rating:")]
        tags = [positive_tag_name(tag) for tag in tags[:6]]
        if not tags:
            await callback.answer("Нет тегов для похожего поиска.", show_alert=True)
            return
        await callback.answer("Ищу похожее...")
        await search_and_send(app, callback.bot, callback.message.chat.id, " ".join(tags), add_history=True)

    @router.callback_query(F.data == "info")
    async def cb_info(callback: CallbackQuery) -> None:
        session = session_from_callback(app, callback)
        if not session:
            await callback.answer("Пост не найден.", show_alert=True)
            return
        post: Post = session["post"]
        await callback.answer(
            f"id: {post.id}\nrating: {post.rating or '-'}\nscore: {post.score}\ntags: {short_tags(post.tags, 12)}",
            show_alert=True,
        )

    @router.callback_query(F.data == "tags")
    async def cb_tags(callback: CallbackQuery) -> None:
        session = session_from_callback(app, callback)
        if not callback.message or not session:
            await callback.answer("Пост не найден.", show_alert=True)
            return
        await callback.answer("Отправил теги.")
        await callback.message.answer(html_code(" ".join(session["post"].tags)))

    @router.callback_query(F.data.startswith("favview:"))
    async def cb_favview(callback: CallbackQuery) -> None:
        if not callback.message or not callback.data:
            await callback.answer("Пост не найден.", show_alert=True)
            return
        try:
            post_id = int(callback.data.split(":", 1)[1])
        except ValueError:
            await callback.answer("Пост не найден.", show_alert=True)
            return
        post = app.db.get_favorite(callback.message.chat.id, post_id)
        if not post:
            await callback.answer("Пост не найден.", show_alert=True)
            return
        settings = app.db.get_user(callback.message.chat.id, safe_default=app.config.safe_default)
        await callback.answer("Открываю избранное...")
        sent = await send_post(callback.bot, callback.message.chat.id, post, str(settings["mode"]))
        app.db.save_session(callback.message.chat.id, sent.message_id, " ".join(post.tags), [post.id], post)

    return router


async def feed_loop(app: AppState, bot: Bot, chat_id: int, raw_tags: str) -> None:
    try:
        while True:
            await search_and_send(app, bot, chat_id, raw_tags, add_history=False)
            await asyncio.sleep(app.config.feed_interval_seconds)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        await bot.send_message(chat_id, f"Feed остановился из-за ошибки: {html_code(str(exc))}")


async def main() -> None:
    config = BotConfig.from_env()
    db = Database(config.db_path)
    db.init()
    api = DapiClient(
        config.dapi_url,
        limit=config.api_limit,
        request_delay_seconds=config.api_delay_seconds,
        cache_ttl_seconds=config.cache_ttl_seconds,
    )
    app = AppState(config=config, db=db, api=api, limiter=RateLimiter())

    bot = Bot(token=config.token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp.include_router(build_router(app))
    await dp.start_polling(bot)

