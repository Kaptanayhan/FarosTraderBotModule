"""Jev AI Orchestrator & Hierarchical Task Delegator.
Coordinates the 11-Agent High Council (Mixture-of-Agents):
1. Detects opportunity from initial triggers (Scalper, Breakout, WhaleFlow, etc.).
2. Delegated Review: Jev delegates deep cross-analysis to at least 4 cross-agents (L2, Momentum, LiqHunter, Sentinel, etc.).
3. Executes High Council Voting: Requires >= 70% 'YES' and NO Sentinel Veto to approve execution.
"""
from typing import Dict, Any, List, Optional
import time
from datetime import datetime

from app.db import db
from app.services.market_scanner import market_scanner
from app.services.indicator_engine import indicator_engine
from app.services.risk_sentinel import risk_sentinel
from app.services.consensus_council import consensus_council


class JevAgent:
    def __init__(self):
        self.consensus_rule = "Sentinel Vetosu Olmamalı & En Az %70 'YES' Oyu (%70+ Eşiği)"
        self.last_consensus: Dict[str, Any] = {
            "approved": False,
            "direction": "BEKLE",
            "symbol": "BTCUSDT",
            "approval_rate": 0.0,
            "yes_count": 0,
            "total_votes": 11,
            "has_sentinel_veto": False,
            "status_text": "Yüksek Konsey Beklemede",
            "reason": "Henüz oylama başlatılmadı",
            "initiator_agent": "⚡ Scalper Ajanı",
            "delegated_agents": ["orderbook_l2", "momentum", "liq_hunter", "sentinel_risk"],
            "votes": {}
        }
        self.last_lightning_matrix: Dict[str, Any] = {
            "symbol": "BTCUSDT",
            "direction": "LONG",
            "passed_count": 6,
            "total_checks": 6,
            "approved": True,
            "approval_rate": 100.0,
            "has_sentinel_veto": False,
            "checks": [
                {"name": "L2_DEPTH", "label": "L2 DERİNLİK", "passed": True, "score": 92, "reason": "Tahta Dengesi +%12"},
                {"name": "CVD_VOLUME", "label": "CVD BASKISI", "passed": True, "score": 88, "reason": "Net Alıcı Baskısı"},
                {"name": "MOMENTUM", "label": "MOMENTUM", "passed": True, "score": 85, "reason": "RSI 54 Uyumlu"},
                {"name": "TREND_ALIGN", "label": "TREND ONAYI", "passed": True, "score": 90, "reason": "EMA 9/21 Hizalı"},
                {"name": "LIQUIDATION_VOID", "label": "LİKİDASYON", "passed": True, "score": 86, "reason": "Likidite Havuzu"},
                {"name": "SENTINEL_RISK", "label": "SENTINEL RİSK", "passed": True, "score": 95, "reason": "Kasa Marjini Temiz"}
            ],
            "timestamp": time.time(),
            "reason": "6'lı Yıldırım Doğrulama: 6/6 Tam Onay"
        }
        self.active_inquiry: Dict[str, Any] = {
            "in_progress": False,
            "symbol": "BTCUSDT",
            "initiator": "⚡ Scalper Ajanı",
            "target_dir": "LONG",
            "target_agents": ["orderbook_l2", "momentum", "liq_hunter", "sentinel_risk"],
            "timestamp": time.time()
        }

    def trigger_opportunity_inquiry(self, symbol: str, initiator_id: str, target_dir: str):
        """Sets active inquiry state for visual animation: Jev -> Agents (purple pulse)."""
        initiator = consensus_council.get_agent(initiator_id)
        name = initiator.name if initiator else "⚡ Scalper Ajanı"
        
        # Select cross-agents for deep inquiry
        delegated = ["orderbook_l2", "momentum", "liq_hunter", "sentinel_risk", "trend_ema", "volatility"]
        self.active_inquiry = {
            "in_progress": True,
            "symbol": symbol,
            "initiator": name,
            "target_dir": target_dir,
            "target_agents": delegated,
            "timestamp": time.time()
        }

    def evaluate_consensus(
        self,
        symbol: str,
        target_direction: Optional[str] = None,
        candidate_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Runs the full 11-agent council evaluation with Jev's hierarchical task delegation."""
        radar_items = {r["symbol"]: r for r in market_scanner.radar}
        market_item = candidate_data or radar_items.get(symbol, {})
        
        price = float(market_item.get("price", 0.0)) or market_scanner.prices.get(symbol, float(market_item.get("futures_price", 100.0)))
        pct = float(market_item.get("price_change_pct", 0.0))
        vol = float(market_item.get("futures_vol", 10_000_000.0))
        obi = float(market_item.get("obi", 0.0))
        
        # Calculate full 10-indicator matrix
        indicators = indicator_engine.compute_matrix(
            symbol=symbol,
            current_price=price,
            price_change_24h=pct,
            high_24h=price * (1.0 + abs(pct)/100.0),
            low_24h=price * (1.0 - abs(pct)/100.0),
            volume_24h=vol,
            bid_vol=vol * 0.52 if pct >= 0 else vol * 0.48,
            ask_vol=vol * 0.48 if pct >= 0 else vol * 0.52,
            funding_rate=0.0001
        )

        # Sentinel account context
        account_ctx = risk_sentinel.get_status()

        # Determine target direction if not explicitly supplied
        if target_direction:
            direction = target_direction.upper()
        else:
            direction = "LONG" if pct >= 0 else "SHORT"

        # Determine initiator
        if abs(float(indicators.get("cvd", 0.0))) > 50000:
            initiator_id = "whale_flow"
        elif abs(pct) >= 1.5:
            initiator_id = "breakout"
        else:
            initiator_id = "scalper"

        self.trigger_opportunity_inquiry(symbol, initiator_id, direction)

        # Delegate review to all 11 agents in the High Council
        council_result = consensus_council.evaluate_council(
            symbol=symbol,
            target_dir=direction,
            indicators=indicators,
            market_item=market_item,
            account_ctx=account_ctx
        )

        council_result["initiator_agent"] = consensus_council.get_agent(initiator_id).name
        council_result["delegated_agents"] = list(consensus_council.agents.keys())
        council_result["timestamp"] = datetime.utcnow().strftime("%H:%M:%S")

        self.last_consensus = council_result
        self.active_inquiry["in_progress"] = False

        critic = council_result.get("adversarial_critic", {})
        if council_result["approved"]:
            if critic.get("trap_risk"):
                db.log(
                    f"[JEV DEBATE] ⚖️ Konsey onayladı. Şeytanın Avukatı tuzak riski bildirdi ({critic.get('trap_type')}) -> Marjin %50 kısılarak güvenli giriş yapıldı.",
                    "WARN",
                    "JEV_DEBATE"
                )
            else:
                db.log(
                    f"🧠 [JEV KONSENSÜS ONAYI]: {symbol} {direction} | %{council_result['approval_rate']:.0f} Onay ({council_result['yes_count']}/11 Ajan) | Sentinel: TEMİZ",
                    "INFO",
                    "JEV_AI"
                )
        elif council_result["has_sentinel_veto"]:
            db.log(
                f"🛡️ [JEV VETO]: {symbol} {direction} Sentinel tarafından veto edildi: {council_result['reason']}",
                "WARNING",
                "SENTINEL"
            )

        return council_result

    def evaluate_lightning_matrix(
        self,
        symbol: str,
        target_direction: Optional[str] = None,
        candidate_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Calculates 6 lightning verification checks within 50-100ms.
        1. L2_DEPTH (Tahta dengesizliği / OBI)
        2. CVD_VOLUME (Net alıcı baskısı)
        3. MOMENTUM (RSI / MACD uyumu)
        4. TREND_ALIGN (EMA 9/21/200 hizalanması)
        5. LIQUIDATION_VOID (Tasfiye havuzu potansiyeli)
        6. SENTINEL_RISK (Kasa riski ve teminat yeterliliği)
        En az 4 kontrol PASSED ve Sentinel Vetosu yoksa ONAY.
        """
        radar_items = {r["symbol"]: r for r in market_scanner.radar}
        market_item = radar_items.get(symbol, candidate_data or {})
        price = market_scanner.prices.get(symbol, float(market_item.get("price", market_item.get("futures_price", 100.0))))
        pct = float(market_item.get("price_change_pct", 0.0))
        vol = float(market_item.get("futures_vol", 10_000_000.0))
        obi = float(market_item.get("obi", 0.0))
        direction = (target_direction or ("LONG" if pct >= 0 else "SHORT")).upper()

        indicators = indicator_engine.compute_matrix(
            symbol=symbol,
            current_price=price,
            price_change_24h=pct,
            high_24h=price * (1.0 + abs(pct)/100.0),
            low_24h=price * (1.0 - abs(pct)/100.0),
            volume_24h=vol,
            bid_vol=vol * (0.54 if direction == "LONG" else 0.46),
            ask_vol=vol * (0.46 if direction == "LONG" else 0.54),
            funding_rate=0.0001
        )
        account_ctx = risk_sentinel.get_status()

        # 1. L2_DEPTH
        l2_passed = (obi >= -0.05) if direction == "LONG" else (obi <= 0.05)
        l2_score = min(99, max(45, int(60 + obi * 100))) if direction == "LONG" else min(99, max(45, int(60 - obi * 100)))

        # 2. CVD_VOLUME
        cvd = float(indicators.get("cvd", 0.0))
        cvd_passed = (cvd >= -30000.0) if direction == "LONG" else (cvd <= 30000.0)
        cvd_score = 88 if cvd_passed else 42

        # 3. MOMENTUM
        rsi = float(indicators.get("rsi_14", 50.0))
        mom_passed = (rsi >= 40.0 and rsi <= 76.0) if direction == "LONG" else (rsi <= 60.0 and rsi >= 24.0)
        mom_score = 85 if mom_passed else 44

        # 4. TREND_ALIGN
        ema_9 = float(indicators.get("ema_9", price))
        ema_21 = float(indicators.get("ema_21", price))
        trend_passed = (ema_9 >= ema_21 * 0.999) if direction == "LONG" else (ema_9 <= ema_21 * 1.001)
        trend_score = 90 if trend_passed else 40

        # 5. LIQUIDATION_VOID
        liq_passed = abs(pct) >= 0.4 or vol >= 4_000_000.0 or abs(obi) > 0.04
        liq_score = 84 if liq_passed else 48

        # 6. SENTINEL_RISK
        sentinel_veto = account_ctx.get("status") == "CRITICAL" or account_ctx.get("margin_usage_pct", 0) > 85.0
        sentinel_passed = not sentinel_veto
        sentinel_score = 96 if sentinel_passed else 15

        checks = [
            {"name": "L2_DEPTH", "label": "L2 DERİNLİK", "passed": l2_passed, "score": l2_score, "reason": f"OBI: {obi:+.2f}"},
            {"name": "CVD_VOLUME", "label": "CVD BASKISI", "passed": cvd_passed, "score": cvd_score, "reason": f"CVD: ${cvd:,.0f}"},
            {"name": "MOMENTUM", "label": "MOMENTUM", "passed": mom_passed, "score": mom_score, "reason": f"RSI: {rsi:.1f}"},
            {"name": "TREND_ALIGN", "label": "TREND ONAYI", "passed": trend_passed, "score": trend_score, "reason": "EMA 9/21 Hizası"},
            {"name": "LIQUIDATION_VOID", "label": "LİKİDASYON", "passed": liq_passed, "score": liq_score, "reason": "Likidite Havuzu"},
            {"name": "SENTINEL_RISK", "label": "SENTINEL RİSK", "passed": sentinel_passed, "score": sentinel_score, "reason": "Kasa Marjini Temiz" if sentinel_passed else "Marjin Kısıtlandı"}
        ]

        passed_count = sum(1 for c in checks if c["passed"])
        approved = (passed_count >= 4) and not sentinel_veto
        approval_rate = round((passed_count / 6.0) * 100, 1)

        result = {
            "symbol": symbol,
            "direction": direction,
            "passed_count": passed_count,
            "total_checks": 6,
            "approved": approved,
            "approval_rate": approval_rate,
            "has_sentinel_veto": sentinel_veto,
            "checks": checks,
            "timestamp": time.time(),
            "reason": f"6'lı Yıldırım Doğrulama: {passed_count}/6 Geçti" + (" (Sentinel Onaylı)" if approved else " (Yetersiz Skor)")
        }
        self.last_lightning_matrix = result
        return result

    def get_live_telemetry(self) -> Dict[str, Any]:
        """Provides full telemetry of Jev Decision Core & 11 Council Agents."""
        yes_c = int(self.last_consensus.get("yes_count", 0))
        tot_v = int(self.last_consensus.get("total_votes", 11))
        calc_ratio = round(yes_c / tot_v, 2) if tot_v > 0 else 0.0
        agreement_ratio_val = float(self.last_consensus.get("agreement_ratio_val", calc_ratio))
        consensus_rate = float(self.last_consensus.get("consensus_rate", round(calc_ratio * 100, 1)))

        return {
            "consensus_rule": self.consensus_rule,
            "target_symbol": self.last_consensus.get("symbol", "BTCUSDT"),
            "target_direction": self.last_consensus.get("direction", "BEKLE"),
            "approved": bool(self.last_consensus.get("approved", False)),
            "approval_rate": consensus_rate,
            "consensus_rate": consensus_rate,
            "agreement_ratio": agreement_ratio_val,
            "agreement_ratio_str": f"{yes_c}/{tot_v}",
            "yes_count": yes_c,
            "total_votes": tot_v,
            "has_sentinel_veto": bool(self.last_consensus.get("has_sentinel_veto", False)),
            "adversarial_critic": self.last_consensus.get("adversarial_critic", {
                "trap_risk": False,
                "trap_type": "YOK",
                "margin_penalty": 1.0,
                "sl_reduction": 1.0,
                "reason": "Ters tuzak tespit edilmedi",
                "critic_status": "ONAY"
            }),
            "status_text": self.last_consensus.get("status_text", "Yüksek Konsey Beklemede"),
            "reason": self.last_consensus.get("reason", ""),
            "initiator_agent": self.last_consensus.get("initiator_agent", "⚡ Scalper Ajanı"),
            "inquiry": self.active_inquiry,
            "lightning_matrix": self.last_lightning_matrix,
            "agents": consensus_council.get_all_agents_summary(),
            "votes": self.last_consensus.get("votes", {})
        }


jev_agent = JevAgent()
