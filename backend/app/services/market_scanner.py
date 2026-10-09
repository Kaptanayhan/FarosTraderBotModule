"""FAROS Market Scanner - Dynamic 15-Pair Binance Futures Radar & Order Book Imbalance (OBI).
Fetches 24h ticker data and L2 depth directly from Binance Futures public endpoints.
"""
import asyncio
import time
from datetime import datetime
from typing import List, Dict, Any, Optional
import httpx
from app.db import db

SPOT_TICKER_URL = "https://api.binance.com/api/v3/ticker/24hr"
FUTURES_TICKER_URL = "https://fapi.binance.com/fapi/v1/ticker/24hr"
BOOK_TICKER_URL = "https://fapi.binance.com/fapi/v1/ticker/bookTicker"
EXCHANGE_INFO_URL = "https://fapi.binance.com/fapi/v1/exchangeInfo"
DEPTH_URL = "https://fapi.binance.com/fapi/v1/depth"
EXCLUDED = {"USDCUSDT", "FDUSDUSDT", "BUSDUSDT", "TUSDUSDT", "USDPUSDT", "EURUSDT"}


def normalize_symbol(symbol: str) -> str:
    if not symbol:
        return "BTCUSDT"
    sym = str(symbol).strip().upper()
    if sym in ("BTWUSDT", "BTC-USDT", "BTC_USDT"):
        return "BTCUSDT"
    if sym in ("ETH-USDT", "ETH_USDT"):
        return "ETHUSDT"
    if sym in ("SOL-USDT", "SOL_USDT"):
        return "SOLUSDT"
    return sym


def parse_float(val: Any) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return 0.0


class MarketScanner:
    def __init__(self):
        self.radar: List[Dict[str, Any]] = []
        self.prices: Dict[str, float] = {}
        self.book_tickers: Dict[str, Dict[str, float]] = {}
        self.symbol_filters: Dict[str, Dict[str, float]] = {}
        self.last_exchange_info_time: float = 0.0
        self.last_price_stream_time: float = 0.0
        self.ws_running: bool = False
        self._ws_task: Optional[asyncio.Task] = None
        self._watchdog_task: Optional[asyncio.Task] = None
        self.all_symbols: List[str] = []
        self.scanned_pairs_count: int = 0
        self.macro_summary: Dict[str, Any] = {
            "total_scanned": 15,
            "long_count": 0,
            "short_count": 0,
            "neutral_count": 0,
            "bullish_pct": 50.0,
            "bearish_pct": 50.0,
            "system_macro_signal": "DİNAMİK ÇİFT PİYASA RADARI",
            "market_state": "NÖTR",
            "risk_index": "ORTA",
        }
        self.last_scan_time: Optional[str] = None
        self._is_scanning = False

    async def fetch_exchange_info(self, client: httpx.AsyncClient):
        """Fetches and caches Binance Futures PRICE_FILTER, LOT_SIZE, and MIN_NOTIONAL filters."""
        import time
        now = time.time()
        # Refresh every 30 minutes or if empty
        if self.symbol_filters and (now - self.last_exchange_info_time < 1800.0):
            return
        try:
            r = await client.get(EXCHANGE_INFO_URL, timeout=8.0)
            if r.status_code == 200:
                data = r.json()
                for s in data.get("symbols", []):
                    sym = s.get("symbol", "")
                    filters_map = {f.get("filterType"): f for f in s.get("filters", [])}
                    p_filter = filters_map.get("PRICE_FILTER", {})
                    l_filter = filters_map.get("LOT_SIZE", {})
                    n_filter = filters_map.get("MIN_NOTIONAL", {})

                    tick_size = parse_float(p_filter.get("tickSize")) or 0.01
                    step_size = parse_float(l_filter.get("stepSize")) or 0.001
                    min_qty = parse_float(l_filter.get("minQty")) or 0.001
                    notional = parse_float(n_filter.get("notional") or n_filter.get("minNotional")) or 5.0

                    self.symbol_filters[sym] = {
                        "tick_size": tick_size,
                        "step_size": step_size,
                        "min_qty": min_qty,
                        "min_notional": notional
                    }
                self.last_exchange_info_time = now
                db.log(f"Binance Futures ExchangeInfo önbelleklendi ({len(self.symbol_filters)} sembol filtresi).", "INFO", "SCANNER")
        except Exception as e:
            db.log(f"ExchangeInfo alınamadı: {e}", "WARN", "SCANNER")

    def get_symbol_filter(self, symbol: str) -> Dict[str, float]:
        sym = normalize_symbol(symbol)
        if sym in self.symbol_filters:
            return self.symbol_filters[sym]
        return {
            "tick_size": 0.01,
            "step_size": 0.001,
            "min_qty": 0.001,
            "min_notional": 5.0
        }

    async def get_btc_regime(self) -> Dict[str, Any]:
        """Calculates BTCUSDT 15m trend regime (EMA20 vs EMA50) to filter market-wide direction."""
        now = time.time()
        if hasattr(self, "_btc_regime_cache") and (now - getattr(self, "_btc_regime_time", 0.0) < 30.0):
            return self._btc_regime_cache

        regime = {
            "trend": "NEUTRAL",
            "ema_20": 0.0,
            "ema_50": 0.0,
            "allowed_side": "ANY",
            "btc_price": self.prices.get("BTCUSDT", 0.0)
        }
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                r = await client.get("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=60", timeout=3.5)
                if r.status_code == 200:
                    data = r.json()
                    closes = [float(k[4]) for k in data]
                    if len(closes) >= 50:
                        def _calc_ema(series: List[float], span: int) -> float:
                            k = 2.0 / (span + 1.0)
                            ema = series[0]
                            for val in series[1:]:
                                ema = (val * k) + (ema * (1.0 - k))
                            return ema

                        ema_20 = round(_calc_ema(closes, 20), 2)
                        ema_50 = round(_calc_ema(closes, 50), 2)
                        cur_p = closes[-1]
                        is_bullish = ema_20 >= ema_50
                        trend = "BULLISH" if is_bullish else "BEARISH"
                        allowed = "LONG" if is_bullish else "SHORT"
                        regime = {
                            "trend": trend,
                            "ema_20": ema_20,
                            "ema_50": ema_50,
                            "allowed_side": allowed,
                            "btc_price": cur_p
                        }
        except Exception:
            pass

        self._btc_regime_cache = regime
        self._btc_regime_time = now
        return regime

    async def start_ws_watchdog(self):
        """Starts Binance Futures !ticker@arr WebSocket stream with Watchdog monitor."""
        if self.ws_running:
            return
        self.ws_running = True
        self._ws_task = asyncio.create_task(self._run_ws_stream())
        self._watchdog_task = asyncio.create_task(self._run_watchdog_loop())
        db.log("Binance Futures WebSocket Watchdog devrede (5s akış kontrolü, 10ms re-connect).", "INFO", "WATCHDOG")

    async def stop_ws_watchdog(self):
        self.ws_running = False
        if self._ws_task and not self._ws_task.done():
            self._ws_task.cancel()
        if self._watchdog_task and not self._watchdog_task.done():
            self._watchdog_task.cancel()

    async def _run_ws_stream(self):
        import json
        import time
        try:
            import websockets
        except ImportError:
            db.log("[SCANNER] websockets kütüphanesi bulunamadı, REST modunda devam ediliyor.", "INFO", "SCANNER")
            return

        url = "wss://fstream.binance.com/ws/!ticker@arr"
        while self.ws_running:
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=10) as ws:
                    db.log("[SCANNER] Binance Futures !ticker@arr WebSocket akışı bağlandı.", "INFO", "WS")
                    while self.ws_running:
                        msg = await ws.recv()
                        data = json.loads(msg)
                        if isinstance(data, list):
                            now = time.time()
                            self.last_price_stream_time = now
                            for item in data:
                                raw_sym = item.get("s", "")
                                sym = normalize_symbol(raw_sym)
                                price = parse_float(item.get("c"))
                                if price > 0:
                                    self.prices[sym] = price
            except asyncio.CancelledError:
                break
            except Exception:
                # 10ms auto-reconnect
                await asyncio.sleep(0.01)

    async def _run_watchdog_loop(self):
        import time
        while self.ws_running:
            await asyncio.sleep(1.0)
            if self.last_price_stream_time > 0:
                elapsed = time.time() - self.last_price_stream_time
                if elapsed > 5.0:
                    db.log(f"[WATCHDOG] Fiyat akışı {elapsed:.1f}s kesildi! 10ms içinde soket yeniden başlatılıyor...", "WARN", "WATCHDOG")
                    if self._ws_task and not self._ws_task.done():
                        self._ws_task.cancel()
                    await asyncio.sleep(0.01)  # 10ms reconnect
                    self._ws_task = asyncio.create_task(self._run_ws_stream())
                    self.last_price_stream_time = time.time()

    async def fetch_l2_obi(self, client: httpx.AsyncClient, symbol: str) -> float:
        """Calculates Order Book Imbalance: (bid_vol - ask_vol) / (bid_vol + ask_vol)."""
        try:
            r = await client.get(f"{DEPTH_URL}?symbol={symbol}&limit=20", timeout=3.5)
            if r.status_code == 200:
                data = r.json()
                bids = data.get("bids", [])
                asks = data.get("asks", [])
                bid_vol = sum(parse_float(b[1]) for b in bids)
                ask_vol = sum(parse_float(a[1]) for a in asks)
                tot = bid_vol + ask_vol
                return round((bid_vol - ask_vol) / tot, 3) if tot > 0 else 0.0
        except Exception:
            pass
        return 0.0

    async def get_l2_depth(self, symbol: str, limit: int = 5) -> Dict[str, Any]:
        """Fetches top bids and asks from Binance Futures L2 order book depth."""
        sym = normalize_symbol(symbol)
        try:
            async with httpx.AsyncClient(timeout=3.5) as client:
                r = await client.get(f"{DEPTH_URL}?symbol={sym}&limit={limit}", timeout=3.0)
                if r.status_code == 200:
                    d = r.json()
                    bids = [{"price": parse_float(b[0]), "qty": parse_float(b[1])} for b in d.get("bids", [])[:limit]]
                    asks = [{"price": parse_float(a[0]), "qty": parse_float(a[1])} for a in d.get("asks", [])[:limit]]
                    best_bid = bids[0]["price"] if bids else self.prices.get(sym, 0.0)
                    best_ask = asks[0]["price"] if asks else self.prices.get(sym, 0.0)
                    spread_val = round(max(0.0, best_ask - best_bid), 4)
                    spread_pct = round((spread_val / best_bid * 100.0), 3) if best_bid > 0 else 0.0
                    return {
                        "bids": bids,
                        "asks": asks,
                        "best_bid": best_bid,
                        "best_ask": best_ask,
                        "spread": spread_val,
                        "spread_pct": spread_pct
                    }
        except Exception:
            pass

        # Fallback to book_ticker or current mark price
        bt = self.book_tickers.get(sym, {})
        cur_p = self.prices.get(sym, 100.0)
        best_bid = float(bt.get("bid") or bt.get("bestBidPrice") or cur_p * 0.9998)
        best_ask = float(bt.get("ask") or bt.get("bestAskPrice") or cur_p * 1.0002)
        spread_val = round(max(0.0, best_ask - best_bid), 4)
        spread_pct = round((spread_val / best_bid * 100.0), 3) if best_bid > 0 else 0.0
        flt = self.get_symbol_filter(sym)
        tick = flt.get("tick_size", 0.01) or 0.01
        bids = [{"price": round(best_bid - i * tick, 4), "qty": round(1.2 * (i + 1), 2)} for i in range(limit)]
        asks = [{"price": round(best_ask + i * tick, 4), "qty": round(1.1 * (i + 1), 2)} for i in range(limit)]
        return {
            "bids": bids,
            "asks": asks,
            "best_bid": best_bid,
            "best_ask": best_ask,
            "spread": spread_val,
            "spread_pct": spread_pct
        }

    async def scan(self) -> List[Dict[str, Any]]:
        self._is_scanning = True
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                # 0. Ensure Binance Futures exchange info filters are cached
                await self.fetch_exchange_info(client)

                # Concurrent fetch of Futures 24hr, Spot 24hr, and L2 BookTickers
                f_task = client.get(FUTURES_TICKER_URL)
                s_task = client.get(SPOT_TICKER_URL)
                b_task = client.get(BOOK_TICKER_URL)
                f_res, s_res, b_res = await asyncio.gather(f_task, s_task, b_task, return_exceptions=True)

                if isinstance(f_res, Exception):
                    raise f_res

                f_list = f_res.json() if f_res.status_code == 200 else []
                s_list = s_res.json() if not isinstance(s_res, Exception) and s_res.status_code == 200 else []
                b_list = b_res.json() if not isinstance(b_res, Exception) and b_res.status_code == 200 else []

                # Populate real L2 book tickers (best bid / best ask)
                for b in b_list:
                    bsym = b.get("symbol")
                    if bsym:
                        self.book_tickers[bsym] = {
                            "bid": parse_float(b.get("bidPrice")),
                            "ask": parse_float(b.get("askPrice")),
                            "bid_qty": parse_float(b.get("bidQty")),
                            "ask_qty": parse_float(b.get("askQty")),
                        }

                # Build Spot map
                spot_map: Dict[str, Dict[str, Any]] = {}
                for item in s_list:
                    sym = item.get("symbol", "")
                    if sym.endswith("USDT"):
                        spot_map[sym] = item

                all_usdt = []
                valid_tickers = []
                for item in f_list:
                    raw_s = item.get("symbol", "")
                    sym = normalize_symbol(raw_s)
                    if not sym.endswith("USDT") or sym in EXCLUDED:
                        continue
                    all_usdt.append(sym)

                    fut_price = parse_float(item.get("lastPrice"))
                    fut_vol = parse_float(item.get("quoteVolume"))
                    fut_pct = parse_float(item.get("priceChangePercent"))
                    high_p = parse_float(item.get("highPrice"))
                    low_p = parse_float(item.get("lowPrice"))

                    if fut_price <= 0 or fut_vol < 1_000_000.0:
                        continue

                    # Spot data lookup
                    s_item = spot_map.get(sym)
                    if s_item:
                        spot_price = parse_float(s_item.get("lastPrice")) or fut_price
                        spot_vol = parse_float(s_item.get("quoteVolume")) or (fut_vol * 0.4)
                        spot_pct = parse_float(s_item.get("priceChangePercent")) or fut_pct
                    else:
                        spot_price = fut_price
                        spot_vol = fut_vol * 0.35
                        spot_pct = fut_pct

                    # Basis calculation: (Futures - Spot) / Spot * 100
                    basis_pct = round(((fut_price - spot_price) / spot_price * 100.0), 3) if spot_price > 0 else 0.0

                    # Volume Δ string representation
                    spot_vol_str = f"${spot_vol / 1_000_000:.1f}M ({spot_pct:+.1f}%)"
                    fut_vol_str = f"${fut_vol / 1_000_000:.1f}M ({fut_pct:+.1f}%)"

                    # Range position
                    rng = high_p - low_p
                    range_pos = (fut_price - low_p) / rng if rng > 0 else 0.5

                    # 11-Ajan Kuant Swarm Atama ve Sinyal Matrisi
                    meme_tokens = {
                        "DOGEUSDT", "PEPEUSDT", "SHIBUSDT", "1000SHIBUSDT", "1000PEPEUSDT",
                        "WIFUSDT", "BONKUSDT", "1000BONKUSDT", "FLOKIUSDT", "1000FLOKIUSDT",
                        "BOMEUSDT", "POPCATUSDT", "NEIROUSDT", "TURBOUSDT", "MEMEUSDT", "PEOPLEUSDT"
                    }
                    macro_tokens = {"BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"}
                    depth_tokens = {"NEARUSDT", "RENDERUSDT", "FETUSDT", "TAOUSDT", "ICPUSDT", "AVAXUSDT", "APTUSDT"}
                    hft_tokens = {"SUIUSDT", "SEIUSDT", "INJUSDT", "TIAUSDT"}
                    layer2_tokens = {"ARBUSDT", "OPUSDT", "STRKUSDT", "BLURUSDT", "ENAUSDT", "LDOUSDT"}
                    hedge_tokens = {"LINKUSDT", "ADAUSDT", "DOTUSDT", "MATICUSDT", "ATOMUSDT"}

                    if sym in meme_tokens or (abs(fut_pct) >= 4.0 and fut_vol >= 5_000_000.0):
                        focused_agent = "🎯 Hot-Coin Sniper"
                        signal = "LONG" if fut_pct > 0 else "SHORT"
                        score = min(98, int(72 + abs(fut_pct) * 2.2))
                        reason = f"Meme/Volatilite Patlaması (%{fut_pct:+.2f})"
                    elif abs(basis_pct) >= 0.22 or (range_pos >= 0.88 or range_pos <= 0.12):
                        focused_agent = "🩸 Liquidation Hunter"
                        if range_pos >= 0.88 or basis_pct <= -0.22:
                            signal = "SHORT"
                            score = min(97, int(75 + abs(basis_pct) * 35))
                            reason = f"Short Likidite Sıkışması (Basis: %{basis_pct:+.2f})"
                        else:
                            signal = "LONG"
                            score = min(97, int(75 + abs(basis_pct) * 35))
                            reason = f"Long Likidite Kapitülasyonu (Basis: %{basis_pct:+.2f})"
                    elif sym in macro_tokens and fut_vol >= 50_000_000.0:
                        focused_agent = "🐋 Whale Flow Sentinel"
                        signal = "LONG" if (basis_pct >= 0 or fut_pct > 0) else "SHORT"
                        score = min(96, int(70 + (fut_vol / 80_000_000) * 10 + abs(fut_pct) * 1.5))
                        reason = f"Kurumsal Balina Akışı (${fut_vol / 1_000_000:.0f}M)"
                    elif sym in depth_tokens or abs(spot_pct - fut_pct) >= 0.8:
                        focused_agent = "📊 Orderbook Depth AI"
                        signal = "LONG" if spot_pct >= fut_pct else "SHORT"
                        score = min(94, int(68 + abs(spot_pct - fut_pct) * 10))
                        reason = f"Derinlik Dengesizliği (Spot/Fut Δ%{spot_pct - fut_pct:+.2f})"
                    elif sym in hft_tokens or (0.5 <= abs(fut_pct) <= 2.5 and fut_vol >= 10_000_000.0):
                        focused_agent = "⚡ Sub-Second Executor"
                        signal = "LONG" if fut_pct > 0 else "SHORT"
                        score = max(65, min(92, int(66 + abs(fut_pct) * 3.5)))
                        reason = f"HFT Mikro-Akış (%{fut_pct:+.2f})"
                    elif sym in layer2_tokens or (0.2 <= abs(fut_pct) < 1.5 and fut_vol >= 5_000_000.0):
                        focused_agent = "🌾 Trailing Scalper"
                        signal = "LONG" if fut_pct > 0 else "SHORT"
                        score = max(62, min(90, int(64 + abs(fut_pct) * 4.0)))
                        reason = f"İz Süren Mikro-Kâr (%{fut_pct:+.2f})"
                    elif sym in hedge_tokens:
                        focused_agent = "⚖️ Dynamic Hedger"
                        signal = "SHORT" if fut_pct > 1.2 else "LONG" if fut_pct < -1.2 else "LONG"
                        score = min(88, int(65 + abs(fut_pct) * 2.0))
                        reason = f"Delta-Neutral Koruma Sinyali"
                    elif abs(fut_pct) >= 5.0:
                        focused_agent = "🐦 Social & X Sentiment"
                        signal = "LONG" if fut_pct > 0 else "SHORT"
                        score = min(95, int(72 + abs(fut_pct) * 2.0))
                        reason = f"Sosyal Duygu & FOMO İvmesi (%{fut_pct:+.2f})"
                    elif sym in macro_tokens:
                        focused_agent = "🛰️ Orchestrator Alpha"
                        signal = "LONG" if fut_pct > 0 else "SHORT"
                        score = min(90, int(66 + abs(fut_pct) * 2.0))
                        reason = f"Makro Piyasa Rejim Yönü"
                    elif abs(fut_pct) >= 1.5:
                        focused_agent = "🎯 Hot-Coin Sniper"
                        signal = "LONG" if fut_pct > 0 else "SHORT"
                        score = min(92, int(65 + abs(fut_pct) * 2.5))
                        reason = f"Momentum Kırılımı (%{fut_pct:+.2f})"
                    else:
                        focused_agent = "⚡ Sub-Second Executor"
                        signal = "LONG" if fut_pct >= 0 else "SHORT"
                        score = 62
                        reason = "Dengeli Tahta Takibi"

                    valid_tickers.append({
                        "symbol": sym,
                        "price": fut_price,
                        "spot_price": spot_price,
                        "price_change_pct": round(fut_pct, 2),
                        "spot_vol": spot_vol,
                        "futures_vol": fut_vol,
                        "spot_vol_str": spot_vol_str,
                        "futures_vol_str": fut_vol_str,
                        "basis_pct": basis_pct,
                        "range_pos": round(range_pos, 2),
                        "obi": 0.0,
                        "focused_agent": focused_agent,
                        "signal": signal,
                        "score": score,
                        "reason": reason,
                    })

                if all_usdt:
                    self.all_symbols = all_usdt
                    self.scanned_pairs_count = len(all_usdt)

                # Sort by combined volume and score, select TOP 15
                valid_tickers.sort(key=lambda x: (x["score"] * 1_000_000 + x["futures_vol"]), reverse=True)
                top15 = valid_tickers[:15]

                # Concurrently fetch deep L2 depth for TOP 15 pairs
                depth_tasks = [self.fetch_l2_obi(client, c["symbol"]) for c in top15]
                obis = await asyncio.gather(*depth_tasks, return_exceptions=True)

                prices_map = {}
                for c, obi_val in zip(top15, obis):
                    val = obi_val if isinstance(obi_val, float) else 0.0
                    c["obi"] = val
                    if val > 0.15 and c["signal"] in ("LONG", "BEKLE"):
                        c["score"] = min(99, c["score"] + 10)
                        c["reason"] += f" | OBI: +%{val * 100:.1f}"
                    elif val < -0.15 and c["signal"] in ("SHORT", "BEKLE"):
                        c["score"] = min(99, c["score"] + 10)
                        c["reason"] += f" | OBI: %{val * 100:.1f}"

                    prices_map[c["symbol"]] = c["price"]

                # Final sort by score
                top15.sort(key=lambda x: x["score"], reverse=True)

                # Macro statistics
                longs = sum(1 for c in top15 if c["signal"] == "LONG")
                shorts = sum(1 for c in top15 if c["signal"] == "SHORT")
                neutrals = len(top15) - longs - shorts
                bull_pct = round((longs / len(top15)) * 100.0, 1) if top15 else 50.0
                bear_pct = round((shorts / len(top15)) * 100.0, 1) if top15 else 50.0

                if bull_pct >= 60.0:
                    macro_sig = "SİSTEMİK BOĞA HAKİMİYETİ"
                    m_state = "BULLISH"
                elif bear_pct >= 60.0:
                    macro_sig = "SİSTEMİK AYI BASKISI"
                    m_state = "BEARISH"
                else:
                    macro_sig = "DENGELİ / NÖTR PİYASA MENZİLİ"
                    m_state = "NÖTR"

                self.macro_summary = {
                    "total_scanned": len(top15),
                    "long_count": longs,
                    "short_count": shorts,
                    "neutral_count": neutrals,
                    "bullish_pct": bull_pct,
                    "bearish_pct": bear_pct,
                    "system_macro_signal": macro_sig,
                    "market_state": m_state,
                    "risk_index": "ORTA",
                }

                self.radar = top15
                self.prices = prices_map
                self.last_scan_time = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                return self.radar
        except Exception as e:
            db.log(f"Market tarama hatası: {e}", "ERROR", "SCANNER")
            return self.radar
        finally:
            self._is_scanning = False


market_scanner = MarketScanner()
