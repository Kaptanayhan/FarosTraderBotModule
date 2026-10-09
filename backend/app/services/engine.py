"""Trading coordinator: manages engine state, scan cycles, signal matching, and stop scenarios."""
import asyncio
import time
from typing import Any, Dict, List, Optional

from app.db import db
from app.services.scanner import scanner
from app.services.broker import broker, LiveClient
from app.services.telegram import telegram


class Engine:
    def __init__(self):
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._symbol_cooldowns: Dict[str, float] = {}
        self.last_cycle_time = 0.0

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._main_loop())
        db.log("FAROS Ticaret Motoru arka plan döngüsü başlatıldı.", "INFO", "ENGINE")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
        db.log("FAROS Ticaret Motoru arka plan döngüsü durduruldu.", "WARN", "ENGINE")

    async def start_account(self, account_id: str) -> bool:
        acc = db.get_account(account_id)
        if not acc:
            return False
        # If real account, verify connectivity & balance
        if acc["type"] == "REAL":
            if not acc.get("api_key") or not acc.get("api_secret"):
                db.log(f"[{acc['name']}] Gerçek hesap için API Key ve Secret zorunludur!", "ERROR", "ENGINE")
                return False
            try:
                bal = await asyncio.to_thread(LiveClient.fetch_usdt, acc)
                db.update_account(account_id, balance=bal["total"])
            except Exception as e:
                db.log(f"[{acc['name']}] Binance API bağlantı hatası: {e}", "ERROR", "ENGINE")
                return False

        db.update_account(account_id, engine_state="RUNNING", stop_mode="")
        db.log(f"[{acc['name']}] Motor BAŞLATILDI. Otomatik işlem alımı aktif.", "INFO", "ENGINE")
        asyncio.create_task(telegram.notify_engine_state("RUNNING", f"Hesap: {acc['name']} motoru aktif."))
        return True

    async def stop_account(self, account_id: str, mode: str = "MARKET") -> Dict[str, Any]:
        """
        Stop scenarios:
        1. 'MARKET': Close all open positions at market, stop engine.
        2. 'PANIC': Emergency panic close all positions, stop engine.
        3. 'PROFIT_ONLY': Close only positions in profit, stop new positions.
        4. 'KEEP': Do not close any positions, just stop new orders.
        """
        acc = db.get_account(account_id)
        if not acc:
            return {"success": False, "error": "Hesap bulunamadı"}

        mode = mode.upper()
        db.update_account(account_id, engine_state="STOPPING", stop_mode=mode)
        db.log(f"[{acc['name']}] Motor DURDURULUYOR... Senaryo: {mode}", "WARN", "ENGINE")

        open_positions = db.open_positions(account_id)
        closed_count = 0

        if mode in ("MARKET", "PANIC"):
            for pos in open_positions:
                cur_p = scanner.prices.get(pos["symbol"]) or float(pos["mark_price"])
                reason = "Acil Panik Kapatma" if mode == "PANIC" else "Motor Durdurma (Market)"
                res = await broker.close(pos, cur_p, reason=reason)
                if res:
                    closed_count += 1
                    asyncio.create_task(telegram.notify_position_closed(res))
            db.update_account(account_id, engine_state="STOPPED", stop_mode="")
            msg = f"İşlem tamamlandı, bot durduruldu. {closed_count} açık pozisyon kapatıldı, açık emir yok."
            db.log(f"[{acc['name']}] {msg}", "INFO", "ENGINE")
            asyncio.create_task(telegram.notify_engine_state("STOPPED", f"Hesap: {acc['name']} - {msg}"))
            return {"success": True, "engine_state": "STOPPED", "message": msg, "closed_positions": closed_count}

        elif mode == "PROFIT_ONLY":
            for pos in open_positions:
                if float(pos.get("pnl", 0)) > 0:
                    cur_p = scanner.prices.get(pos["symbol"]) or float(pos["mark_price"])
                    res = await broker.close(pos, cur_p, reason="Kâr Hedefli Motor Kapatma")
                    if res:
                        closed_count += 1
                        asyncio.create_task(telegram.notify_position_closed(res))
            # If no open positions remain, switch to STOPPED
            remaining = db.open_positions(account_id)
            if not remaining:
                db.update_account(account_id, engine_state="STOPPED", stop_mode="")
                msg = f"Tüm pozisyonlar kapatıldı, bot durduruldu. Açık emir yok."
            else:
                msg = f"{closed_count} kârlı pozisyon kapatıldı. {len(remaining)} adet zararda pozisyon koruma altında bekliyor."
            db.log(f"[{acc['name']}] {msg}", "INFO", "ENGINE")
            return {"success": True, "engine_state": "STOPPING" if remaining else "STOPPED", "message": msg, "closed_positions": closed_count}

        else:  # KEEP or default
            db.update_account(account_id, engine_state="STOPPED", stop_mode="")
            msg = "İşlem tamamlandı, bot durduruldu. Açık pozisyonlar korundu, yeni emir alınmayacak."
            db.log(f"[{acc['name']}] {msg}", "INFO", "ENGINE")
            asyncio.create_task(telegram.notify_engine_state("STOPPED", f"Hesap: {acc['name']} - {msg}"))
            return {"success": True, "engine_state": "STOPPED", "message": msg, "closed_positions": 0}

    async def _main_loop(self):
        while self._running:
            try:
                # 1. Scan market
                radar = await scanner.scan()
                prices = scanner.prices

                # 2. Update mark prices and check SL/TP for all open positions across all accounts
                all_open = db.open_positions()
                for pos in all_open:
                    cur_p = prices.get(pos["symbol"])
                    if not cur_p:
                        continue
                    entry = float(pos["entry_price"])
                    qty = float(pos["quantity"])
                    lev = int(pos["leverage"])
                    margin = float(pos["margin"])
                    side = pos["side"]

                    pnl = (cur_p - entry) * qty if side == "LONG" else (entry - cur_p) * qty
                    pnl_pct = (pnl / margin * 100) if margin else 0.0
                    db.update_position_mark(pos["id"], cur_p, pnl, pnl_pct)

                    # Check SL / TP
                    sl = float(pos["stop_loss"]) if pos.get("stop_loss") else None
                    tp = float(pos["take_profit"]) if pos.get("take_profit") else None
                    hit_sl = (cur_p <= sl) if (sl and side == "LONG") else (cur_p >= sl) if (sl and side == "SHORT") else False
                    hit_tp = (cur_p >= tp) if (tp and side == "LONG") else (cur_p <= tp) if (tp and side == "SHORT") else False

                    if hit_sl:
                        res = await broker.close(pos, cur_p, reason="Stop Loss Tetiklendi")
                        if res:
                            asyncio.create_task(telegram.notify_position_closed(res))
                    elif hit_tp:
                        res = await broker.close(pos, cur_p, reason="Take Profit Tetiklendi")
                        if res:
                            asyncio.create_task(telegram.notify_position_closed(res))

                # 3. For each active running account, evaluate new trade signals
                accounts = db.list_accounts()
                now_ts = time.time()
                min_score = int(db.get_float("min_score"))
                leverage = int(db.get_float("leverage"))
                allocation_pct = db.get_float("allocation_pct")
                sl_pct = db.get_float("stop_loss_pct")
                tp_pct = db.get_float("take_profit_pct")
                max_pos = int(db.get_float("max_positions"))
                cooldown_sec = db.get_float("cooldown_sec")

                for acc in accounts:
                    state = acc.get("engine_state", "STOPPED")
                    if state != "RUNNING":
                        # Check if a stopping account with PROFIT_ONLY mode has finished
                        if state == "STOPPING" and acc.get("stop_mode") == "PROFIT_ONLY":
                            rem = db.open_positions(acc["id"])
                            if not rem:
                                db.update_account(acc["id"], engine_state="STOPPED", stop_mode="")
                                db.log(f"[{acc['name']}] Kalan pozisyonlar kapandı, motor TAMAMEN DURDURULDU.", "INFO", "ENGINE")
                        continue

                    # If REAL, periodically refresh balance from Binance
                    if acc["type"] == "REAL":
                        try:
                            bal = await asyncio.to_thread(LiveClient.fetch_usdt, acc)
                            db.update_account(acc["id"], balance=bal["total"])
                            acc["balance"] = bal["total"]
                        except Exception:
                            pass

                    acc_positions = db.open_positions(acc["id"])
                    if len(acc_positions) >= max_pos:
                        continue

                    balance = float(acc["balance"])
                    if balance <= 10.0:
                        continue

                    active_symbols = {p["symbol"] for p in acc_positions}

                    # Find best candidate
                    candidates = [
                        c for c in radar
                        if c["signal"] in ("LONG", "SHORT")
                        and c["score"] >= min_score
                        and c["symbol"] not in active_symbols
                        and (now_ts - self._symbol_cooldowns.get(c["symbol"], 0)) > cooldown_sec
                    ]

                    if not candidates:
                        continue

                    best = candidates[0]
                    margin = balance * (allocation_pct / 100.0)
                    if margin < 5.0:
                        continue

                    pos = await broker.open(
                        acc=acc,
                        symbol=best["symbol"],
                        side=best["signal"],
                        price=best["price"],
                        margin=margin,
                        leverage=leverage,
                        sl_pct=sl_pct,
                        tp_pct=tp_pct,
                        reason=f"Skor: {best['score']} | {best['reason']}",
                    )
                    if pos:
                        self._symbol_cooldowns[best["symbol"]] = now_ts
                        asyncio.create_task(telegram.notify_position_opened(pos, acc["name"]))

                self.last_cycle_time = now_ts

            except asyncio.CancelledError:
                break
            except Exception as e:
                db.log(f"Motor döngü hatası: {e}", "ERROR", "ENGINE")

            await asyncio.sleep(3.0)


engine = Engine()
