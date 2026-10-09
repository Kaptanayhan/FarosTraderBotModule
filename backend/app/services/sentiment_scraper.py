"""VPS-Compatible Lightweight Sentiment Scraper & Scorer.
- Extracts clean news text via httpx and BeautifulSoup (zero Playwright / Chromium).
- Scores sentiment [-1.0, 1.0] using external REST API (OpenAI/Gemini/Groq) if configured,
  or zero-cost keyword/regex weights fallback (never attempts localhost LLM).
- Maintains non-blocking in-memory sentiment cache for HFT engine.
"""
import os
import re
import time
import httpx
from typing import Dict, Any, Optional

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

# External API Configuration (Zero Local LLM dependency)
EXTERNAL_API_URL = os.getenv("SENTIMENT_API_URL", "").strip()
EXTERNAL_API_KEY = os.getenv("SENTIMENT_API_KEY", "").strip()
EXTERNAL_MODEL = os.getenv("SENTIMENT_MODEL", "gpt-4o-mini").strip()

# Positive / Negative weighted financial keywords for instant zero-cost heuristic
BULLISH_KEYWORDS = {
    "surge": 0.25, "breakout": 0.30, "bullish": 0.35, "rally": 0.25, "inflow": 0.20,
    "ath": 0.30, "gain": 0.15, "soar": 0.25, "approval": 0.30, "accumulate": 0.20,
    "upgrade": 0.20, "partnership": 0.15, "buyback": 0.25, "adoption": 0.20
}

BEARISH_KEYWORDS = {
    "dump": -0.30, "crash": -0.35, "bearish": -0.30, "hack": -0.40, "exploit": -0.40,
    "liquidation": -0.25, "outflow": -0.20, "drop": -0.15, "investigation": -0.30,
    "ban": -0.35, "lawsuit": -0.30, "fraud": -0.40, "insolvency": -0.45, "selloff": -0.25
}


class SentimentScraper:
    def __init__(self):
        # In-memory non-blocking cache: symbol -> (score: float, updated_at: float)
        self._symbol_cache: Dict[str, Dict[str, Any]] = {}
        self._global_score: float = 0.0
        self._global_updated_at: float = 0.0

    def get_cached_sentiment(self, symbol: Optional[str] = None) -> float:
        """Instant non-blocking memory read for HFT engine.
        Returns float between -1.0 and 1.0 (default 0.0 if not available or stale).
        """
        now = time.time()
        if symbol:
            sym_clean = symbol.upper().replace("USDT", "")
            cached = self._symbol_cache.get(sym_clean)
            if cached and (now - cached.get("timestamp", 0) < 3600):  # 1 hour validity
                return float(cached.get("score", 0.0))

        # Check global score (valid for 1 hour)
        if now - self._global_updated_at < 3600:
            return float(self._global_score)

        return 0.0

    def clean_text_with_soup(self, html: str) -> str:
        """Lightweight HTML parsing without heavy headless browsers."""
        if not html:
            return ""

        if BeautifulSoup:
            try:
                soup = BeautifulSoup(html, "html.parser")
                for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript", "svg"]):
                    tag.decompose()
                text = soup.get_text(separator=" ", strip=True)
                return re.sub(r"\s+", " ", text)[:2500]
            except Exception:
                pass

        # Fallback regex tag stripper
        text = re.sub(r"<(script|style|nav|footer|header|aside|noscript)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        return re.sub(r"\s+", " ", text).strip()[:2500]

    async def fetch_article_text(self, url: str) -> str:
        """Lightweight HTTP extraction."""
        try:
            async with httpx.AsyncClient(timeout=4.0, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    return self.clean_text_with_soup(resp.text)
        except Exception:
            pass
        return ""

    async def evaluate_sentiment_score(self, text: str) -> float:
        """Evaluates text into a strict float [-1.0, 1.0].
        Uses external REST API if configured; otherwise instant zero-cost keyword heuristic.
        Never calls localhost or local LLMs.
        """
        if not text:
            return 0.0

        # 1. External REST API Call (if configured with API key and URL)
        if EXTERNAL_API_URL and EXTERNAL_API_KEY:
            try:
                prompt = (
                    "Analyze the sentiment of this crypto news text. "
                    "Output ONLY a single float number between -1.0 (bearish) and 1.0 (bullish). "
                    f"Text:\n{text[:1200]}\nScore:"
                )
                payload = {
                    "model": EXTERNAL_MODEL,
                    "messages": [
                        {"role": "system", "content": "You are a crypto sentiment scorer. Output only a float between -1.0 and 1.0."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.0,
                    "max_tokens": 8
                }
                headers = {"Authorization": f"Bearer {EXTERNAL_API_KEY}"}
                async with httpx.AsyncClient(timeout=3.5) as client:
                    resp = await client.post(EXTERNAL_API_URL, json=payload, headers=headers)
                    if resp.status_code == 200:
                        data = resp.json()
                        raw_ans = data["choices"][0]["message"]["content"].strip()
                        m = re.search(r"[-+]?\d*\.?\d+", raw_ans)
                        if m:
                            score = float(m.group(0))
                            return max(-1.0, min(1.0, score))
            except Exception:
                pass

        # 2. Fast Zero-Cost Fallback Heuristic
        text_lower = text.lower()
        score = 0.0
        for kw, weight in BULLISH_KEYWORDS.items():
            if kw in text_lower:
                score += weight
        for kw, weight in BEARISH_KEYWORDS.items():
            if kw in text_lower:
                score += weight

        return max(-1.0, min(1.0, round(score, 4)))

    async def update_sentiment_background(self, symbol: Optional[str] = None, text: Optional[str] = None, url: Optional[str] = None):
        """Asynchronous background update that caches score without blocking HFT loop."""
        body = text or ""
        if url and not body:
            body = await self.fetch_article_text(url)

        score = await self.evaluate_sentiment_score(body)
        now = time.time()

        if symbol:
            sym_clean = symbol.upper().replace("USDT", "")
            self._symbol_cache[sym_clean] = {
                "score": score,
                "timestamp": now,
                "source": url or "direct_text"
            }
        else:
            self._global_score = score
            self._global_updated_at = now

        return score


sentiment_scraper = SentimentScraper()
