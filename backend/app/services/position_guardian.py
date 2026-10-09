"""Position Guardian Agent - Sub-second Autonomous Risk & Position Manager.
Runs an independent 150ms loop to enforce stepped breakeven, trailing stops,
and early invalidation upon severe order book (L2) or flow collapse.
"""
import asyncio
import time
from datetime import datetime
from typing import Dict, Any, List, Optional
from app.db import db
from app.services.market_scanner import market_scanner
from app.services.paper_broker import paper_broker, round_step
from app.services.capital_tier_manager import capital_tier_manager


class PositionGuardianAgent:
    def __init__(self):
        self._running: bool = False
        self._task: Optional[asyncio.Task] = None
        self._loop_interval: float = 0.15  # 150ms fast reactive loop
        self._stepped_records: Dict[str, Dict[str, bool]] = {}

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._guardian_loop())
        db.log("Position Guardian Agent (150ms Bağımsız Risk Savunması) aktif.", "INFO", "GUARDIAN")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
        db.log("Position Guardian Agent durduruldu.", "WARN", "GUARDIAN")

    async def _guardian_loop(self):
        while self._running:
            try:
                open_positions = db.get_open_positions()
                if open_positions:
                    for pos in open_positions:
                        await self._inspect_and_defend(pos)
            except asyncio.CancelledError:
                break
            except Exception as e:
                db.log(f"[GUARDIAN HATA] Döngü istisnası: {e}", "ERROR", "GUARDIAN")

            await asyncio.sleep(self._loop_interval)

    async def _inspect_and_defend(self, pos: Dict[str, Any]):
        pos_id = pos["id"]
        sym = pos["symbol"].upper()
        side = pos["side"].upper()
        entry_p = float(pos["entry_price"])
        size = float(pos["size"])
        margin = float(pos.get("margin") or 1.0)
        lev = max(1, int(pos.get("leverage") or 20))
        cur_sl = float(pos["stop_loss"]) if pos.get("stop_loss") is not None else None

        flt = market_scanner.get_symbol_filter(sym)
        cur_p = market_scanner.prices.get(sym)
        if not cur_p or cur_p <= 0:
            cur_p = float(pos.get("mark_price") or entry_p)

        # Calculate current net PnL and PnL %
        if side in ("BUY", "LONG"):
            gross_pnl = (cur_p - entry_p) * size
        else:
            gross_pnl = (entry_p - cur_p) * size

        fee_buffer = paper_broker.commission_rate * 2.0  # roundtrip fees
        est_fee = (entry_p * size) * fee_buffer
        net_pnl = gross_pnl - est_fee
        pnl_pct = (net_pnl / margin) * 100.0 if margin > 0 else 0.0

        if pos_id not in self._stepped_records:
            self._stepped_records[pos_id] = {"hard_be": False, "trailing": False}

        # -------------------------------------------------------------
        # DİNAMİK SERMAYE KADEMESİ PARAMETRELERİ (Tier-1 Turbo Scalp / Tier-2 Hybrid Sniper)
        # -------------------------------------------------------------
        acc_id = pos.get("account_id")
        eq_info = paper_broker.get_account_equity(acc_id) if acc_id else {"equity": 1000.0}
        total_equity = eq_info.get("equity", 1000.0)

        reason_txt = str(pos.get("reason", "")) + " " + str(pos.get("agent_name", ""))
        is_big_hunt = "BIG_HUNT" in reason_txt or pos.get("slot_type") == "BIG_HUNT"
        slot_idx = 1 if is_big_hunt else 0
        tier_params = capital_tier_manager.get_tier_parameters(total_equity, slot_index=slot_idx)

        mode = tier_params.get("mode", "TURBO_SCALP")
        be_trigger = float(tier_params.get("breakeven_trigger_pct", 1.0))
        trailing_trigger = float(tier_params.get("trailing_trigger_pct", 2.5))
        max_holding_sec = int(tier_params.get("max_holding_seconds", 2700))

        # -------------------------------------------------------------
        # 0. DİNAMİK ZAMAN AŞIMI (Örn: Tier-1'de 45 dk / Tier-2 Big Hunt'ta 4 saat)
        # -------------------------------------------------------------
        opened_at_str = pos.get("opened_at", "")
        if opened_at_str:
            try:
                opened_dt = datetime.strptime(opened_at_str, "%Y-%m-%d %H:%M:%S")
                age_seconds = (datetime.utcnow() - opened_dt).total_seconds()
                if age_seconds >= max_holding_sec:
                    paper_broker.close_position(
                        pos_id,
                        exit_price=cur_p,
                        reason=f"Zaman Aşımı ({tier_params.get('tier_name', mode)} - {max_holding_sec // 60}dk Devir - {age_seconds:.0f}s)"
                    )
                    db.log(
                        f"[GUARDIAN ⏱️] {sym} {tier_params.get('tier_name', mode)} zaman aşımı doldu ({age_seconds:.0f}s / {max_holding_sec}s). Pozisyon kapatıldı (PnL: %{pnl_pct:+.2f}).",
                        "INFO", "CAPITAL_GUARD"
                    )
                    self._stepped_records.pop(pos_id, None)
                    return
            except Exception:
                pass

        # -------------------------------------------------------------
        # 1. KADEMEYE DUYARLI SERT BREAKEVEN (Turbo Scalp: +%1.0, Hybrid Big Hunt: +%2.5)
        # -------------------------------------------------------------
        if pnl_pct >= be_trigger and not self._stepped_records[pos_id].get("hard_be"):
            if side in ("BUY", "LONG"):
                be_sl = round_step(entry_p * (1.0 + fee_buffer), flt["tick_size"])
                if cur_sl is None or cur_sl < be_sl:
                    db.update_position_sl(pos_id, be_sl)
                    pos["stop_loss"] = be_sl
                    cur_sl = be_sl
                    self._stepped_records[pos_id]["hard_be"] = True
                    db.log(
                        f"[GUARDIAN 🛡️] {sym} BREAKEVEN KİLİTLENDİ ({mode}): PnL +%{pnl_pct:.2f} >= +%{be_trigger:.1f}. SL başabaş seviyesine çekildi (${be_sl:.4f}).",
                        "INFO", "GUARDIAN"
                    )
            else:
                be_sl = round_step(entry_p * (1.0 - fee_buffer), flt["tick_size"])
                if cur_sl is None or cur_sl > be_sl:
                    db.update_position_sl(pos_id, be_sl)
                    pos["stop_loss"] = be_sl
                    cur_sl = be_sl
                    self._stepped_records[pos_id]["hard_be"] = True
                    db.log(
                        f"[GUARDIAN 🛡️] {sym} BREAKEVEN KİLİTLENDİ ({mode}): PnL +%{pnl_pct:.2f} >= +%{be_trigger:.1f}. SL başabaş seviyesine çekildi (${be_sl:.4f}).",
                        "INFO", "GUARDIAN"
                    )

        # -------------------------------------------------------------
        # 2. İZ SÜREN KÂR KORUMA (TRAILING STOP: Turbo Scalp: +%2.5, Hybrid Big Hunt: +%3.0)
        # -------------------------------------------------------------
        if pnl_pct >= trailing_trigger:
            trail_pct_dist = 0.03 if is_big_hunt else 0.04
            trail_dist = cur_p * (trail_pct_dist / lev)
            if side in ("BUY", "LONG"):
                trail_sl = round_step(cur_p - trail_dist, flt["tick_size"])
                if trail_sl > (cur_sl or 0.0):
                    db.update_position_sl(pos_id, trail_sl)
                    pos["stop_loss"] = trail_sl
                    cur_sl = trail_sl
                    self._stepped_records[pos_id]["trailing"] = True
                    db.log(
                        f"[GUARDIAN 🚀] {sym} TRAILING STOP DEVREDE ({mode}): PnL +%{pnl_pct:.2f} >= +%{trailing_trigger:.1f}. SL ${trail_sl:.4f} seviyesine çekildi.",
                        "INFO", "GUARDIAN"
                    )
            else:
                trail_sl = round_step(cur_p + trail_dist, flt["tick_size"])
                if cur_sl is None or trail_sl < cur_sl:
                    db.update_position_sl(pos_id, trail_sl)
                    pos["stop_loss"] = trail_sl
                    cur_sl = trail_sl
                    self._stepped_records[pos_id]["trailing"] = True
                    db.log(
                        f"[GUARDIAN 🚀] {sym} TRAILING STOP DEVREDE ({mode}): PnL +%{pnl_pct:.2f} >= +%{trailing_trigger:.1f}. SL ${trail_sl:.4f} seviyesine çekildi.",
                        "INFO", "GUARDIAN"
                    )

        # -------------------------------------------------------------
        # 2. TERS DERİNLİK ÇÖKÜŞÜNDE ERKEN ÇIKIŞ (EARLY INVALIDATION)
        # -------------------------------------------------------------
        # Pozisyon aleyhe dönmüşse (pnl_pct <= -2.5%) ve L2 tahtasında devasa ters baskı varsa:
        if pnl_pct <= -2.5:
            depth = await market_scanner.get_l2_depth(sym, limit=5)
            bids = depth.get("bids", [])
            asks = depth.get("asks", [])
            if bids and asks:
                total_bid_qty = sum(float(b.get("qty", 0.0)) for b in bids)
                total_ask_qty = sum(float(a.get("qty", 0.0)) for a in asks)

                should_invalidate = False
                invalidation_reason = ""

                if side in ("BUY", "LONG"):
                    # Asks baskısı Bids'in 3.5 katından fazlaysa ve tahta çöküyorsa
                    if total_bid_qty > 0 and (total_ask_qty / total_bid_qty) >= 3.5:
                        should_invalidate = True
                        invalidation_reason = f"L2 Ters Derinlik Çöküşü (Ask/Bid Oranı: {total_ask_qty/total_bid_qty:.1f}x Satıcı Baskısı)"
                elif side in ("SELL", "SHORT"):
                    # Bids baskısı Asks'in 3.5 katından fazlaysa ve yukarı fırlıyorsa
                    if total_ask_qty > 0 and (total_bid_qty / total_ask_qty) >= 3.5:
                        should_invalidate = True
                        invalidation_reason = f"L2 Ters Derinlik Çöküşü (Bid/Ask Oranı: {total_bid_qty/total_ask_qty:.1f}x Alıcı Baskısı)"

                if should_invalidate:
                    exit_p = cur_p
                    paper_broker.close_position(
                        pos_id,
                        exit_price=exit_p,
                        reason=f"[GUARDIAN ERKEN ÇIKIŞ] {invalidation_reason}"
                    )
                    db.log(
                        f"[GUARDIAN 🛡️] {sym} pozisyonunda {invalidation_reason} tespit edildi. Tam stop beklenmeden erken kapatıldı (PnL: %{pnl_pct:.1f}).",
                        "WARN", "GUARDIAN"
                    )
                    self._stepped_records.pop(pos_id, None)


position_guardian = PositionGuardianAgent()
