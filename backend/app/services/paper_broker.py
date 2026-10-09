import math
import time
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional
from app.db import db, now_iso
from app.services.learning_engine import learning_engine
from app.services.market_scanner import market_scanner
from app.services.vault_manager import vault_manager

COMMISSION_RATE = 0.0005  # Binance Futures 0.05% taker fee


def parse_float(val: Any) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return 0.0


def round_step(value: float, step_size: float) -> float:
    """Floors and rounds value to match Binance LOT_SIZE stepSize or PRICE_FILTER tickSize."""
    if step_size <= 0:
        return value
    precision = max(0, int(round(-math.log10(step_size))))
    factor = 1.0 / step_size
    floored = math.floor(round(value * factor, 8)) / factor
    return round(floored, precision)


class PaperBroker:
    def __init__(self):
        self.commission_rate = COMMISSION_RATE
        self.maker_commission_rate = 0.0002
        self._consecutive_losses: int = 0
        self._streak_cooldown_until: float = 0.0

    def is_loss_streak_cooldown_active(self) -> bool:
        return time.time() < self._streak_cooldown_until

    def get_loss_streak_cooldown_remaining(self) -> float:
        return max(0.0, self._streak_cooldown_until - time.time())

    def plan_order(
        self,
        account_id: str,
        symbol: str,
        side: str,
        order_type: str,
        target_price: float,
        current_price: float,
        agent_name: str,
        quantity: float,
        reason: str = "",
        leverage: Optional[int] = None,
        atr: Optional[float] = None,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None
    ) -> Optional[Dict[str, Any]]:
        """Creates an order in PLANNED status after strictly quantizing against LOT_SIZE, PRICE_FILTER and 60% Wallet Margin Cap."""
        if self.is_loss_streak_cooldown_active():
            rem_min = round(self.get_loss_streak_cooldown_remaining() / 60.0, 1)
            db.log(
                f"[SOĞUMA KALKANI 🧊] Üst üste 2 zarar sonrası 45 dakikalık mola devrede ({rem_min} dk kaldı). Yeni emir girişi engellendi.",
                "INFO", "COOLDOWN"
            )
            return None

        acc = db.get_account(account_id)
        if not acc:
            return None

        bal = float(acc.get("balance", 1000.0))

        # 60% Wallet Margin Cap Protection Shield
        open_positions = db.get_open_positions(account_id)
        total_used_margin = sum(float(p.get("margin", 0.0)) for p in open_positions)
        margin_usage_ratio = (total_used_margin / bal) if bal > 0 else 1.0

        if margin_usage_ratio >= 0.60:
            db.log(
                f"[SENTINEL MARJİN KALKANI] 🛡️ Cüzdan risk limiti (%60) dolu. Likidasyon güvenliği için yeni pozisyonlar kilitlendi. (Kullanılan: %{margin_usage_ratio*100:.1f})",
                "WARN", "SENTINEL"
            )
            return None

        # User leverage lookup from settings if not passed
        if leverage is None or leverage <= 0:
            try:
                leverage = int(db.get_setting("leverage_cap", "20"))
            except Exception:
                leverage = 20

        sym = symbol.upper()
        flt = market_scanner.get_symbol_filter(sym)

        t_price = round_step(parse_float(target_price), flt["tick_size"])
        c_price = round_step(parse_float(current_price), flt["tick_size"])
        qty = round_step(parse_float(quantity), flt["step_size"])

        min_qty = flt.get("min_qty", 0.001)
        min_notional = flt.get("min_notional", 5.0)

        if qty < min_qty:
            db.log(
                f"[{agent_name}] Emir reddedildi: Adet ({qty}) < minQty ({min_qty}) ({sym})",
                "WARN", "BROKER"
            )
            return None

        ref_price = t_price if t_price > 0 else c_price
        notional = qty * ref_price

        # Virtual Isolated Margin: Max 10% of account balance per position, sized by user leverage
        max_pos_margin = max(5.0, bal * 0.10)
        max_pos_notional = max_pos_margin * float(leverage)
        if notional > max_pos_notional:
            qty = round_step(max_pos_notional / ref_price, flt["step_size"])
            notional = qty * ref_price

        if notional < min_notional:
            db.log(
                f"[{agent_name}] Emir reddedildi: İşlem tutarı (${notional:.2f}) < minNotional (${min_notional:.2f}) ({sym})",
                "WARN", "BROKER"
            )
            return None

        order_id = f"ord_{uuid.uuid4().hex[:10]}"
        order_data = {
            "id": order_id,
            "account_id": account_id,
            "symbol": sym,
            "side": side.upper(),
            "type": order_type.upper(),
            "target_price": t_price,
            "current_price": c_price,
            "status": "PLANNED",
            "agent_name": agent_name,
            "quantity": qty,
            "reason": reason,
            "leverage": leverage,
            "atr": float(atr) if (atr and float(atr) > 0) else None,
            "stop_loss": float(stop_loss) if (stop_loss and float(stop_loss) > 0) else None,
            "take_profit": float(take_profit) if (take_profit and float(take_profit) > 0) else None
        }
        return db.create_order(order_data)

    def check_and_fill_orders(self, current_prices: Dict[str, float]) -> List[Dict[str, Any]]:
        """Scans all PLANNED orders and fills those matching the market price."""
        planned = db.get_planned_orders()
        filled_positions = []

        for ord in planned:
            sym = ord["symbol"]
            mkt_price = current_prices.get(sym)
            if not mkt_price or mkt_price <= 0:
                continue

            target_p = float(ord["target_price"])
            side = ord["side"].upper()

            # Real L2 BookTicker Matching:
            # BUY order matches against actual best ask (bestAskPrice <= target_price)
            # SELL order matches against actual best bid (bestBidPrice >= target_price)
            book = market_scanner.book_tickers.get(sym)
            best_bid = float(book["bid"]) if (book and book.get("bid")) else 0.0
            best_ask = float(book["ask"]) if (book and book.get("ask")) else 0.0

            should_fill = False
            exec_fill_price = mkt_price

            if side in ("BUY", "LONG"):
                ref_ask = best_ask if best_ask > 0 else mkt_price
                if ref_ask <= target_p:
                    should_fill = True
                    exec_fill_price = ref_ask
            elif side in ("SELL", "SHORT"):
                ref_bid = best_bid if best_bid > 0 else mkt_price
                if ref_bid >= target_p:
                    should_fill = True
                    exec_fill_price = ref_bid

            if should_fill:
                pos = self._execute_fill(ord, exec_fill_price)
                if pos:
                    filled_positions.append(pos)
            else:
                # Update current price in DB to track progress
                db.update_order_status(ord["id"], status="PLANNED", current_price=mkt_price)

        return filled_positions

    def _execute_fill(self, ord: Dict[str, Any], fill_price: float) -> Optional[Dict[str, Any]]:
        account_id = ord["account_id"]
        acc = db.get_account(account_id)
        if not acc:
            return None

        sym = ord["symbol"].upper()
        flt = market_scanner.get_symbol_filter(sym)

        fill_p = round_step(fill_price, flt["tick_size"])
        qty = round_step(float(ord["quantity"]), flt["step_size"])

        # User leverage from order or settings
        leverage = int(ord.get("leverage") or 0)
        if leverage <= 0:
            try:
                leverage = int(db.get_setting("leverage_cap", "20"))
            except Exception:
                leverage = 20

        notional = round(fill_p * qty, 4)
        margin = round(notional / leverage, 4)

        current_balance = float(acc["balance"])

        # Check total wallet margin cap: 60%
        open_positions = db.get_open_positions(account_id)
        current_used_margin = sum(float(p.get("margin", 0.0)) for p in open_positions)
        if (current_used_margin + margin) / current_balance >= 0.60 if current_balance > 0 else True:
            db.log(
                f"[SENTINEL MARJİN KALKANI] 🛡️ Cüzdan risk limiti (%60) dolu. Likidasyon güvenliği için yeni pozisyonlar kilitlendi.",
                "WARN", "SENTINEL"
            )
            db.update_order_status(ord["id"], status="CANCELLED")
            return None

        # Max 10% isolated margin per single position
        max_isolated_margin = max(5.0, current_balance * 0.10)
        if margin > max_isolated_margin:
            qty = round_step((max_isolated_margin * leverage) / fill_p, flt["step_size"])
            notional = round(fill_p * qty, 4)
            margin = round(notional / leverage, 4)

        commission = round(notional * self.maker_commission_rate, 4)
        total_cost = round(margin + commission, 4)

        if current_balance < total_cost:
            db.log(
                f"[SENTINEL MARJİN KALKANI] 🛡️ Cüzdan risk limiti (%60) dolu. Likidasyon güvenliği için yeni pozisyonlar kilitlendi.",
                "WARN", "SENTINEL"
            )
            db.update_order_status(ord["id"], status="CANCELLED")
            return None

        # Deduct margin & commission from account
        new_balance = round(current_balance - total_cost, 2)
        db.update_balance(account_id, new_balance)

        # Mark order FILLED
        db.update_order_status(ord["id"], status="FILLED", filled_price=fill_p)

        # Open Position
        pos_id = f"pos_{uuid.uuid4().hex[:10]}"
        side = "LONG" if ord["side"] in ("BUY", "LONG") else "SHORT"
        
        # Minimum profit floor: round-trip fee + 6% net margin PnL target
        lev = max(1, leverage)
        min_tp_dist = fill_p * ((0.06 + (self.commission_rate * 2.0)) / lev)

        sl_raw = ord.get("stop_loss")
        tp_raw = ord.get("take_profit")
        if sl_raw and tp_raw:
            sl = round_step(float(sl_raw), flt["tick_size"])
            tp = round_step(float(tp_raw), flt["tick_size"])
            # Ensure custom TP never undercuts min-profit floor
            if side == "LONG":
                tp = max(tp, round_step(fill_p + min_tp_dist, flt["tick_size"]))
            else:
                tp = min(tp, round_step(fill_p - min_tp_dist, flt["tick_size"]))
        else:
            atr_val = float(ord.get("atr") or 0.0)
            if atr_val <= 0:
                try:
                    from app.services.indicator_engine import indicator_engine
                    matrix = indicator_engine.compute_matrix(
                        symbol=sym,
                        current_price=fill_p,
                        price_change_24h=1.0,
                        high_24h=fill_p * 1.01,
                        low_24h=fill_p * 0.99,
                        volume_24h=10_000_000.0
                    )
                    atr_val = float(matrix.get("atr", 0.0))
                except Exception:
                    pass
            if not atr_val or atr_val <= 0:
                atr_val = fill_p * 0.015  # Fallback 1.5%

            # Widen ATR stop to 1.85x to absorb micro-whipsaws and set TP to 2.85x (1:1.5+ RR)
            target_tp_dist = max(atr_val * 2.85, min_tp_dist)
            target_sl_dist = atr_val * 1.85
            if side == "LONG":
                sl = round_step(fill_p - target_sl_dist, flt["tick_size"])
                tp = round_step(fill_p + target_tp_dist, flt["tick_size"])
            else:
                sl = round_step(fill_p + target_sl_dist, flt["tick_size"])
                tp = round_step(fill_p - target_tp_dist, flt["tick_size"])

        pos_data = {
            "id": pos_id,
            "account_id": account_id,
            "symbol": sym,
            "side": side,
            "entry_price": fill_p,
            "size": qty,
            "margin": margin,
            "leverage": leverage,
            "stop_loss": sl,
            "take_profit": tp,
            "agent_name": ord.get("agent_name", "Jev AI"),
        }
        db.create_position(pos_data)

        # Telegram Pozisyon Açılış & Vision Grafik Bildirimi
        try:
            from app.services.telegram import telegram
            asyncio.create_task(telegram.notify_position_opened(pos_data, acc["name"]))
        except Exception:
            pass

        # Update agent status
        ag = learning_engine.get_agent_by_name(ord.get("agent_name", ""))
        if ag:
            learning_engine.update_agent_status(ag["agent_id"], "IN_TRADE", sym)

        return pos_data

    def open_position_direct(
        self,
        account_id: str,
        symbol: str,
        side: str,
        entry_price: float,
        size: float,
        leverage: int = 5,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
        atr: Optional[float] = None,
        agent_name: str = "Jev AI"
    ) -> Dict[str, Any]:
        """Direct programmatic opening of a position with exact ATR/SL/TP parameters."""
        acc = db.get_account(account_id)
        if not acc:
            raise ValueError(f"Account {account_id} not found")

        sym = symbol.upper()
        flt = market_scanner.get_symbol_filter(sym)
        entry_p = round_step(entry_price, flt["tick_size"])
        qty = round_step(size, flt["step_size"])
        side_norm = "LONG" if side in ("BUY", "LONG") else "SHORT"
        notional = round(entry_p * qty, 4)
        margin = round(notional / leverage, 4)

        lev = max(1, leverage)
        min_tp_dist = entry_p * ((0.06 + (self.commission_rate * 2.0)) / lev)

        if stop_loss is not None and take_profit is not None:
            sl = round_step(stop_loss, flt["tick_size"])
            tp = round_step(take_profit, flt["tick_size"])
            if side_norm == "LONG":
                tp = max(tp, round_step(entry_p + min_tp_dist, flt["tick_size"]))
            else:
                tp = min(tp, round_step(entry_p - min_tp_dist, flt["tick_size"]))
        else:
            atr_val = atr if (atr and atr > 0) else (entry_p * 0.015)
            target_tp_dist = max(atr_val * 2.85, min_tp_dist)
            target_sl_dist = atr_val * 1.85
            if side_norm == "LONG":
                sl = round_step(entry_p - target_sl_dist, flt["tick_size"])
                tp = round_step(entry_p + target_tp_dist, flt["tick_size"])
            else:
                sl = round_step(entry_p + target_sl_dist, flt["tick_size"])
                tp = round_step(entry_p - target_tp_dist, flt["tick_size"])

        commission = round(notional * self.commission_rate, 4)
        current_bal = float(acc["balance"])
        new_bal = round(current_bal - margin - commission, 2)
        db.update_balance(account_id, new_bal)

        pos_id = f"pos_{uuid.uuid4().hex[:10]}"
        pos_data = {
            "id": pos_id,
            "account_id": account_id,
            "symbol": sym,
            "side": side_norm,
            "entry_price": entry_p,
            "size": qty,
            "margin": margin,
            "leverage": leverage,
            "stop_loss": sl,
            "take_profit": tp,
            "agent_name": agent_name,
        }
        db.create_position(pos_data)
        return pos_data

    def update_positions_pnl_live(self, account_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Recalculates realtime PnL and markPrice for all OPEN positions from live websocket / book tickers.
        Immediately executes and drops closed positions if TP or SL is touched.
        """
        open_positions = db.get_open_positions(account_id)
        updated_list = []
        for pos in open_positions:
            pos_id = pos["id"]
            sym = pos["symbol"].upper()
            flt = market_scanner.get_symbol_filter(sym)

            cur_p = market_scanner.prices.get(sym) or float(pos.get("mark_price", 0.0))
            if not cur_p or cur_p <= 0:
                updated_list.append(pos)
                continue

            cur_p = round_step(cur_p, flt["tick_size"])
            entry_p = float(pos["entry_price"])
            size = float(pos["size"])
            side = pos["side"]
            margin = float(pos["margin"])

            # Realtime PnL calculation:
            # LONG: (current_price - entry_price) * size
            # SHORT: (entry_price - current_price) * size
            # PnL % = (pnl / margin) * 100
            pnl = round((cur_p - entry_p) * size, 2) if side == "LONG" else round((entry_p - cur_p) * size, 2)
            pnl_pct = round((pnl / margin * 100.0), 2) if margin > 0 else 0.0

            db.update_position_mark(pos_id, cur_p, pnl, pnl_pct)
            pos["mark_price"] = cur_p
            pos["pnl"] = pnl
            pos["pnl_pct"] = pnl_pct

            # Sermaye Koruma & Takip Eden Stop (PositionGuardian ile senkron)
            lev = max(1, int(pos.get("leverage") or 20))
            cur_sl = float(pos["stop_loss"]) if pos.get("stop_loss") else None
            fee_buffer = self.commission_rate * 2.0

            if side == "LONG":
                be_sl = round_step(entry_p * (1.0 + fee_buffer), flt["tick_size"])
                # +%2.5 PnL: Sert Risk-Free Breakeven
                if pnl_pct >= 2.5:
                    if cur_sl is None or cur_sl < be_sl:
                        db.update_position_sl(pos_id, be_sl)
                        pos["stop_loss"] = be_sl
                        cur_sl = be_sl
                        db.log(
                            f"[{pos.get('agent_name', 'SENTINEL')}] 🛡️ SERT BREAKEVEN: {sym} PnL %{pnl_pct:.2f} >= +%2.5. SL ${be_sl:.4f} seviyesine çekildi (Sıfır Risk).",
                            "INFO", "TRAILING_STOP"
                        )

                # +%10 ve üzeri: Trailing Stop
                if pnl_pct >= 10.0:
                    trail_dist = cur_p * (0.04 / lev)
                    new_trail_sl = round_step(cur_p - trail_dist, flt["tick_size"])
                    if new_trail_sl > (cur_sl or 0.0) and new_trail_sl >= be_sl:
                        db.update_position_sl(pos_id, new_trail_sl)
                        pos["stop_loss"] = new_trail_sl
                        cur_sl = new_trail_sl
                        db.log(
                            f"[{pos.get('agent_name', 'SENTINEL')}] 🚀 TAKİP EDEN STOP: {sym} PnL %{pnl_pct:.1f}. SL ${new_trail_sl:.4f} seviyesine yükseltildi (Kâr kilitlendi).",
                            "INFO", "TRAILING_STOP"
                        )

            elif side == "SHORT":
                be_sl = round_step(entry_p * (1.0 - fee_buffer), flt["tick_size"])
                # +%2.5 PnL: Sert Risk-Free Breakeven
                if pnl_pct >= 2.5:
                    if cur_sl is None or cur_sl > be_sl:
                        db.update_position_sl(pos_id, be_sl)
                        pos["stop_loss"] = be_sl
                        cur_sl = be_sl
                        db.log(
                            f"[{pos.get('agent_name', 'SENTINEL')}] 🛡️ SERT BREAKEVEN: {sym} PnL %{pnl_pct:.2f} >= +%2.5. SL ${be_sl:.4f} seviyesine çekildi (Sıfır Risk).",
                            "INFO", "TRAILING_STOP"
                        )

                # +%15 ve üzeri: Trailing Stop (%5 takip mesafesi)
                if pnl_pct >= 15.0:
                    trail_dist = cur_p * (0.05 / lev)
                    new_trail_sl = round_step(cur_p + trail_dist, flt["tick_size"])
                    if (cur_sl is None or new_trail_sl < cur_sl) and new_trail_sl <= be_sl:
                        db.update_position_sl(pos_id, new_trail_sl)
                        pos["stop_loss"] = new_trail_sl
                        cur_sl = new_trail_sl
                        db.log(
                            f"[{pos.get('agent_name', 'SENTINEL')}] 🚀 TAKİP EDEN STOP: {sym} PnL %{pnl_pct:.1f}. SL ${new_trail_sl:.4f} seviyesine indirildi (Kâr kilitlendi).",
                            "INFO", "TRAILING_STOP"
                        )

            # Check L2 best bid / best ask for TP / SL execution
            bt = market_scanner.book_tickers.get(sym, {})
            best_bid = float(bt.get("bestBidPrice") or bt.get("bid") or cur_p)
            best_ask = float(bt.get("bestAskPrice") or bt.get("ask") or cur_p)

            close_res = self.check_position_tp_sl(pos_id, best_bid=best_bid, best_ask=best_ask, mark_price=cur_p)
            if not close_res:
                updated_list.append(pos)

        return updated_list

    def check_position_tp_sl(
        self,
        pos_id: str,
        best_bid: Optional[float] = None,
        best_ask: Optional[float] = None,
        mark_price: Optional[float] = None
    ) -> Optional[Dict[str, Any]]:
        """Evaluates whether open position reached Take Profit or Stop Loss using real L2 best Bid/Ask."""
        pos = db.get_position(pos_id)
        if not pos or pos.get("status") != "OPEN":
            return None

        side = pos["side"]
        tp = float(pos["take_profit"]) if pos.get("take_profit") else None
        sl = float(pos["stop_loss"]) if pos.get("stop_loss") else None

        # For LONG exit (SELL): order book execution matches against bestBid. For SHORT exit (BUY): against bestAsk.
        exit_p = (best_bid if side == "LONG" else best_ask) or mark_price
        if not exit_p or exit_p <= 0:
            return None

        hit_tp = (exit_p >= tp) if (tp and side == "LONG") else (exit_p <= tp) if (tp and side == "SHORT") else False
        hit_sl = (exit_p <= sl) if (sl and side == "LONG") else (exit_p >= sl) if (sl and side == "SHORT") else False

        if hit_tp:
            return self.close_position(pos_id, exit_p, reason="Take Profit Tetiklendi")
        elif hit_sl:
            return self.close_position(pos_id, exit_p, reason="Stop Loss Tetiklendi")

        return None

    def close_position(self, pos_id: str, exit_price: float, reason: str = "Manuel") -> Optional[Dict[str, Any]]:
        pos = db.get_position(pos_id)
        if not pos or pos["status"] != "OPEN":
            return None

        account_id = pos["account_id"]
        acc = db.get_account(account_id)
        if not acc:
            return None

        sym = pos["symbol"].upper()
        flt = market_scanner.get_symbol_filter(sym)

        entry_p = round_step(float(pos["entry_price"]), flt["tick_size"])
        exit_p = round_step(exit_price, flt["tick_size"])
        size = round_step(float(pos["size"]), flt["step_size"])
        side = pos["side"]
        margin = float(pos["margin"])

        # PnL calculation strictly on quantized values
        if side == "LONG":
            gross_pnl = round((exit_p - entry_p) * size, 2)
        else:
            gross_pnl = round((entry_p - exit_p) * size, 2)

        entry_commission = round((entry_p * size) * self.commission_rate, 4)
        exit_commission = round((exit_p * size) * self.commission_rate, 4)
        total_fee = round(entry_commission + exit_commission, 4)
        net_pnl = round(gross_pnl - total_fee, 2)
        pnl_pct = round((net_pnl / margin * 100.0), 2) if margin > 0 else 0.0

        # Credit margin + gross_pnl - exit_commission back to account (entry_commission was already deducted when opening)
        new_balance = max(0.0, round(float(acc["balance"]) + margin + gross_pnl - exit_commission, 2))
        db.update_balance(account_id, new_balance)

        # 2x Vault Sweeper: Check if profits qualify for 25% Spot Vault sweep
        try:
            vault_manager.check_and_sweep_vault(account_id)
        except Exception as e:
            db.log(f"Kasa transfer denetim hatası: {e}", "WARN", "VAULT")

        # Mark position CLOSED in DB
        db.close_position_db(pos_id)

        # Save to trades history table
        trade_id = f"trd_{uuid.uuid4().hex[:10]}"
        agent_name = pos.get("agent_name", "Jev AI")
        trade_data = {
            "id": trade_id,
            "account_id": account_id,
            "symbol": sym,
            "side": side,
            "entry_price": entry_p,
            "exit_price": exit_p,
            "size": size,
            "pnl": round(gross_pnl, 2),
            "net_pnl": round(net_pnl, 2),
            "fee": round(total_fee, 4),
            "stop_loss": pos.get("stop_loss"),
            "take_profit": pos.get("take_profit"),
            "agent_name": agent_name,
            "reason": reason,
            "closed_at": now_iso()
        }
        db.create_trade(trade_data)

        # Soğuma Kalkanı (Anti-Streak Cooldown): Üst üste 2 zarar sonrası 45 dakika mola
        if net_pnl < 0:
            self._consecutive_losses += 1
            if self._consecutive_losses >= 2:
                self._streak_cooldown_until = time.time() + (45 * 60)
                db.set_setting("loss_streak_cooldown_until", str(self._streak_cooldown_until))
                db.log(
                    f"[SOĞUMA KALKANI 🧊] Üst üste 2 zarar alındı ({sym} Net: ${net_pnl:+.2f}). Piyasa testere modunda. 45 dakika mola verildi.",
                    "WARN", "COOLDOWN"
                )
        else:
            self._consecutive_losses = 0

        # Record outcome in learning engine
        learning_engine.record_trade_outcome(agent_name, net_pnl)

        # Update agent status to IDLE
        ag = learning_engine.get_agent_by_name(agent_name)
        if ag:
            learning_engine.update_agent_status(ag["agent_id"], "IDLE")

        db.log(
            f"[{agent_name}] POZİSYON KAPATILDI: {sym} @ ${exit_p:.4f} "
            f"| Brüt: ${gross_pnl:+.2f} | Net: ${net_pnl:+.2f} USDT ({pnl_pct:+.2f}%) | Komisyon: ${total_fee:.3f} | Sebep: {reason}",
            "TRADE" if net_pnl >= 0 else "WARN", "BROKER"
        )

        return {
            "id": pos_id,
            "trade_id": trade_id,
            "symbol": sym,
            "gross_pnl": gross_pnl,
            "net_pnl": net_pnl,
            "fee": total_fee,
            "pnl_pct": pnl_pct,
            "exit_price": exit_p,
            "reason": reason,
        }

    def get_account_equity(self, account_id: str) -> Dict[str, float]:
        """Calculates live Total Equity, Wallet Balance, Used Margin, Free Margin, and Unrealized PnL."""
        acc = db.get_account(account_id)
        if not acc:
            return {
                "balance": 0.0,
                "wallet_balance": 0.0,
                "equity": 0.0,
                "used_margin": 0.0,
                "free_margin": 0.0,
                "unrealized_pnl": 0.0
            }

        # Free margin is what's left in acc["balance"]
        free_margin = round(float(acc.get("balance", 0.0)), 2)
        open_positions = db.get_open_positions(account_id)
        used_margin = round(sum(float(p.get("margin", 0.0)) for p in open_positions), 2)
        unrealized_pnl = round(sum(float(p.get("pnl", 0.0)) for p in open_positions), 2)
        wallet_balance = round(free_margin + used_margin, 2)
        equity = round(wallet_balance + unrealized_pnl, 2)

        return {
            "balance": equity,
            "wallet_balance": wallet_balance,
            "equity": equity,
            "used_margin": used_margin,
            "free_margin": free_margin,
            "unrealized_pnl": unrealized_pnl
        }

    def enrich_account(self, account: Dict[str, Any]) -> Dict[str, Any]:
        """Attaches equity, used_margin, free_margin and unrealized_pnl to account object."""
        if not account or not account.get("id"):
            return account
        acc = dict(account)
        eq_data = self.get_account_equity(acc["id"])
        acc.update(eq_data)
        return acc


paper_broker = PaperBroker()
