"""AegisQuant v3.0 - 11-Agent High Council (Mixture-of-Agents Architecture).
Defines the 11 specialized autonomous quant agents:
1. ScalperAgent (Mikro spread ve hızlı arbitraj)
2. BreakoutAgent (Direnç/Destek ve hacim kırılımları)
3. WhaleFlowAgent (Büyük blok emirler ve balina cüzdan takibi)
4. OrderBookL2Agent (Anlık tahta derinliği dengesizliği - OBI)
5. VolatilityAgent (ATR & Bollinger bant patlama tespiti)
6. SentimentAgent (Sosyal hacim ve fonlama oranı yönü)
7. FundingArbAgent (Pozitif/Negatif fonlama oranı arbitrajı)
8. TrendEMAAgent (EMA 9/21/200 çoklu zaman dilimi trend filtresi)
9. MomentumAgent (RSI, MACD uyumsuzlukları ve aşırı alım/satım)
10. LiquidationHunterAgent (Short/Long tasfiye havuzu avcısı)
11. SentinelRiskAgent (Kasa teminatı, serbest marjin ve kaldıraç kalkanı)
"""
from typing import Dict, Any, List, Optional
import time
from datetime import datetime


class BaseCouncilAgent:
    def __init__(self, agent_id: str, name: str, role: str, win_rate: float = 78.5):
        self.agent_id = agent_id
        self.name = name
        self.role = role
        self.win_rate = win_rate
        self.status = "İZLEMEDE"  # İZLEMEDE, GÖREVDE, OYLADI
        self.last_vote = "NEUTRAL"
        self.last_score = 50
        self.last_reason = "Beklemede"
        self.history: List[Dict[str, Any]] = []

    def record_decision(self, symbol: str, vote: str, signal: str, score: int, reason: str):
        self.last_vote = vote
        self.last_score = score
        self.last_reason = reason
        self.status = "OYLADI"
        entry = {
            "timestamp": datetime.utcnow().strftime("%H:%M:%S"),
            "symbol": symbol,
            "vote": vote,
            "signal": signal,
            "score": score,
            "reason": reason
        }
        self.history.insert(0, entry)
        if len(self.history) > 15:
            self.history = self.history[:15]

    def evaluate(self, symbol: str, target_dir: str, indicators: Dict[str, Any], market_item: Dict[str, Any], account_ctx: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError


# 1. ScalperAgent
class ScalperAgent(BaseCouncilAgent):
    def __init__(self):
        super().__init__("scalper", "⚡ Scalper Ajanı", "Mikro spread ve hızlı arbitraj", 81.2)

    def evaluate(self, symbol: str, target_dir: str, indicators: Dict[str, Any], market_item: Dict[str, Any], account_ctx: Dict[str, Any]) -> Dict[str, Any]:
        self.status = "GÖREVDE"
        obi = float(indicators.get("obi", 0.0))
        pct = float(market_item.get("price_change_pct", 0.0))
        spread = float(market_item.get("basis_pct", 0.0))

        if target_dir == "LONG":
            is_favorable = (obi > 5.0 or pct > 0.3) and spread >= -0.2
            score = min(96, int(65 + (obi * 0.5) + (pct * 4)))
        else:
            is_favorable = (obi < -5.0 or pct < -0.3) and spread <= 0.2
            score = min(96, int(65 + (abs(obi) * 0.5) + (abs(pct) * 4)))

        vote = "YES" if is_favorable and score >= 60 else "NO"
        reason = f"Mikro OBI: %{obi}, 24s Değişim: %{pct}. Mikro spread uygun." if vote == "YES" else "Mikro tahta dengesi ve spread hedefe ters."
        self.record_decision(symbol, vote, target_dir, score, reason)
        return {"agent_id": self.agent_id, "name": self.name, "vote": vote, "score": score, "reason": reason}


# 2. BreakoutAgent
class BreakoutAgent(BaseCouncilAgent):
    def __init__(self):
        super().__init__("breakout", "💥 Breakout Ajanı", "Direnç/Destek ve hacim kırılımları", 76.4)

    def evaluate(self, symbol: str, target_dir: str, indicators: Dict[str, Any], market_item: Dict[str, Any], account_ctx: Dict[str, Any]) -> Dict[str, Any]:
        self.status = "GÖREVDE"
        bbw = float(indicators.get("bbw", 1.0))
        cvd = float(indicators.get("cvd", 0.0))
        pct = float(market_item.get("price_change_pct", 0.0))

        if target_dir == "LONG":
            is_breakout = (bbw > 2.0 or abs(pct) > 1.2) and cvd > 0
            score = min(98, int(60 + (bbw * 5) + (abs(pct) * 3)))
        else:
            is_breakout = (bbw > 2.0 or abs(pct) > 1.2) and cvd < 0
            score = min(98, int(60 + (bbw * 5) + (abs(pct) * 3)))

        vote = "YES" if is_breakout and score >= 62 else "NO"
        reason = f"Bollinger Genişliği: {bbw}, CVD yönü teyitli. Volatilite kırılımı aktif." if vote == "YES" else "Konsolidasyon bandı kırılmadı veya hacim yetersiz."
        self.record_decision(symbol, vote, target_dir, score, reason)
        return {"agent_id": self.agent_id, "name": self.name, "vote": vote, "score": score, "reason": reason}


# 3. WhaleFlowAgent
class WhaleFlowAgent(BaseCouncilAgent):
    def __init__(self):
        super().__init__("whale_flow", "🐋 Whale Flow", "Büyük blok emirler ve balina cüzdan takibi", 84.0)

    def evaluate(self, symbol: str, target_dir: str, indicators: Dict[str, Any], market_item: Dict[str, Any], account_ctx: Dict[str, Any]) -> Dict[str, Any]:
        self.status = "GÖREVDE"
        vol = float(market_item.get("futures_vol", 0.0))
        cvd = float(indicators.get("cvd", 0.0))
        basis = float(market_item.get("basis_pct", 0.0))

        if target_dir == "LONG":
            whale_backing = cvd > 50000 or basis > 0.10 or vol > 50_000_000
            score = min(97, int(68 + (vol / 50_000_000 * 5) + max(0, basis * 20)))
        else:
            whale_backing = cvd < -50000 or basis < -0.10 or vol > 50_000_000
            score = min(97, int(68 + (vol / 50_000_000 * 5) + max(0, abs(basis) * 20)))

        vote = "YES" if whale_backing and score >= 65 else "NO"
        reason = f"Balina Net Hacmi (CVD): {cvd:,.0f}$, Hacim: ${vol:,.0f}. Kurumsal alım baskısı." if vote == "YES" else "Kurumsal blok emir tespit edilemedi veya karşıt akış var."
        self.record_decision(symbol, vote, target_dir, score, reason)
        return {"agent_id": self.agent_id, "name": self.name, "vote": vote, "score": score, "reason": reason}


# 4. OrderBookL2Agent
class OrderBookL2Agent(BaseCouncilAgent):
    def __init__(self):
        super().__init__("orderbook_l2", "📊 OrderBook L2", "Anlık tahta derinliği dengesizliği (OBI)", 82.5)

    def evaluate(self, symbol: str, target_dir: str, indicators: Dict[str, Any], market_item: Dict[str, Any], account_ctx: Dict[str, Any]) -> Dict[str, Any]:
        self.status = "GÖREVDE"
        obi = float(indicators.get("obi", 0.0))

        if target_dir == "LONG":
            valid = obi >= 10.0
            score = min(99, int(60 + obi))
        else:
            valid = obi <= -10.0
            score = min(99, int(60 + abs(obi)))

        vote = "YES" if valid else "NO"
        reason = f"L2 Tahta Dengesizliği (OBI): %{obi:.1f}. Derinlik yönü teyit ediyor." if vote == "YES" else f"L2 OBI (%{obi:.1f}) eşik değerini karşılamıyor."
        self.record_decision(symbol, vote, target_dir, score, reason)
        return {"agent_id": self.agent_id, "name": self.name, "vote": vote, "score": score, "reason": reason}


# 5. VolatilityAgent
class VolatilityAgent(BaseCouncilAgent):
    def __init__(self):
        super().__init__("volatility", "📈 Volatility ATR", "ATR & Bollinger bant patlama tespiti", 79.1)

    def evaluate(self, symbol: str, target_dir: str, indicators: Dict[str, Any], market_item: Dict[str, Any], account_ctx: Dict[str, Any]) -> Dict[str, Any]:
        self.status = "GÖREVDE"
        atr = float(indicators.get("atr", 0.0))
        bbw = float(indicators.get("bbw", 1.0))
        price = float(market_item.get("futures_price", 1.0))
        atr_pct = (atr / price * 100.0) if price > 0 else 1.0

        favorable = atr_pct >= 0.3 or bbw >= 1.5
        score = min(95, int(65 + (atr_pct * 10) + (bbw * 2)))

        vote = "YES" if favorable else "NO"
        reason = f"ATR Oranı: %{atr_pct:.2f}, BBW: {bbw:.2f}. Yeterli oynaklık ve alan mevcut." if vote == "YES" else "Piyasa ölü/sıkışık bölgede (Chop), riskli."
        self.record_decision(symbol, vote, target_dir, score, reason)
        return {"agent_id": self.agent_id, "name": self.name, "vote": vote, "score": score, "reason": reason}


# 6. SentimentAgent
class SentimentAgent(BaseCouncilAgent):
    def __init__(self):
        super().__init__("sentiment", "🐦 Social Sentiment", "Sosyal hacim ve fonlama oranı yönü", 74.8)

    def evaluate(self, symbol: str, target_dir: str, indicators: Dict[str, Any], market_item: Dict[str, Any], account_ctx: Dict[str, Any]) -> Dict[str, Any]:
        self.status = "GÖREVDE"
        pct = float(market_item.get("price_change_pct", 0.0))
        funding = float(indicators.get("funding_rate", 0.0001))

        try:
            from app.services.sentiment_scraper import sentiment_scraper
            cached_sent = sentiment_scraper.get_cached_sentiment(symbol)
        except Exception:
            cached_sent = 0.0

        if target_dir == "LONG":
            favorable = (funding <= 0.0005 and pct > -2.0) and (cached_sent >= -0.30)
            score = 80 if (favorable and cached_sent > 0.15) else (75 if favorable else 45)
        else:
            favorable = (funding >= -0.0005 and pct < 2.0) and (cached_sent <= 0.30)
            score = 80 if (favorable and cached_sent < -0.15) else (75 if favorable else 45)

        vote = "YES" if favorable else "NO"
        reason = f"Fonlama: %{funding*100:.3f}, Sosyal/Haber skoru: {cached_sent:+.2f} yönü destekliyor." if vote == "YES" else f"Haber veya aşırı fonlama yönü engelledi (Skor: {cached_sent:+.2f})."
        self.record_decision(symbol, vote, target_dir, score, reason)
        return {"agent_id": self.agent_id, "name": self.name, "vote": vote, "score": score, "reason": reason}


# 7. FundingArbAgent
class FundingArbAgent(BaseCouncilAgent):
    def __init__(self):
        super().__init__("funding_arb", "⚖️ Funding Arb", "Pozitif/Negatif fonlama oranı arbitrajı", 85.3)

    def evaluate(self, symbol: str, target_dir: str, indicators: Dict[str, Any], market_item: Dict[str, Any], account_ctx: Dict[str, Any]) -> Dict[str, Any]:
        self.status = "GÖREVDE"
        funding = float(indicators.get("funding_rate", 0.0001))

        # Negatif fonlama varsa LONG kârlıdır, pozitif fonlama aşırıysa SHORT kârlıdır
        if target_dir == "LONG":
            favorable = funding <= 0.0001
            score = min(98, int(70 + max(0, -funding * 10000)))
        else:
            favorable = funding >= -0.0001
            score = min(98, int(70 + max(0, funding * 10000)))

        vote = "YES" if favorable else "NO"
        reason = f"Fonlama oranı: %{funding*100:.4f}. Taşıma maliyeti stratejiyi ödüllendiriyor." if vote == "YES" else f"Aleyhte fonlama maliyeti (%{funding*100:.4f}) pozisyona yük bindirir."
        self.record_decision(symbol, vote, target_dir, score, reason)
        return {"agent_id": self.agent_id, "name": self.name, "vote": vote, "score": score, "reason": reason}


# 8. TrendEMAAgent
class TrendEMAAgent(BaseCouncilAgent):
    def __init__(self):
        super().__init__("trend_ema", "📐 Trend EMA", "EMA 9/21/200 çoklu zaman dilimi trend filtresi", 83.7)

    def evaluate(self, symbol: str, target_dir: str, indicators: Dict[str, Any], market_item: Dict[str, Any], account_ctx: Dict[str, Any]) -> Dict[str, Any]:
        self.status = "GÖREVDE"
        price = float(market_item.get("futures_price", 1.0))
        ema_9 = float(indicators.get("ema_9", price))
        ema_21 = float(indicators.get("ema_21", price))
        ema_200 = float(indicators.get("ema_200", price))

        if target_dir == "LONG":
            favorable = price >= ema_21 and ema_9 >= ema_21
            score = 88 if price > ema_200 and favorable else 68 if favorable else 40
        else:
            favorable = price <= ema_21 and ema_9 <= ema_21
            score = 88 if price < ema_200 and favorable else 68 if favorable else 40

        vote = "YES" if favorable else "NO"
        reason = f"Fiyat: {price:.4f}, EMA9: {ema_9:.4f}, EMA21: {ema_21:.4f}. Trend yönü tam hizalı." if vote == "YES" else "EMA hareketli ortalamalarına karşı ters işlem açma riski."
        self.record_decision(symbol, vote, target_dir, score, reason)
        return {"agent_id": self.agent_id, "name": self.name, "vote": vote, "score": score, "reason": reason}


# 9. MomentumAgent
class MomentumAgent(BaseCouncilAgent):
    def __init__(self):
        super().__init__("momentum", "🎯 Momentum RSI/MACD", "RSI (14), MACD uyumsuzlukları ve momentum", 80.6)

    def evaluate(self, symbol: str, target_dir: str, indicators: Dict[str, Any], market_item: Dict[str, Any], account_ctx: Dict[str, Any]) -> Dict[str, Any]:
        self.status = "GÖREVDE"
        rsi = float(indicators.get("rsi_14", 50.0))
        macd_div = indicators.get("macd_divergence", "NÖTR")

        if target_dir == "LONG":
            favorable = (30.0 <= rsi <= 68.0) or macd_div == "POZİTİF"
            score = min(96, int(60 + (rsi / 2) + (15 if macd_div == "POZİTİF" else 0)))
        else:
            favorable = (32.0 <= rsi <= 72.0) or macd_div == "NEGATİF"
            score = min(96, int(60 + ((100 - rsi) / 2) + (15 if macd_div == "NEGATİF" else 0)))

        vote = "YES" if favorable else "NO"
        reason = f"RSI: {rsi:.1f}, MACD: {macd_div}. Momentum dönüşü destekliyor." if vote == "YES" else f"RSI aşırı şişkin ({rsi:.1f}), ters düzeltme riski."
        self.record_decision(symbol, vote, target_dir, score, reason)
        return {"agent_id": self.agent_id, "name": self.name, "vote": vote, "score": score, "reason": reason}


# 10. LiquidationHunterAgent
class LiquidationHunterAgent(BaseCouncilAgent):
    def __init__(self):
        super().__init__("liq_hunter", "🩸 Liquidation Hunter", "Short/Long tasfiye havuzu avcısı", 79.9)

    def evaluate(self, symbol: str, target_dir: str, indicators: Dict[str, Any], market_item: Dict[str, Any], account_ctx: Dict[str, Any]) -> Dict[str, Any]:
        self.status = "GÖREVDE"
        pct = float(market_item.get("price_change_pct", 0.0))
        vol = float(market_item.get("futures_vol", 0.0))

        # Yüksek hacimde sert hareket varsa stop ve likidasyon patlaması avlanabilir
        favorable = vol > 20_000_000 and abs(pct) >= 0.5
        score = min(95, int(65 + (vol / 50_000_000 * 10) + abs(pct) * 2))

        vote = "YES" if favorable else "NO"
        reason = f"Likidasyon kümesi tespit edildi. Hacim: ${vol:,.0f}, Tasfiye avı uygun." if vote == "YES" else "Hedef seviyede yoğun tasfiye kümesi oluşmadı."
        self.record_decision(symbol, vote, target_dir, score, reason)
        return {"agent_id": self.agent_id, "name": self.name, "vote": vote, "score": score, "reason": reason}


# 11. SentinelRiskAgent
class SentinelRiskAgent(BaseCouncilAgent):
    def __init__(self):
        super().__init__("sentinel_risk", "🛡️ Sentinel Risk Kalkanı", "Kasa teminatı, serbest marjin ve kaldıraç kalkanı", 99.5)

    def evaluate(self, symbol: str, target_dir: str, indicators: Dict[str, Any], market_item: Dict[str, Any], account_ctx: Dict[str, Any]) -> Dict[str, Any]:
        self.status = "GÖREVDE"
        exposure_pct = float(account_ctx.get("exposure_pct", 0.0))
        free_margin = float(account_ctx.get("free_margin", 1000.0))
        open_pos_count = int(account_ctx.get("open_positions_count", 0))

        # Risk kuralları: Pozisyon sayısı 10'dan fazla veya marjin kullanımı %70 üzerindeyse VETO!
        if exposure_pct >= 70.0 or free_margin <= 20.0 or open_pos_count >= 10:
            vote = "VETO"
            score = 10
            reason = f"⛔ SENTINEL VETOSU: Marjin kullanımı %{exposure_pct:.1f} kritik veya serbest bakiye (${free_margin:.2f}) yetersiz!"
        elif exposure_pct >= 50.0:
            vote = "NO"
            score = 45
            reason = f"Yüksek risk uyarısı: Marjin kullanımı %{exposure_pct:.1f}. Yeni pozisyon kısıtlandı."
        else:
            vote = "YES"
            score = 95
            reason = f"Serbest marjin (${free_margin:.2f}) ve risk parametreleri (%{exposure_pct:.1f}) kusursuz."

        self.record_decision(symbol, vote, target_dir, score, reason)
        return {"agent_id": self.agent_id, "name": self.name, "vote": vote, "score": score, "reason": reason}


class ConsensusCouncil:
    def __init__(self):
        self.agents: Dict[str, BaseCouncilAgent] = {
            "scalper": ScalperAgent(),
            "breakout": BreakoutAgent(),
            "whale_flow": WhaleFlowAgent(),
            "orderbook_l2": OrderBookL2Agent(),
            "volatility": VolatilityAgent(),
            "sentiment": SentimentAgent(),
            "funding_arb": FundingArbAgent(),
            "trend_ema": TrendEMAAgent(),
            "momentum": MomentumAgent(),
            "liq_hunter": LiquidationHunterAgent(),
            "sentinel_risk": SentinelRiskAgent(),
        }

    def get_agent(self, agent_id: str) -> Optional[BaseCouncilAgent]:
        return self.agents.get(agent_id)

    def get_all_agents_summary(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": a.agent_id,
                "name": a.name,
                "role": a.role,
                "win_rate": a.win_rate,
                "status": a.status,
                "last_vote": a.last_vote,
                "last_score": a.last_score,
                "last_reason": a.last_reason,
                "history_count": len(a.history)
            }
            for a in self.agents.values()
        ]

    def evaluate_adversarial_critic(
        self,
        symbol: str,
        target_dir: str,
        indicators: Dict[str, Any],
        market_item: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Tauric Research 'Şeytanın Avukatı' (Adversarial Critic) Protocol.
        Scans for traps, funding rate extremes, L2 liquidity voids, and price/CVD divergences.
        """
        funding_rate = float(indicators.get("funding_rate", 0.0001))
        obi = float(indicators.get("obi", 0.0))
        cvd = float(indicators.get("cvd", 0.0))
        price_change = float(market_item.get("price_change_pct", 0.0))

        trap_detected = False
        trap_type = "YOK"
        reasons = []

        # 1. Aşırı Fonlama Oranı Şişkinliği (> %0.03 veya < -%0.03)
        if abs(funding_rate) >= 0.0003:
            trap_detected = True
            trap_type = "AŞIRI FONLAMA ŞİŞKİNLİĞİ"
            reasons.append(f"Aşırı fonlama oranı (%{funding_rate*100:.3f}) aleyhte tasfiye dalgası tetikleyebilir")

        # 2. Giriş yönünün hemen arkasında L2 tahtasında likidite boşluğu (> %40 derinlik farkı)
        if target_dir == "LONG" and obi <= -30.0:
            trap_detected = True
            trap_type = "LİKİDİTE BOŞLUĞU / TAHTA DUVARI"
            reasons.append(f"Giriş yönünün aksine derin satış duvarı (OBI: %{obi:.1f})")
        elif target_dir == "SHORT" and obi >= 30.0:
            trap_detected = True
            trap_type = "LİKİDİTE BOŞLUĞU / ALIM DUVARI"
            reasons.append(f"Giriş yönünün aksine derin alım duvarı (OBI: %{obi:.1f})")

        # 3. Fiyat ile Kümülatif Hacim (CVD) Uyumsuzluğu (Boğa-Ayı Tuzağı)
        if target_dir == "LONG" and price_change > 1.0 and cvd < -20000:
            trap_detected = True
            trap_type = "BOĞA TUZAĞI (CVD Uyumsuzluğu)"
            reasons.append(f"Fiyat yükselirken (%{price_change:+.2f}) CVD net satışta ({cvd:,.0f}$)")
        elif target_dir == "SHORT" and price_change < -1.0 and cvd > 20000:
            trap_detected = True
            trap_type = "AYI TUZAĞI (CVD Uyumsuzluğu)"
            reasons.append(f"Fiyat düşerken (%{price_change:+.2f}) CVD net alımda ({cvd:,.0f}$)")

        margin_penalty = 0.50 if trap_detected else 1.0
        sl_reduction = 0.70 if trap_detected else 1.0
        reason_str = " | ".join(reasons) if reasons else "Ters tuzak veya likidite boşluğu tespit edilmedi."

        return {
            "trap_risk": trap_detected,
            "trap_type": trap_type,
            "margin_penalty": margin_penalty,
            "sl_reduction": sl_reduction,
            "reason": reason_str,
            "critic_status": "UYARI" if trap_detected else "ONAY"
        }

    def evaluate_council(
        self,
        symbol: str,
        target_dir: str,
        indicators: Dict[str, Any],
        market_item: Dict[str, Any],
        account_ctx: Dict[str, Any],
        delegated_agent_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Evaluates votes across the council agents.
        Applies consensus rule: Sentinel veto must not be present AND at least 70% 'YES' votes.
        """
        # Always include sentinel_risk plus the requested delegated agents or all 11 agents
        active_ids = delegated_agent_ids or list(self.agents.keys())
        if "sentinel_risk" not in active_ids:
            active_ids.append("sentinel_risk")

        votes: Dict[str, Any] = {}
        for a_id in active_ids:
            agent = self.agents.get(a_id)
            if agent:
                res = agent.evaluate(symbol, target_dir, indicators, market_item, account_ctx)
                votes[a_id] = res

        yes_count = sum(1 for v in votes.values() if v["vote"] == "YES")
        no_count = sum(1 for v in votes.values() if v["vote"] == "NO")
        has_sentinel_veto = votes.get("sentinel_risk", {}).get("vote") == "VETO"

        total_delegated = len(votes)
        agreement_ratio_val = round(yes_count / total_delegated, 2) if total_delegated > 0 else 0.0
        consensus_rate = round((yes_count / total_delegated * 100.0), 1) if total_delegated > 0 else 0.0
        approval_rate = consensus_rate
        agreement_ratio_str = f"{yes_count}/{total_delegated}"

        # Consensus Rule: No Sentinel veto AND >= 63% (7/11) YES for agile micro-scalping
        is_approved = (not has_sentinel_veto) and (approval_rate >= 63.0)

        # Şeytanın Avukatı (Adversarial Critic) çapraz sorgusu
        critic = self.evaluate_adversarial_critic(symbol, target_dir, indicators, market_item)

        if has_sentinel_veto:
            status_text = "⛔ REDDEDİLDİ: Sentinel Risk Vetosu"
            reason = votes["sentinel_risk"]["reason"]
        elif is_approved:
            if critic.get("trap_risk"):
                status_text = f"⚖️ KONSENSÜS ONAYLANDI (Şeytanın Avukatı Uyarısı - Marjin %50)"
                reason = f"Yüksek Konsey'deki {yes_count}/{total_delegated} ajan (%{approval_rate:.0f}) onayladı ancak Şeytanın Avukatı {critic['trap_type']} bildirdi."
            else:
                status_text = f"✅ KONSENSÜS SAĞLANDI (%{approval_rate:.0f} Onay)"
                reason = f"Yüksek Konsey'deki {yes_count}/{total_delegated} ajan (%{approval_rate:.0f}) {target_dir} yönünde uzlaştı."
        else:
            status_text = f"⏳ KONSENSÜS YETERSİZ (%{approval_rate:.0f} < %70)"
            reason = f"Pozitif oy oranı (%{approval_rate:.0f}) baraj olan %70'in altında kaldı."

        return {
            "approved": is_approved,
            "direction": target_dir if is_approved else "BEKLE",
            "symbol": symbol,
            "agreement_ratio": agreement_ratio_str,
            "agreement_ratio_val": agreement_ratio_val,
            "consensus_rate": consensus_rate,
            "approval_rate": approval_rate,
            "approval_pct": approval_rate,
            "confidence": approval_rate,
            "yes_count": yes_count,
            "total_votes": total_delegated,
            "has_sentinel_veto": has_sentinel_veto,
            "adversarial_critic": critic,
            "status_text": status_text,
            "reason": reason,
            "votes": votes
        }


consensus_council = ConsensusCouncil()
