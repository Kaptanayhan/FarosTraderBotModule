"""One-time import of legacy OmniTrader JSON config into SQLite."""
import json
from pathlib import Path

from app.db import db

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _read(path: Path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def run_migration():
    if db.get_setting("legacy_migrated") == "true":
        return

    merged = {}
    for src in (BACKEND_DIR / "data" / "accounts.json", BACKEND_DIR / "binance_config.json"):
        data = _read(src)
        items = data.get("accounts", []) if isinstance(data, dict) else (data or [])
        for a in items:
            if isinstance(a, dict) and a.get("id"):
                merged.setdefault(a["id"], {}).update({k: v for k, v in a.items() if v not in (None, "")})

    existing = {a["id"] for a in db.list_accounts()}
    imported = 0
    for acc_id, a in merged.items():
        if acc_id in existing:
            continue
        key, secret = a.get("apiKey", ""), a.get("apiSecret", "")
        is_paper = a.get("isPaper", a.get("is_paper", True)) or not (key and secret)
        balance = float(a.get("virtual_balance", a.get("virtualBalance", a.get("initialBalance", 1000.0))) or 0.0)
        db.create_account({
            "id": acc_id,
            "name": a.get("name") or acc_id,
            "type": "PAPER" if is_paper else "REAL",
            "balance": balance if is_paper else 0.0,
            "api_key": key,
            "api_secret": secret,
            "testnet": str(a.get("environment", "")).upper() == "TESTNET",
        })
        imported += 1

    tg = _read(BACKEND_DIR / "telegram_config.json")
    if isinstance(tg, dict) and tg.get("botToken"):
        db.set_setting("telegram_bot_token", tg.get("botToken", ""))
        db.set_setting("telegram_chat_id", str(tg.get("chatId", "")))
        db.set_setting("telegram_enabled", "true" if tg.get("enabled") else "false")

    bc = _read(BACKEND_DIR / "binance_config.json")
    if isinstance(bc, dict):
        if bc.get("stopLossPercent"):
            db.set_setting("stop_loss_pct", bc["stopLossPercent"])
        if bc.get("takeProfitPercent"):
            db.set_setting("take_profit_pct", bc["takeProfitPercent"])
        if bc.get("minSignalScore"):
            db.set_setting("min_score", int(float(bc["minSignalScore"])))

    db.set_setting("legacy_migrated", "true")
    db.log(f"Eski yapılandırmadan {imported} hesap içe aktarıldı.", "INFO", "MIGRATE")
