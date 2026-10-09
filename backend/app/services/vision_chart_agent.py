"""Vision Chart Agent - In-Memory 15m Candlestick Rendering & Multimodal AI Verification.
- Zero Chromium / Playwright dependency.
- Generates 15m OHLCV + EMA 20 + EMA 50 + Volume charts directly in RAM (io.BytesIO) at 100 DPI.
- Evaluates top resistance rejection, fakeouts, and wick rejections via Vision API.
- Fail-safe fallback (approved: True, confidence: 0.70) within 2.0s timeout.
- Dispatches chart image to Telegram channel on positive confirmation.
"""
import asyncio
import base64
import io
import json
import os
import re
import time
from typing import Dict, Any, Optional

import httpx
import pandas as pd

# Matplotlib headless backend for non-GUI server environments
import matplotlib
matplotlib.use("Agg")
import mplfinance as mpf
import matplotlib.pyplot as plt

from app.db import db

VISION_API_URL = os.getenv("VISION_API_URL", os.getenv("SENTIMENT_API_URL", "")).strip()
VISION_API_KEY = os.getenv("VISION_API_KEY", os.getenv("SENTIMENT_API_KEY", "")).strip()
VISION_MODEL = os.getenv("VISION_MODEL", "gpt-4o-mini").strip()
BINANCE_KLINES_URL = "https://fapi.binance.com/fapi/v1/klines"


class VisionChartAgent:
    def __init__(self):
        self.api_url = VISION_API_URL
        self.api_key = VISION_API_KEY
        self.model = VISION_MODEL
        self._last_charts: Dict[str, bytes] = {}

    async def fetch_15m_klines(self, symbol: str, limit: int = 45) -> Optional[pd.DataFrame]:
        """Fetches 15m candlestick data for symbol from Binance Futures."""
        clean_sym = symbol.upper().replace("/", "")
        params = {"symbol": clean_sym, "interval": "15m", "limit": limit}
        try:
            async with httpx.AsyncClient(timeout=3.5) as client:
                res = await client.get(BINANCE_KLINES_URL, params=params)
                if res.status_code == 200:
                    raw_data = res.json()
                    records = []
                    for k in raw_data:
                        records.append({
                            "Date": pd.to_datetime(k[0], unit="ms"),
                            "Open": float(k[1]),
                            "High": float(k[2]),
                            "Low": float(k[3]),
                            "Close": float(k[4]),
                            "Volume": float(k[5]),
                        })
                    df = pd.DataFrame(records)
                    df.set_index("Date", inplace=True)
                    return df
        except Exception as e:
            db.log(f"[VISION] Mum verisi çekilemedi ({clean_sym}): {e}", "WARN", "VISION")
        return None

    def render_chart_to_bytes(self, df: pd.DataFrame, symbol: str) -> Optional[bytes]:
        """Renders candlestick chart with EMA 20/50 and Volume in memory (io.BytesIO). Zero disk I/O."""
        if df is None or len(df) < 20:
            return None
        try:
            # Calculate EMAs for visual context
            ema_20 = df["Close"].ewm(span=20, adjust=False).mean()
            ema_50 = df["Close"].ewm(span=50, adjust=False).mean()

            addplots = [
                mpf.make_addplot(ema_20, color="#00e5ff", width=1.1),
                mpf.make_addplot(ema_50, color="#ff9100", width=1.1)
            ]

            mc = mpf.make_marketcolors(
                up="#00e676", down="#ff1744",
                edge="inherit", wick="inherit", volume="in"
            )
            s = mpf.make_mpf_style(
                base_mpf_style="nightclouds",
                marketcolors=mc,
                facecolor="#0b0e14",
                edgecolor="#1e293b",
                figcolor="#070a0f",
                gridcolor="#1e293b",
                gridstyle=":"
            )

            buf = io.BytesIO()
            mpf.plot(
                df,
                type="candle",
                style=s,
                volume=True,
                addplot=addplots,
                title=f"\n{symbol} 15M | EMA 20 (Cyan) - EMA 50 (Orange)",
                savefig=dict(fname=buf, dpi=100, bbox_inches="tight", format="png")
            )
            buf.seek(0)
            img_bytes = buf.getvalue()
            buf.close()
            plt.close("all")
            return img_bytes
        except Exception as e:
            db.log(f"[VISION] Grafik çizim hatası ({symbol}): {e}", "WARN", "VISION")
            plt.close("all")
            return None

    async def _call_multimodal_vision_api(self, img_bytes: bytes, symbol: str, target_direction: str) -> Dict[str, Any]:
        """Calls external Vision AI endpoint with 2.0s strict timeout."""
        if not self.api_url or not self.api_key:
            return {
                "approved": True,
                "confidence": 0.70,
                "reason": "Harici Vision API anahtarı tanımsız, varsayılan onay ile devam edildi.",
                "pattern": "STANDART_ONAY"
            }

        b64_img = base64.b64encode(img_bytes).decode("utf-8")
        system_prompt = (
            "Sen profesyonel bir Kripto Price Action ve Teknik Analiz uzmanısın. "
            "Verilen 15m mum grafiğini incele. Yön beklentisi: " + target_direction + ". "
            "Grafikte güçlü bir tepe direnç reddi, sahte kırılım (fakeout), hacimsiz tuzak veya aleyhte majör ters fitil var mı kontrol et. "
            "Sadece ve sadece geçerli tek bir JSON nesnesi dön: "
            '{"approved": bool, "confidence": float, "reason": str, "pattern": str}'
        )

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"{symbol} için {target_direction} yönünde giriş onaylanıyor mu? İncelenen grafiğe göre karar ver."},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{b64_img}"}
                        }
                    ]
                }
            ],
            "max_tokens": 150,
            "temperature": 0.1
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                res = await client.post(self.api_url, json=payload, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    content = data["choices"][0]["message"]["content"].strip()
                    # Extract JSON object
                    m = re.search(r"\{.*\}", content, flags=re.DOTALL)
                    if m:
                        parsed = json.loads(m.group(0))
                        return {
                            "approved": bool(parsed.get("approved", True)),
                            "confidence": float(parsed.get("confidence", 0.75)),
                            "reason": str(parsed.get("reason", "Vision PA teyidi alındı")),
                            "pattern": str(parsed.get("pattern", "NORMAL"))
                        }
        except Exception:
            pass

        # 2s zaman aşımı veya bağlantı hatası fallback
        return {
            "approved": True,
            "confidence": 0.70,
            "reason": "Vision API 2s zaman aşımı (Fallback Güvenli Onay)",
            "pattern": "TIMEOUT_FALLBACK"
        }

    async def evaluate_symbol(self, symbol: str, target_direction: str = "LONG") -> Dict[str, Any]:
        """Full pipeline: fetch klines, render chart in RAM, evaluate with Vision, cache image."""
        sym_clean = symbol.upper().replace("/", "")
        df = await self.fetch_15m_klines(sym_clean, limit=45)
        if df is None or len(df) < 15:
            return {
                "approved": True,
                "confidence": 0.70,
                "reason": "Yetersiz mum verisi, varsayılan onay",
                "pattern": "DATA_FALLBACK",
                "chart_bytes": None
            }

        img_bytes = self.render_chart_to_bytes(df, sym_clean)
        if img_bytes:
            self._last_charts[sym_clean] = img_bytes

        eval_result = await self._call_multimodal_vision_api(img_bytes, sym_clean, target_direction) if img_bytes else {
            "approved": True,
            "confidence": 0.70,
            "reason": "Grafik render atlandı, onaylandı",
            "pattern": "NO_IMAGE_FALLBACK"
        }
        eval_result["chart_bytes"] = img_bytes
        return eval_result

    def get_last_chart(self, symbol: str) -> Optional[bytes]:
        """Retrieves cached RAM chart bytes for the symbol."""
        return self._last_charts.get(symbol.upper().replace("/", ""))


vision_chart_agent = VisionChartAgent()
