"""Order execution: PAPER (simulated, SQLite) and REAL (Binance USDT-M via ccxt)."""
import asyncio
import uuid
from typing import Any, Dict, Optional

import ccxt

from app.db import db, now_iso

COMMISSION = 0.0005   # taker 0.05%
SLIPPAGE = 0.0002     # paper only


def _f(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


class LiveClient:
    """Thin ccxt wrapper. All ccxt calls are blocking -> run via asyncio.to_thread."""

    _cache: Dict[str, ccxt.binanceusdm] = {}

    @classmethod
    def invalidate(cls, account_id: str):
        cls._cache.pop(account_id, None)

    @classmethod
    def get(cls, acc: Dict[str, Any]) -> ccxt.binanceusdm:
        ex = cls._cache.get(acc["id"])
        if ex is None:
            ex = ccxt.binanceusdm({
                "apiKey": acc["api_key"], "secret": acc["api_secret"],
                "enableRateLimit": True, "options": {"adjustForTimeDifference": True},
            })
            if acc.get("testnet"):
                try:
                    ex.enable_demo_trading(True)
                except Exception:
                    ex.set_sandbox_mode(True)
            ex.load_markets()
            cls._cache[acc["id"]] = ex
        return ex

    @staticmethod
    def market_symbol(ex: ccxt.binanceusdm, raw: str) -> str:
        m = ex.markets_by_id.get(raw)
        if not m:
            raise ValueError(f"{raw} borsada bulunamadı")
        return (m[0] if isinstance(m, list) else m)["symbol"]

    @classmethod
    def fetch_usdt(cls, acc: Dict[str, Any]) -> Dict[str, float]:
        ex = cls.get(acc)
        bal = ex.fetch_balance()
        u = bal.get("USDT", {}) or {}
        return {"total": _f(u.get("total")), "free": _f(u.get("free")), "used": _f(u.get("used"))}

    @classmethod
    def market_order(cls, acc, raw_symbol: str, side: str, qty: float, leverage: Optional[int], reduce_only: bool):
        ex = cls.get(acc)
        sym = cls.market_symbol(ex, raw_symbol)
        if leverage:
            try:
                ex.set_leverage(int(leverage), sym)
            except Exception as e:
                db.log(f"{raw_symbol} kaldıraç ayarlanamadı: {e}", "WARN", "LIVE")
        amount = float(ex.amount_to_precision(sym, qty))
        if amount <= 0:
            raise ValueError("Miktar borsa hassasiyetinde sıfıra yuvarlandı")
        params = {"reduceOnly": True} if reduce_only else {}
        order = ex.create_order(sym, "market", side, amount, None, params)
        avg = _f(order.get("average")) or _f(order.get("price"))
        return {"id": str(order.get("id", "")), "avg_price": avg, "amount": amount,
                "fee": _f((order.get("fee") or {}).get("cost"))}


class Broker:
    async def open(self, acc: Dict[str, Any], symbol: str, side: str, price: float, margin: float,
                   leverage: int, sl_pct: float, tp_pct: float, reason: str) -> Optional[Dict[str, Any]]:
        side = side.upper()
        price = _f(price)
        if price <= 0 or margin <= 0:
            return None
        qty = margin * leverage / price
        exchange_id = ""
        if acc["type"] == "REAL":
            try:
                res = await asyncio.to_thread(
                    LiveClient.market_order, acc, symbol, "buy" if side == "LONG" else "sell", qty, leverage, False)
            except Exception as e:
                db.log(f"GERÇEK emir reddedildi {symbol} {side}: {e}", "ERROR", "LIVE")
                return None
            entry, qty, exchange_id = res["avg_price"] or price, res["amount"], res["id"]
            commission = res["fee"] or entry * qty * COMMISSION
        else:
            entry = price * (1 + SLIPPAGE) if side == "LONG" else price * (1 - SLIPPAGE)
            commission = entry * qty * COMMISSION
            balance = _f(acc["balance"])
            if balance < margin + commission:
                db.log(f"[{acc['name']}] Yetersiz bakiye: gerekli {margin + commission:.2f}, mevcut {balance:.2f} USDT",
                       "WARN", "PAPER")
                return None
            db.update_account(acc["id"], balance=balance - margin - commission)

        sl = entry * (1 - sl_pct / 100) if side == "LONG" else entry * (1 + sl_pct / 100)
        tp = entry * (1 + tp_pct / 100) if side == "LONG" else entry * (1 - tp_pct / 100)
        pos = {
            "id": f"pos_{uuid.uuid4().hex[:10]}", "account_id": acc["id"], "symbol": symbol, "side": side,
            "entry_price": entry, "quantity": qty, "leverage": leverage, "margin": entry * qty / leverage,
            "stop_loss": sl, "take_profit": tp, "opened_at": now_iso(),
        }
        db.insert_position(pos)
        db.insert_order({
            "id": f"ord_{uuid.uuid4().hex[:10]}", "account_id": acc["id"], "symbol": symbol, "side": side,
            "action": "OPEN", "price": price, "avg_price": entry, "quantity": qty, "commission": commission,
            "reason": reason, "exchange_order_id": exchange_id,
        })
        tag = "GERÇEK" if acc["type"] == "REAL" else "SANAL"
        db.log(f"[{acc['name']}] {tag} {side} {symbol} {qty:.6g} adet @ {entry:.6g} | {leverage}x | {reason}",
               "TRADE", "EXEC")
        return pos

    async def close(self, pos: Dict[str, Any], price: float, reason: str) -> Optional[Dict[str, Any]]:
        acc = db.get_account(pos["account_id"])
        if not acc:
            db.close_position_row(pos["id"])
            return None
        if not db.close_position_row(pos["id"]):
            return None  # already closed by another path
        side, qty, entry = pos["side"], _f(pos["quantity"]), _f(pos["entry_price"])
        price = _f(price) or _f(pos["mark_price"])
        exchange_id = ""
        if acc["type"] == "REAL":
            try:
                res = await asyncio.to_thread(
                    LiveClient.market_order, acc, pos["symbol"], "sell" if side == "LONG" else "buy", qty, None, True)
                exit_p, exchange_id = res["avg_price"] or price, res["id"]
                commission = res["fee"] or exit_p * qty * COMMISSION
            except Exception as e:
                # revert so the position stays visible and can be closed again
                db.reopen_position(pos["id"])
                db.log(f"GERÇEK kapanış emri başarısız {pos['symbol']}: {e}", "ERROR", "LIVE")
                return None
        else:
            exit_p = price * (1 - SLIPPAGE) if side == "LONG" else price * (1 + SLIPPAGE)
            commission = exit_p * qty * COMMISSION

        gross = (exit_p - entry) * qty if side == "LONG" else (entry - exit_p) * qty
        net = gross - commission
        margin = _f(pos["margin"])
        if acc["type"] == "PAPER":
            db.update_account(acc["id"], balance=max(0.0, _f(acc["balance"]) + margin + net))
        db.insert_order({
            "id": f"ord_{uuid.uuid4().hex[:10]}", "account_id": acc["id"], "symbol": pos["symbol"],
            "side": "SELL" if side == "LONG" else "BUY", "action": "CLOSE", "price": price, "avg_price": exit_p,
            "quantity": qty, "commission": commission, "realized_pnl": net, "reason": reason,
            "exchange_order_id": exchange_id,
        })
        pct = net / margin * 100 if margin else 0.0
        db.log(f"[{acc['name']}] KAPANDI {pos['symbol']} @ {exit_p:.6g} | PnL {net:+.2f} USDT ({pct:+.1f}%) | {reason}",
               "TRADE" if net >= 0 else "WARN", "EXEC")
        return {"symbol": pos["symbol"], "net_pnl": net, "pnl_pct": pct, "exit_price": exit_p, "reason": reason,
                "account": acc["name"]}


broker = Broker()
