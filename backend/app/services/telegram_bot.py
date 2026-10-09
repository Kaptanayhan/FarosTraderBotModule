"""FAROS Telegram Bot Service Module.
Exports telegram_bot instance and handles notifications and 2-way polling.
"""
from app.services.telegram import (
    telegram as telegram_bot,
    REPLY_KEYBOARD,
    STOP_INLINE_KEYBOARD,
    DEFAULT_BOT_TOKEN,
    DEFAULT_CHAT_ID,
    BOT_USERNAME
)

__all__ = [
    "telegram_bot",
    "REPLY_KEYBOARD",
    "STOP_INLINE_KEYBOARD",
    "DEFAULT_BOT_TOKEN",
    "DEFAULT_CHAT_ID",
    "BOT_USERNAME"
]
