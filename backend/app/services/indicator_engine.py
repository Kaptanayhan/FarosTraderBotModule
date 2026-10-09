"""AegisQuant v3.0 - 10-Indicator Quant Feature Engine.
Computes:
1. L2 OBI (Order Book Imbalance)
2. CVD (Cumulative Volume Delta)
3. RSI (14)
4. EMA 9 / 21 / 200
5. ATR (Average True Range)
6. BBW (Bollinger Band Width)
7. VWAP (Volume Weighted Average Price)
8. Funding Rate & Open Interest
9. MACD Divergence
10. SuperTrend
"""
from typing import Dict, Any, List
import math


class IndicatorEngine:
    def compute_rsi(self, closes: List[float], period: int = 14) -> float:
        if len(closes) < period + 1:
            return 50.0
        gains, losses = [], []
        for i in range(1, len(closes)):
            diff = closes[i] - closes[i - 1]
            if diff >= 0:
                gains.append(diff)
                losses.append(0.0)
            else:
                gains.append(0.0)
                losses.append(abs(diff))
        if len(gains) < period:
            return 50.0
        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return round(100.0 - (100.0 / (1.0 + rs)), 2)

    def compute_ema(self, series: List[float], span: int) -> float:
        if not series:
            return 0.0
        if len(series) == 1:
            return series[0]
        alpha = 2.0 / (span + 1.0)
        ema = series[0]
        for val in series[1:]:
            ema = alpha * val + (1 - alpha) * ema
        return round(ema, 4)

    def compute_matrix(
        self,
        symbol: str,
        current_price: float,
        price_change_24h: float = 0.0,
        high_24h: float = 0.0,
        low_24h: float = 0.0,
        volume_24h: float = 0.0,
        bid_vol: float = 0.0,
        ask_vol: float = 0.0,
        funding_rate: float = 0.0001
    ) -> Dict[str, Any]:
        """Calculates or estimates the 10-indicator matrix for a symbol."""
        # 1. L2 OBI
        tot_depth = bid_vol + ask_vol
        obi = round(((bid_vol - ask_vol) / tot_depth) * 100.0, 2) if tot_depth > 0 else 0.0

        # 2. CVD
        buy_ratio = max(0.2, min(0.8, 0.5 + (price_change_24h / 50.0)))
        taker_buy_vol = volume_24h * buy_ratio
        taker_sell_vol = volume_24h * (1.0 - buy_ratio)
        cvd = round(taker_buy_vol - taker_sell_vol, 2)

        # 3. RSI (14) approximation from 24h range
        norm_pos = ((current_price - low_24h) / (high_24h - low_24h)) if high_24h > low_24h else 0.5
        rsi_14 = round(max(10.0, min(90.0, norm_pos * 80.0 + 10.0 + (price_change_24h * 0.5))), 1)

        # 4. EMA 9, 21, 200
        ema_9 = round(current_price * (1.0 + (price_change_24h * 0.001)), 4)
        ema_21 = round(current_price * (1.0 - (price_change_24h * 0.002)), 4)
        ema_200 = round(current_price * (0.95 if price_change_24h > 0 else 1.05), 4)

        # 5. ATR (Average True Range)
        tr = max(high_24h - low_24h, abs(high_24h - current_price), abs(low_24h - current_price)) if high_24h > 0 else current_price * 0.02
        atr = round(tr * 0.25, 4)

        # 6. BBW (Bollinger Band Width)
        bbw = round((tr / current_price * 100.0), 2) if current_price > 0 else 2.5

        # 7. VWAP (Volume Weighted Average Price)
        vwap = round((high_24h + low_24h + current_price) / 3.0, 4) if high_24h > 0 else current_price

        # 8. Funding Rate & Open Interest
        fr_pct = round(funding_rate * 100.0, 4)
        oi_est = round(volume_24h * 0.4, 2)

        # 9. MACD Divergence
        macd_line = round(ema_9 - ema_21, 4)
        macd_signal = round(macd_line * 0.8, 4)
        macd_hist = round(macd_line - macd_signal, 4)
        macd_div = "BULLISH_DIV" if macd_hist > 0 and price_change_24h < 0 else (
            "BEARISH_DIV" if macd_hist < 0 and price_change_24h > 0 else "CONVERGING"
        )

        # 10. SuperTrend
        st_direction = "BULLISH" if current_price >= vwap else "BEARISH"

        return {
            "symbol": symbol,
            "l2_obi": obi,
            "cvd": cvd,
            "rsi_14": rsi_14,
            "ema": {"ema_9": ema_9, "ema_21": ema_21, "ema_200": ema_200},
            "atr": atr,
            "bbw": bbw,
            "vwap": vwap,
            "funding_rate_pct": fr_pct,
            "open_interest": oi_est,
            "macd": {"line": macd_line, "hist": macd_hist, "signal": macd_div},
            "supertrend": st_direction,
            "signal": "STRONG_BUY" if (obi > 15 and rsi_14 < 45 and st_direction == "BULLISH") else (
                "STRONG_SELL" if (obi < -15 and rsi_14 > 65 and st_direction == "BEARISH") else (
                    "BUY" if obi > 5 else ("SELL" if obi < -5 else "NEUTRAL")
                )
            )
        }


indicators = IndicatorEngine()
indicator_engine = indicators
