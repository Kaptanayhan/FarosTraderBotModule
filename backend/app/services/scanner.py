"""Binance USDT-M futures market scanner (public endpoints, no API key)."""
import asyncio
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx

from app.db import db

TICKER_URL = "https://fapi.binance.com/fapi/v1/ticker/24hr"
DEPTH_URL = "https://fapi.binance.com/fapi/v1/depth"
EXCLUDED = {"USDCUSDT", "FDUSDUSDT", "BUSDUSDT", "TUSDUSDT", "USDPUSDT", "EURUSDT"}
MIN_QUOTE_VOLUME = 5_000_000.0


def _f(v: Any) -> float:
    """Binance returns price fields (lastPrice, markPrice...) as strings -> strict float."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


class Scanner:
    def __init__(self):
        self.radar: List[Dict[str, Any]] = []
        self.prices: Dict[str, float] = {}
        self.summary: Dict[str, Any] = {"total": 0, "long": 0, "short": 0, "neutral": 0, "regime": "BEKLENİYOR"}
        self.last_scan: Optional[str] = None
        self.last_error: str = ""

    @staticmethod
    def _signal(pct: float, range_pos: float):
        if pct >= 2.0 and range_pos >= 0.65:
            return "LONG", min(95, int(60 + pct * 1.5 + range_pos * 20)), f"Güçlü yükseliş {pct:+.2f}% / zirveye yakın"
        if pct <= -2.0 and range_pos <= 0.35:
            return "SHORT", min(95, int(60 + abs(pct) * 1.5 + (1 - range_pos) * 20)), f"Sert düşüş {pct:+.2f}% / dibe yakın"
        if pct > 0.5:
            return "LONG", max(50, int(50 + pct * 3)), f"Pozitif akış {pct:+.2f}%"
        if pct < -0.5:
            return "SHORT", max(50, int(50 + abs(pct) * 3)), f"Negatif akış {pct:+.2f}%"
        return "BEKLE", 40, "Yatay"

    async def _obi(self, client: httpx.AsyncClient, symbol: str) -> float:
        try:
            r = await client.get(DEPTH_URL, params={"symbol": symbol, "limit": 20}, timeout=4.0)
            if r.status_code == 200:
                d = r.json()
                b = sum(_f(x[1]) for x in d.get("bids", []))
                a = sum(_f(x[1]) for x in d.get("asks", []))
                return round((b - a) / (b + a), 3) if (a + b) > 0 else 0.0
        except Exception:
            pass
        return 0.0

    async def scan(self) -> List[Dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                r = await client.get(TICKER_URL)
                r.raise_for_status()
                items = []
                prices = {}
                for t in r.json():
                    sym = t.get("symbol", "")
                    if not sym.endswith("USDT") or sym in EXCLUDED:
                        continue
                    last = _f(t.get("lastPrice"))
                    if last <= 0:
                        continue
                    prices[sym] = last
                    qv = _f(t.get("quoteVolume"))
                    if qv < MIN_QUOTE_VOLUME:
                        continue
                    hi, lo, pct = _f(t.get("highPrice")), _f(t.get("lowPrice")), _f(t.get("priceChangePercent"))
                    rp = (last - lo) / (hi - lo) if hi > lo else 0.5
                    sig, score, reason = self._signal(pct, rp)
                    items.append({
                        "symbol": sym, "price": last, "change_pct": round(pct, 2), "volume": qv,
                        "range_pos": round(rp, 2), "obi": 0.0, "signal": sig, "score": score, "reason": reason,
                    })
                items.sort(key=lambda x: (x["score"], x["volume"]), reverse=True)

                top = items[:20]
                obis = await asyncio.gather(*(self._obi(client, c["symbol"]) for c in top))
                for c, o in zip(top, obis):
                    c["obi"] = o
                    if (o > 0.25 and c["signal"] == "LONG") or (o < -0.25 and c["signal"] == "SHORT"):
                        c["score"] = min(99, c["score"] + 10)
                        c["reason"] += f" | OBI {o:+.2f}"
                items.sort(key=lambda x: (x["score"], x["volume"]), reverse=True)

                n = len(items)
                longs = sum(1 for c in items if c["signal"] == "LONG")
                shorts = sum(1 for c in items if c["signal"] == "SHORT")
                bull = longs / n * 100 if n else 50
                bear = shorts / n * 100 if n else 50
                regime = "BOĞA" if bull >= 60 else "AYI" if bear >= 60 else "KARIŞIK"
                self.summary = {"total": n, "long": longs, "short": shorts, "neutral": n - longs - shorts,
                                "bull_pct": round(bull, 1), "bear_pct": round(bear, 1), "regime": regime}
                self.radar = items
                self.prices = prices
                self.last_scan = datetime.utcnow().isoformat(timespec="seconds")
                self.last_error = ""
        except Exception as e:
            msg = f"Piyasa taraması başarısız: {e}"
            if msg != self.last_error:
                db.log(msg, "ERROR", "SCANNER")
            self.last_error = msg
        return self.radar


scanner = Scanner()
