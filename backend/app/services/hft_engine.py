"""FAROS HFT Engine - Deterministic Trade Loop with Order Guarantee.
Guarantees at least 2 planned limit orders on start and continuously executes matching cycles.
"""
import asyncio
import time
from typing import Dict, Any, List, Optional
from app.db import db
from app.services.market_scanner import market_scanner
from app.services.paper_broker import paper_broker, round_step
from app.services.learning_engine import learning_engine
from app.services.jev_agent import jev_agent
from app.services.capital_tier_manager import capital_tier_manager


class HFTEngine:
    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._cooldowns: Dict[str, float] = {}

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._engine_loop())
        db.log("HFT Kuant Motoru arka plan döngüsü aktif.", "INFO", "HFT")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
        db.log("HFT Kuant Motoru durduruldu.", "WARN", "HFT")

    async def on_motor_start(self, account_id: str):
        """Called immediately when user starts the engine to guarantee initial planned orders."""
        acc = db.get_account(account_id)
        if not acc:
            return

        db.update_account_state(account_id, "RUNNING", "")
        db.set_setting("engine_running", "true")
        db.log(f"[{acc['name']}] MOTOR BAŞLATILDI. 2 Paritede İlk Planlı Emirler Hazırlanıyor...", "INFO", "HFT")

        # 1. Trigger fresh scan if radar is empty
        if not market_scanner.radar:
            await market_scanner.scan()

        radar = market_scanner.radar
        if not radar:
            return

        # 2. Pick top 2 pairs by volume/score
        top2 = radar[:2]
        eq_info = paper_broker.get_account_equity(account_id)
        equity = float(eq_info.get("equity", acc.get("balance", 1000.0)))

        for idx, coin in enumerate(top2):
            sym = coin["symbol"]
            mkt_p = float(coin["price"])
            if mkt_p <= 0:
                continue

            matched_ag = learning_engine.get_agent_by_name(coin.get("focused_agent", ""))
            if not matched_ag:
                agents = learning_engine.get_agents()
                matched_ag = agents[idx % len(agents)] if agents else {"name": "⚡ Sub-Second Executor", "agent_id": "ag_6", "weight": 0.12}

            flt = market_scanner.get_symbol_filter(sym)
            tier_params = capital_tier_manager.get_tier_parameters(equity, slot_index=idx)
            multiplier = learning_engine.get_margin_multiplier(matched_ag["name"])
            alloc = max(10.0, equity * float(tier_params.get("margin_allocation_pct", 0.15)) * multiplier)
            side = coin.get("signal", "LONG")
            if side not in ("LONG", "SHORT"):
                side = "LONG" if idx == 0 else "SHORT"

            # Maker Entry: LONG at bestBid, SHORT at bestAsk
            book = market_scanner.book_tickers.get(sym, {})
            best_bid = float(book.get("bid") or book.get("bestBidPrice") or 0.0)
            best_ask = float(book.get("ask") or book.get("bestAskPrice") or 0.0)
            if side == "LONG":
                raw_target_p = best_bid if best_bid > 0 else mkt_p * 0.9995
            else:
                raw_target_p = best_ask if best_ask > 0 else mkt_p * 1.0005
            target_p = round_step(raw_target_p, flt["tick_size"])

            try:
                user_lev = int(db.get_setting("leverage_cap", "20"))
            except Exception:
                user_lev = 20

            raw_qty = (alloc * user_lev) / target_p if target_p > 0 else flt["min_qty"]
            min_notional_qty = (flt["min_notional"] / target_p) * 1.05 if target_p > 0 else flt["min_qty"]
            effective_qty = max(raw_qty, flt["min_qty"], min_notional_qty)
            qty = round_step(effective_qty, flt["step_size"])
            if qty < flt["min_qty"]:
                qty = flt["min_qty"]

            cand_atr = float(coin.get("atr") or (mkt_p * float(coin.get("atr_pct", 1.5)) / 100.0) or (mkt_p * 0.015))

            # Dynamic TP & SL based on Capital Tier
            tp_pct = float(tier_params["target_tp_pct"]) / 100.0
            sl_pct = float(tier_params["stop_loss_pct"]) / 100.0
            if side == "LONG":
                calc_tp = round_step(target_p * (1.0 + tp_pct), flt["tick_size"])
                calc_sl = round_step(target_p * (1.0 - sl_pct), flt["tick_size"])
            else:
                calc_tp = round_step(target_p * (1.0 - tp_pct), flt["tick_size"])
                calc_sl = round_step(target_p * (1.0 + sl_pct), flt["tick_size"])

            tier_tag = f"[{tier_params.get('mode')}:{tier_params.get('slot_type', 'TURBO')}]"
            paper_broker.plan_order(
                account_id=account_id,
                symbol=sym,
                side=side,
                order_type="LIMIT",
                target_price=target_p,
                current_price=mkt_p,
                agent_name=matched_ag["name"],
                quantity=qty,
                reason=f"{tier_tag} Başlangıç Garantili Emir ({matched_ag['name']} - Hedef TP %{tier_params['target_tp_pct']})",
                leverage=user_lev,
                atr=cand_atr,
                stop_loss=calc_sl,
                take_profit=calc_tp
            )
            learning_engine.update_agent_status(matched_ag["agent_id"], "PLANNING", sym)

        # 3. Check fills right away
        filled = paper_broker.check_and_fill_orders(market_scanner.prices)
        if filled:
            db.log(f"[{acc['name']}] İlk planlanan emirlerden {len(filled)} tanesi başarıyla eşleşti ve pozisyona dönüştü.", "INFO", "HFT")

    async def on_motor_stop(self, account_id: str, mode: str = "MARKET") -> Dict[str, Any]:
        """Handles stop scenarios and cancels pending planned orders."""
        acc = db.get_account(account_id)
        if not acc:
            return {"success": False, "error": "Hesap bulunamadı"}

        mode = mode.upper()
        db.update_account_state(account_id, "STOPPING", mode)
        db.log(f"[{acc['name']}] Motor DURDURULUYOR... Senaryo: {mode}", "WARN", "HFT")

        # 1. Cancel all PLANNED orders for this account
        planned = db.get_planned_orders(account_id)
        for ord in planned:
            db.update_order_status(ord["id"], "CANCELLED")
        db.log(f"[{acc['name']}] {len(planned)} adet bekleyen planlı emir iptal edildi.", "INFO", "HFT")

        # 2. Handle open positions
        open_positions = db.get_open_positions(account_id)
        closed_count = 0

        if mode in ("MARKET", "PANIC"):
            for pos in open_positions:
                cur_p = market_scanner.prices.get(pos["symbol"]) or float(pos["mark_price"])
                res = paper_broker.close_position(
                    pos["id"], cur_p, reason="Acil Panik Kapatma" if mode == "PANIC" else "Motor Durdurma (Market)"
                )
                if res:
                    closed_count += 1

            db.update_account_state(account_id, "STOPPED", "")
            db.set_setting("engine_running", "false")
            msg = f"İşlem tamamlandı, bot durduruldu. {closed_count} açık pozisyon kapatıldı, açık emir yok."
            db.log(f"[{acc['name']}] {msg}", "INFO", "HFT")
            return {"success": True, "engine_state": "STOPPED", "message": msg, "closed_positions": closed_count}

        elif mode in ("PROFIT_ONLY", "SOFT"):
            for pos in open_positions:
                if float(pos.get("pnl", 0)) > 0:
                    cur_p = market_scanner.prices.get(pos["symbol"]) or float(pos["mark_price"])
                    res = paper_broker.close_position(pos["id"], cur_p, reason="Kâr Hedefli Motor Kapatma")
                    if res:
                        closed_count += 1

            remaining = db.get_open_positions(account_id)
            if not remaining:
                db.update_account_state(account_id, "STOPPED", "")
                db.set_setting("engine_running", "false")
                msg = "Tüm kârlı pozisyonlar kapatıldı, bot durduruldu. Açık emir yok."
            else:
                msg = f"{closed_count} kârlı pozisyon kapatıldı. {len(remaining)} adet zararda pozisyon koruma altında bekliyor."

            db.log(f"[{acc['name']}] {msg}", "INFO", "HFT")
            return {"success": True, "engine_state": "STOPPING" if remaining else "STOPPED", "message": msg, "closed_positions": closed_count}

        else:  # KEEP
            db.update_account_state(account_id, "STOPPED", "")
            db.set_setting("engine_running", "false")
            msg = "İşlem tamamlandı, bot durduruldu. Açık pozisyonlar korundu, açık emir yok."
            db.log(f"[{acc['name']}] {msg}", "INFO", "HFT")
            return {"success": True, "engine_state": "STOPPED", "message": msg, "closed_positions": 0}

    async def _engine_loop(self):
        while self._running:
            try:
                # 1. Update Market Scanner
                await market_scanner.scan()
                prices = market_scanner.prices

                # 2. Check and Fill any PLANNED orders that touched market price
                paper_broker.check_and_fill_orders(prices)

                # 3. Update Mark Prices, Trailing Stop, Breakeven & Dead-Position Timeout
                paper_broker.update_positions_pnl_live()

                # 4. For active accounts in RUNNING state, evaluate new signals if under max positions
                accounts = db.get_accounts()
                now_ts = time.time()
                for acc in accounts:
                    if acc.get("engine_state") != "RUNNING":
                        continue

                    # Soğuma Kalkanı: Üst üste 2 zarar sonrası 45dk mola kontrolü
                    if paper_broker.is_loss_streak_cooldown_active():
                        continue

                    # ADIM 1: GÜNLÜK SERT İŞLEM KOTASI (MAX 6 İŞLEM)
                    today_str = time.strftime("%Y-%m-%d")
                    all_trades = db.get_trades(acc["id"], limit=100)
                    today_trades_count = len([
                        t for t in all_trades 
                        if (t.get("closed_at") or t.get("created_at") or "").startswith(today_str)
                    ])
                    if today_trades_count >= 6:
                        continue

                    acc_positions = db.get_open_positions(acc["id"])
                    # Eşzamanlı en fazla 2 pozisyon (Kasa bölünmez)
                    if len(acc_positions) >= 2:
                        continue

                    balance = float(acc["balance"])
                    if balance < 20.0:
                        continue

                    active_syms = {p["symbol"] for p in acc_positions}
                    planned_syms = {o["symbol"] for o in db.get_planned_orders(acc["id"])}
                    busy_syms = active_syms.union(planned_syms)

                    # BTC Trend / Rejim Filtresi: 15m EMA20 vs EMA50
                    btc_regime = await market_scanner.get_btc_regime()
                    allowed_side = btc_regime.get("allowed_side", "ANY")

                    # Find candidates from radar (10s cooldown)
                    candidates = [
                        c for c in market_scanner.radar
                        if c["signal"] in ("LONG", "SHORT")
                        and c["score"] >= 70
                        and c["symbol"] not in busy_syms
                        and (now_ts - self._cooldowns.get(c["symbol"], 0)) > 10.0
                    ]

                    # Parallel evaluate top 5 candidates against BTC regime & Council
                    chosen_target = None
                    consensus_data = None
                    for cand in candidates[:5]:
                        cand_sig = cand.get("signal", "LONG")
                        # BTC Trend Filtresi: Düşüş trendinde LONG açmak KESİNLİKLE YASAK! Yükselişte SHORT yasak!
                        if allowed_side in ("LONG", "SHORT") and cand_sig != allowed_side:
                            continue

                        # Hacim / Volatilite Kırılımı Kontrolü (Volume Surge >= 3.0x veya yüksek vadeli hacim)
                        vol_surge = float(cand.get("vol_surge", 1.0))
                        fut_vol = float(cand.get("futures_vol", 0.0))
                        if vol_surge < 3.0 and fut_vol < 30_000_000.0:
                            continue

                        # Retest / Pullback Teyidi (RSI 45-60 bandı)
                        cand_rsi = float(cand.get("rsi") or cand.get("rsi_14", 50.0))
                        if not (45.0 <= cand_rsi <= 60.0):
                            continue

                        c_eval = jev_agent.evaluate_consensus(cand["symbol"], cand_sig, cand)
                        appr_pct = float(c_eval.get("approval_rate") or c_eval.get("consensus_rate") or 0.0)
                        # Sadece Konsey Güven Skoru %85 ve üzeri olan net trendler
                        if c_eval.get("approved") and appr_pct >= 85.0:
                            chosen_target = cand
                            consensus_data = c_eval
                            break

                    if not chosen_target or not consensus_data:
                        continue

                    # ADIM 2: MULTIMODAL VISION CHART AJANI TEYİDİ & SAHTE KIRILIM/DİRENÇ ENGELİ
                    target = chosen_target
                    target_sym = "BTCUSDT" if target["symbol"].upper() == "BTWUSDT" else target["symbol"].upper()
                    side = consensus_data["direction"]

                    try:
                        from app.services.vision_chart_agent import vision_chart_agent
                        v_eval = await vision_chart_agent.evaluate_symbol(target_sym, side)
                        if not v_eval.get("approved", True) or float(v_eval.get("confidence", 0.70)) < 0.70:
                            db.log(
                                f"[VISION FİLTRESİ 👁️] {target_sym} {side} elendi: {v_eval.get('reason')} (Güven: %{float(v_eval.get('confidence', 0.70))*100:.0f})",
                                "WARN", "VISION"
                            )
                            self._cooldowns[target_sym] = now_ts + 60.0  # 60s cooldown
                            continue
                    except Exception as e:
                        db.log(f"[VISION BYPASS] Teyit hatası ({e}), varsayılan ile devam edildi.", "WARN", "VISION")
                    matched_ag = learning_engine.get_agent_by_name(target.get("focused_agent", ""))
                    if matched_ag:
                        assigned_agent = matched_ag["name"]
                        agent_id = matched_ag["agent_id"]
                    else:
                        agents = learning_engine.get_agents()
                        assigned_agent = agents[0]["name"] if agents else "⚡ Sub-Second Executor"
                        agent_id = agents[0]["agent_id"] if agents else "ag_6"

                    # Check agent cooldown
                    if learning_engine.is_agent_in_cooldown(agent_id):
                        db.log(f"[{assigned_agent}] Dinlenmede (cooldown aktif), işlem atandı: ⚡ Sub-Second Executor", "INFO", "LEARNING")
                        assigned_agent = "⚡ Sub-Second Executor"
                        agent_id = "ag_6"

                    eq_info = paper_broker.get_account_equity(acc["id"])
                    equity = float(eq_info.get("equity", balance))
                    slot_idx = len(acc_positions)
                    tier_params = capital_tier_manager.get_tier_parameters(equity, slot_index=slot_idx)

                    multiplier = learning_engine.get_margin_multiplier(assigned_agent)
                    margin = equity * float(tier_params.get("margin_allocation_pct", 0.15)) * multiplier

                    # Tauric Research "Şeytanın Avukatı" (Adversarial Critic) Protokolü
                    critic = consensus_data.get("adversarial_critic", {})
                    if critic.get("trap_risk"):
                        margin_penalty = float(critic.get("margin_penalty", 0.50))
                        margin *= margin_penalty
                        db.log(
                            f"[JEV DEBATE] ⚖️ Konsey onayladı. Şeytanın Avukatı tuzak riski bildirdi ({critic.get('trap_type')}) -> Marjin %50 kısılarak güvenli giriş yapıldı.",
                            "WARN", "JEV_DEBATE"
                        )

                    if margin < 10.0:
                        margin = 10.0

                    flt = market_scanner.get_symbol_filter(target_sym)
                    mkt_p = float(target["price"])
                    best_bid = float(target.get("bestBid") or mkt_p * 0.9995)
                    best_ask = float(target.get("bestAsk") or mkt_p * 1.0005)
                    raw_target_p = best_bid if side == "LONG" else best_ask
                    target_p = round_step(raw_target_p, flt["tick_size"])

                    try:
                        user_lev = int(db.get_setting("leverage_cap", "20"))
                    except Exception:
                        user_lev = 20

                    raw_qty = (margin * user_lev) / target_p if target_p > 0 else flt["min_qty"]
                    min_notional_qty = (flt["min_notional"] / target_p) * 1.05 if target_p > 0 else flt["min_qty"]
                    effective_qty = max(raw_qty, flt["min_qty"], min_notional_qty)
                    qty = round_step(effective_qty, flt["step_size"])
                    if qty < flt["min_qty"]:
                        qty = flt["min_qty"]

                    # KeyError güvenli agreement_ratio erişimi
                    agreement_ratio = (
                        consensus_data.get('agreement_ratio') or 
                        consensus_data.get('consensus_rate') or 
                        consensus_data.get('approval_pct') or 
                        consensus_data.get('confidence') or 
                        f"{consensus_data.get('yes_count', 0)}/{consensus_data.get('total_votes', 11)}" or
                        0.0
                    )

                    tier_tag = f"[{tier_params.get('mode')}:{tier_params.get('slot_type', 'TURBO')}]"
                    reason_msg = f"{tier_tag} Jev AI Konsensüs Onayı ({agreement_ratio} {side}) | Skor: {target['score']} | Hedef TP %{tier_params['target_tp_pct']}"
                    if critic.get("trap_risk"):
                        reason_msg += f" | Şeytanın Avukatı: {critic.get('trap_type')} (Marjin %50)"

                    cand_atr = float(target.get("atr") or (mkt_p * float(target.get("atr_pct", 1.5)) / 100.0) or (mkt_p * 0.015))

                    # Dynamic TP & SL based on Capital Tier
                    tp_pct = float(tier_params["target_tp_pct"]) / 100.0
                    sl_pct = float(tier_params["stop_loss_pct"]) / 100.0
                    if side == "LONG":
                        calc_tp = round_step(target_p * (1.0 + tp_pct), flt["tick_size"])
                        calc_sl = round_step(target_p * (1.0 - sl_pct), flt["tick_size"])
                    else:
                        calc_tp = round_step(target_p * (1.0 - tp_pct), flt["tick_size"])
                        calc_sl = round_step(target_p * (1.0 + sl_pct), flt["tick_size"])

                    paper_broker.plan_order(
                        account_id=acc["id"],
                        symbol=target_sym,
                        side=side,
                        order_type="LIMIT",
                        target_price=target_p,
                        current_price=mkt_p,
                        agent_name=assigned_agent,
                        quantity=qty,
                        reason=reason_msg,
                        leverage=user_lev,
                        atr=cand_atr,
                        stop_loss=calc_sl,
                        take_profit=calc_tp
                    )
                    learning_engine.update_agent_status(agent_id, "PLANNING", target_sym)
                    self._cooldowns[target_sym] = now_ts

            except asyncio.CancelledError:
                break
            except Exception as e:
                db.log(f"HFT Döngü hatası: {e}", "ERROR", "HFT")

            await asyncio.sleep(0.8)


hft_engine = HFTEngine()
