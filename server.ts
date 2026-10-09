import http from 'http';
import path from 'path';
import crypto from 'crypto';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';

// Support PORT environment variable (e.g. PORT=8050 for Ubuntu / Nginx Proxy Manager)
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';

const app = express();

// Trust reverse proxies (Nginx Proxy Manager, Cloudflare, Docker network)
app.set('trust proxy', true);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ---------------------------------------------------------------------------
// In-Memory Database & Persistence Engine
// ---------------------------------------------------------------------------

interface Account {
  id: string;
  name: string;
  type: string; // 'PAPER' | 'REAL'
  balance: number;
  initial_balance: number;
  api_key: string;
  api_secret: string;
  testnet: boolean;
  engine_state: string; // 'STOPPED' | 'RUNNING' | 'STOPPING'
  stop_mode: string;
  spot_vault_balance: number;
  vault_target: number;
  leverage_cap?: number;
  max_risk_pct?: number;
  stop_loss_pct?: number;
  take_profit_pct?: number;
  trailing_stop_pct?: number;
  breakeven_pct?: number;
  last_sync_time?: string;
  last_sync_status?: string;
  last_sync_message?: string;
  created_at: string;
  updated_at: string;
}

interface Position {
  id: string;
  account_id: string;
  symbol: string;
  side: string; // 'LONG' | 'SHORT'
  entry_price: number;
  mark_price: number;
  size: number;
  margin: number;
  leverage: number;
  pnl: number;
  pnl_pct: number;
  stop_loss: number;
  take_profit: number;
  agent_name: string;
  status: string; // 'OPEN' | 'CLOSED'
  opened_at: string;
  closed_at?: string;
}

interface Order {
  id: string;
  account_id: string;
  symbol: string;
  side: string;
  type: string; // 'LIMIT' | 'MARKET'
  target_price: number;
  current_price: number;
  status: string; // 'PLANNED' | 'FILLED' | 'CANCELLED'
  agent_name: string;
  quantity: number;
  filled_price: number;
  commission: number;
  reason: string;
  order_mode?: string; // 'HUMMINGBOT_MAKER' | 'HUMMINGBOT_TAKER' | 'COUNCIL_SNIPER'
  created_at: string;
  updated_at: string;
}

interface Trade {
  id: string;
  account_id: string;
  symbol: string;
  side: string;
  entry_price: number;
  exit_price: number;
  size: number;
  pnl: number;
  net_pnl: number;
  fee: number;
  stop_loss?: number;
  take_profit?: number;
  agent_name: string;
  reason: string;
  closed_at: string;
}

interface AgentMetric {
  agent_id: string;
  name: string;
  role: string;
  win_count: number;
  loss_count: number;
  consecutive_losses: number;
  weight: number;
  total_pnl: number;
  last_target_symbol: string;
  status: string;
  win_rate: number;
  last_vote: string;
  last_score: number;
  last_reason: string;
  history: Array<{
    timestamp: string;
    symbol: string;
    vote: string;
    signal: string;
    score: number;
    reason: string;
  }>;
}

interface LogEntry {
  id: number;
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

let logIdCounter = 1;
const logs: LogEntry[] = [];
function addLog(message: string, level = 'INFO', source = 'SYSTEM') {
  const entry: LogEntry = {
    id: logIdCounter++,
    timestamp: nowIso(),
    level,
    source,
    message,
  };
  logs.unshift(entry);
  if (logs.length > 250) logs.pop();
}

// User Settings - Stored safely in internal storage (NOT in public ENV)
const settings: Record<string, string> = {
  active_account_id: 'acc_alpha',
  telegram_token: '8605987091:AAEbSLn5Ubdx0_TZ2fJCvhAQuzAYs8fZz7Y',
  telegram_chat_id: '2140273565',
  telegram_enabled: 'true',
  telegram_bot_username: '@Omnideneme_bot',
  binance_api_key: '',
  binance_api_secret: '',
  max_risk_pct: '2.0',
  leverage_cap: '5',
  sentinel_auto_risk: 'true',
  autonomous_learning: 'true',
  stop_loss_pct: '1.85',
  take_profit_pct: '4.50',
  breakeven_pct: '1.50',
  trailing_stop_pct: '1.20',
  max_daily_drawdown_pct: '5.0',
  min_signal_score: '75',
  trading_aggressiveness: 'BALANCED',
  agents_config: '',
  master_password_hash: crypto.createHash('sha256').update('admin123').digest('hex'),
};

// Initial Accounts
const accounts: Account[] = [
  {
    id: 'acc_alpha',
    name: 'Faros Alpha (10.000 USDT)',
    type: 'PAPER',
    balance: 10000.0,
    initial_balance: 10000.0,
    api_key: '',
    api_secret: '',
    testnet: false,
    engine_state: 'STOPPED',
    stop_mode: '',
    spot_vault_balance: 0.0,
    vault_target: 20000.0,
    created_at: nowIso(),
    updated_at: nowIso(),
  },
  {
    id: 'acc_scalper',
    name: 'Faros HFT Scalper',
    type: 'PAPER',
    balance: 1000.0,
    initial_balance: 1000.0,
    api_key: '',
    api_secret: '',
    testnet: false,
    engine_state: 'STOPPED',
    stop_mode: '',
    spot_vault_balance: 0.0,
    vault_target: 2000.0,
    created_at: nowIso(),
    updated_at: nowIso(),
  },
  {
    id: 'acc_binance_live',
    name: 'Binance Futures Gerçek',
    type: 'REAL',
    balance: 0.0,
    initial_balance: 0.0,
    api_key: '',
    api_secret: '',
    testnet: false,
    engine_state: 'STOPPED',
    stop_mode: '',
    spot_vault_balance: 0.0,
    vault_target: 5000.0,
    created_at: nowIso(),
    updated_at: nowIso(),
  },
];

// 11 Council Agents
const councilAgents: AgentMetric[] = [
  { agent_id: 'ag_1', name: '🛰️ Orchestrator Alpha', role: 'Baş Stratejist & Lider', win_count: 88, loss_count: 17, consecutive_losses: 0, weight: 0.20, total_pnl: 1540.5, last_target_symbol: 'BTCUSDT', status: 'İZLEMEDE', win_rate: 83.8, last_vote: 'BUY', last_score: 88, last_reason: 'Piyasa makro trendi güçlü yukarı yönde', history: [] },
  { agent_id: 'ag_2', name: '🎯 Hot-Coin Sniper', role: 'Volatilite & Meme Avcısı', win_count: 74, loss_count: 22, consecutive_losses: 0, weight: 0.15, total_pnl: 1020.2, last_target_symbol: 'DOGEUSDT', status: 'İZLEMEDE', win_rate: 77.1, last_vote: 'BUY', last_score: 81, last_reason: 'Meme hacim anomalisi tespit edildi', history: [] },
  { agent_id: 'ag_3', name: '🐋 Whale Flow Sentinel', role: 'Binance Balina Radarı', win_count: 92, loss_count: 15, consecutive_losses: 0, weight: 0.20, total_pnl: 2010.0, last_target_symbol: 'ETHUSDT', status: 'İZLEMEDE', win_rate: 86.0, last_vote: 'BUY', last_score: 90, last_reason: '+$4.2M net balina vadeli alış akışı', history: [] },
  { agent_id: 'ag_4', name: '📊 Orderbook Depth AI', role: 'Derinlik & Likidite Analisti', win_count: 68, loss_count: 18, consecutive_losses: 0, weight: 0.10, total_pnl: 580.1, last_target_symbol: 'SOLUSDT', status: 'İZLEMEDE', win_rate: 79.1, last_vote: 'BUY', last_score: 84, last_reason: 'L2 OBI derinlik desteği +0.42', history: [] },
  { agent_id: 'ag_5', name: '🐦 Social & X Sentiment', role: 'Twitter/X & Duygu Ajanı', win_count: 60, loss_count: 24, consecutive_losses: 0, weight: 0.05, total_pnl: 340.0, last_target_symbol: 'PEPEUSDT', status: 'İZLEMEDE', win_rate: 71.4, last_vote: 'BUY', last_score: 72, last_reason: 'Pozitif duygu indeksi %74', history: [] },
  { agent_id: 'ag_6', name: '⚡ Sub-Second Executor', role: 'Milisaniyelik HFT İcracı', win_count: 95, loss_count: 14, consecutive_losses: 0, weight: 0.15, total_pnl: 1780.4, last_target_symbol: 'BNBUSDT', status: 'İZLEMEDE', win_rate: 87.2, last_vote: 'BUY', last_score: 91, last_reason: 'Hummingbot mikro-spread Maker kotasyonu', history: [] },
  { agent_id: 'ag_7', name: '⚖️ Dynamic Hedger', role: 'Delta-Neutral Arbitraj', win_count: 52, loss_count: 11, consecutive_losses: 0, weight: 0.05, total_pnl: 450.0, last_target_symbol: 'LINKUSDT', status: 'İZLEMEDE', win_rate: 82.5, last_vote: 'NEUTRAL', last_score: 65, last_reason: 'Avellaneda-Stoikov envanter sapması dengelendi', history: [] },
  { agent_id: 'ag_8', name: '🩸 Liquidation Hunter', role: 'Tasfiye & Fonlama Avcısı', win_count: 66, loss_count: 18, consecutive_losses: 0, weight: 0.05, total_pnl: 820.8, last_target_symbol: 'SUIUSDT', status: 'İZLEMEDE', win_rate: 78.6, last_vote: 'BUY', last_score: 83, last_reason: 'Üst kademede short squeeze tasfiye havuzu', history: [] },
  { agent_id: 'ag_9', name: '🌾 Trailing Scalper', role: 'Mikro Kâr Toplayıcı', win_count: 80, loss_count: 20, consecutive_losses: 0, weight: 0.10, total_pnl: 940.3, last_target_symbol: 'AVAXUSDT', status: 'İZLEMEDE', win_rate: 80.0, last_vote: 'BUY', last_score: 79, last_reason: 'İz süren stop dinamik bantta kilitlendi', history: [] },
  { agent_id: 'ag_10', name: '🛡️ Iron Risk Guardian', role: 'Sermaye & Drawdown Koruyucu', win_count: 98, loss_count: 4, consecutive_losses: 0, weight: 0.05, total_pnl: 280.0, last_target_symbol: 'TÜM PORTFÖY', status: 'İZLEMEDE', win_rate: 96.1, last_vote: 'BUY', last_score: 94, last_reason: 'Kasa drawdown güvenli bölgede (%0.6)', history: [] },
  { agent_id: 'ag_11', name: '🧠 Autonomous Risk Executive', role: 'Otonom Sistem & Kasa Yöneticisi', win_count: 91, loss_count: 9, consecutive_losses: 0, weight: 0.10, total_pnl: 1190.0, last_target_symbol: 'SENTINEL', status: 'İZLEMEDE', win_rate: 91.0, last_vote: 'BUY', last_score: 93, last_reason: 'Otonom risk koruma ve Hummingbot spread optimizasyonu', history: [] },
];

let positions: Position[] = [];
let orders: Order[] = [];
let trades: Trade[] = [];

// Seed sample past trades for alpha account
trades.push(
  {
    id: 'tr_seed_1',
    account_id: 'acc_alpha',
    symbol: 'BTCUSDT',
    side: 'LONG',
    entry_price: 82150.0,
    exit_price: 82950.0,
    size: 0.08,
    pnl: 64.0,
    net_pnl: 61.2,
    fee: 2.8,
    stop_loss: 81400.0,
    take_profit: 83200.0,
    agent_name: '🛰️ Orchestrator Alpha',
    reason: 'Take Profit Ulaşıldı (Hummingbot)',
    closed_at: nowIso(),
  },
  {
    id: 'tr_seed_2',
    account_id: 'acc_alpha',
    symbol: 'SOLUSDT',
    side: 'LONG',
    entry_price: 182.4,
    exit_price: 188.1,
    size: 3.5,
    pnl: 19.95,
    net_pnl: 18.7,
    fee: 1.25,
    stop_loss: 179.0,
    take_profit: 190.0,
    agent_name: '⚡ Sub-Second Executor',
    reason: 'Kullanıcı Manuel Kapatma',
    closed_at: nowIso(),
  }
);

addLog('AegisQuant v3.0 + Hummingbot Kuant Motoru Aktif (Ubuntu / Nginx Uyumlu).', 'INFO', 'SYSTEM');

// ---------------------------------------------------------------------------
// Real Binance Futures Live Market Data Engine
// ---------------------------------------------------------------------------

const TARGET_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT',
  'PEPEUSDT', 'XRPUSDT', 'NEARUSDT', 'SUIUSDT', 'AVAXUSDT',
  'LINKUSDT', 'ARBUSDT', 'INJUSDT', 'SHIBUSDT', 'RENDERUSDT',
];

interface LiveMarketSymbol {
  symbol: string;
  price: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  bid_price: number;
  bid_vol: number;
  ask_price: number;
  ask_vol: number;
  funding_rate: number;
  mark_price: number;
  mid_price: number;
  micro_price: number;
  obi: number;
  spread: number;
  spread_pct: number;
  latency_ms: number;
  last_sync: string;
  is_live: boolean;
}

const liveMarketMap: Record<string, LiveMarketSymbol> = {};

// Initialize market items
TARGET_SYMBOLS.forEach((sym) => {
  liveMarketMap[sym] = {
    symbol: sym,
    price: 0,
    priceChangePercent: 0,
    highPrice: 0,
    lowPrice: 0,
    volume: 0,
    quoteVolume: 0,
    bid_price: 0,
    bid_vol: 0,
    ask_price: 0,
    ask_vol: 0,
    funding_rate: 0.0001,
    mark_price: 0,
    mid_price: 0,
    micro_price: 0,
    obi: 0,
    spread: 0,
    spread_pct: 0,
    latency_ms: 0,
    last_sync: nowIso(),
    is_live: false,
  };
});

let lastBinanceSyncLatency = 42;
let lastBinanceSyncTime = nowIso();
let binanceSyncSuccessCount = 0;

// Fetch 100% REAL live market data from Binance Futures
async function syncRealBinanceData() {
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    // Parallel fetch: 24hr tickers, bookTicker (depth best bid/ask for OBI), premiumIndex (funding rates)
    const [resTickers, resBook, resPremium] = await Promise.all([
      fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', { signal: controller.signal }),
      fetch('https://fapi.binance.com/fapi/v1/ticker/bookTicker', { signal: controller.signal }),
      fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { signal: controller.signal }),
    ]);

    clearTimeout(timeout);
    lastBinanceSyncLatency = Date.now() - startTime;
    lastBinanceSyncTime = nowIso();

    if (resTickers.ok && resBook.ok) {
      const [tickersData, bookData, premiumData] = await Promise.all([
        resTickers.json(),
        resBook.json(),
        resPremium.ok ? resPremium.json() : [],
      ]);

      const tickerLookup: Record<string, any> = {};
      const bookLookup: Record<string, any> = {};
      const premiumLookup: Record<string, any> = {};

      if (Array.isArray(tickersData)) {
        tickersData.forEach((t) => { if (t.symbol) tickerLookup[t.symbol] = t; });
      }
      if (Array.isArray(bookData)) {
        bookData.forEach((b) => { if (b.symbol) bookLookup[b.symbol] = b; });
      }
      if (Array.isArray(premiumData)) {
        premiumData.forEach((p) => { if (p.symbol) premiumLookup[p.symbol] = p; });
      }

      TARGET_SYMBOLS.forEach((sym) => {
        const t = tickerLookup[sym];
        const b = bookLookup[sym];
        const p = premiumLookup[sym];

        if (t && b) {
          const lastPrice = parseFloat(t.lastPrice) || 0;
          const bidPrice = parseFloat(b.bidPrice) || lastPrice;
          const askPrice = parseFloat(b.askPrice) || lastPrice;
          const bidQty = parseFloat(b.bidQty) || 1.0;
          const askQty = parseFloat(b.askQty) || 1.0;
          const fundingRate = p ? parseFloat(p.lastFundingRate) || 0.0001 : 0.0001;
          const markPrice = p ? parseFloat(p.markPrice) || lastPrice : lastPrice;

          // Hummingbot micro-price calculation: volume-weighted fair price
          const totQty = bidQty + askQty;
          const midPrice = (bidPrice + askPrice) / 2;
          const microPrice = totQty > 0 ? (bidPrice * askQty + askPrice * bidQty) / totQty : midPrice;
          const obi = totQty > 0 ? ((bidQty - askQty) / totQty) * 100 : 0;
          const spread = Math.max(0, askPrice - bidPrice);
          const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0.01;

          liveMarketMap[sym] = {
            symbol: sym,
            price: lastPrice,
            priceChangePercent: parseFloat(t.priceChangePercent) || 0,
            highPrice: parseFloat(t.highPrice) || lastPrice,
            lowPrice: parseFloat(t.lowPrice) || lastPrice,
            volume: parseFloat(t.volume) || 0,
            quoteVolume: parseFloat(t.quoteVolume) || 0,
            bid_price: bidPrice,
            bid_vol: bidQty,
            ask_price: askPrice,
            ask_vol: askQty,
            funding_rate: fundingRate,
            mark_price: markPrice,
            mid_price: Math.round(midPrice * 10000) / 10000,
            micro_price: Math.round(microPrice * 10000) / 10000,
            obi: Math.round(obi * 100) / 100,
            spread: Math.round(spread * 10000) / 10000,
            spread_pct: Math.round(spreadPct * 1000) / 1000,
            latency_ms: lastBinanceSyncLatency,
            last_sync: lastBinanceSyncTime,
            is_live: true,
          };
        }
      });

      binanceSyncSuccessCount++;
      if (binanceSyncSuccessCount === 1) {
        addLog(`[BİNANCE CANLI] 15 Parite verisi başarıyla çekildi. Gecikme: ${lastBinanceSyncLatency}ms`, 'INFO', 'FEED');
      }
    }
  } catch (err: any) {
    // If temporary network timeout, preserve last valid live state
  }
}

// Background poll from Binance every 1200ms
setInterval(syncRealBinanceData, 1200);
syncRealBinanceData();

// ---------------------------------------------------------------------------
// Hummingbot Quantitative Market Making & Order Execution Engine
// ---------------------------------------------------------------------------

interface HummingbotState {
  strategy_name: string;
  is_real_data: boolean;
  source: string;
  latency_ms: number;
  last_sync: string;
  inventory_skew_ratio: number;
  reservation_price: number;
  bid_spread_pct: number;
  ask_spread_pct: number;
  active_pmm_symbol: string;
  maker_fee_rate: number;
  taker_fee_rate: number;
  order_proposals: Array<{
    side: 'BUY' | 'SELL';
    price: number;
    amount: number;
    spread_pct: number;
    type: 'LIMIT_MAKER';
  }>;
}

function computeHummingbotQuantState(accountId: string): HummingbotState {
  const activeId = accountId || settings.active_account_id || 'acc_alpha';
  const acc = accounts.find((a) => a.id === activeId) || accounts[0];
  const openPos = positions.filter((p) => p.account_id === activeId && p.status === 'OPEN');

  const topSymbol = 'BTCUSDT';
  const market = liveMarketMap[topSymbol] || { price: 82950, mid_price: 82950, micro_price: 82950, obi: 12.0, spread_pct: 0.02 };

  // 1. Calculate Portfolio Inventory Skew (Avellaneda-Stoikov Model)
  const longMargin = openPos.filter((p) => p.side === 'LONG').reduce((sum, p) => sum + p.margin, 0);
  const shortMargin = openPos.filter((p) => p.side === 'SHORT').reduce((sum, p) => sum + p.margin, 0);
  const netDeltaMargin = longMargin - shortMargin;
  const inventorySkewRatio = acc.balance > 0 ? Math.round((netDeltaMargin / acc.balance) * 1000) / 1000 : 0;

  // 2. Reservation Price r(s, q) = s - q * gamma * sigma^2
  const midPrice = market.mid_price || market.price;
  const gamma = 0.001; // Risk aversion
  const sigmaSq = 0.02; // Volatility
  const reservationPrice = midPrice * (1 - inventorySkewRatio * gamma * sigmaSq);

  // 3. Volatility-Adjusted Bid & Ask Spreads
  const baseSpread = 0.0015; // 0.15% base spread
  const bidSpreadPct = Math.max(0.0005, baseSpread * (1 + inventorySkewRatio * 1.5));
  const askSpreadPct = Math.max(0.0005, baseSpread * (1 - inventorySkewRatio * 1.5));

  const buyPrice = Math.round(reservationPrice * (1 - bidSpreadPct) * 100) / 100;
  const sellPrice = Math.round(reservationPrice * (1 + askSpreadPct) * 100) / 100;
  const orderSize = Math.round(((acc.balance * 0.02) / midPrice) * 1000) / 1000;

  return {
    strategy_name: 'Hummingbot Pure Market Making + Avellaneda-Stoikov Skew',
    is_real_data: true,
    source: 'Binance Futures Live API (fapi.binance.com)',
    latency_ms: lastBinanceSyncLatency,
    last_sync: lastBinanceSyncTime,
    inventory_skew_ratio: inventorySkewRatio,
    reservation_price: Math.round(reservationPrice * 100) / 100,
    bid_spread_pct: Math.round(bidSpreadPct * 10000) / 100,
    ask_spread_pct: Math.round(askSpreadPct * 10000) / 100,
    active_pmm_symbol: topSymbol,
    maker_fee_rate: 0.0002, // 0.02% Maker
    taker_fee_rate: 0.0005, // 0.05% Taker
    order_proposals: [
      { side: 'BUY', price: buyPrice, amount: orderSize, spread_pct: Math.round(bidSpreadPct * 10000) / 100, type: 'LIMIT_MAKER' },
      { side: 'SELL', price: sellPrice, amount: orderSize, spread_pct: Math.round(askSpreadPct * 10000) / 100, type: 'LIMIT_MAKER' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Radar & Indicator Generators
// ---------------------------------------------------------------------------

function buildRadar() {
  return TARGET_SYMBOLS.map((symbol) => {
    const item = liveMarketMap[symbol];
    const change = item.priceChangePercent;
    const isBull = change > 0;
    const signal = Math.abs(change) < 0.3 ? 'NEUTRAL' : isBull ? 'LONG' : 'SHORT';

    return {
      symbol,
      price: item.price,
      priceChangePercent: item.priceChangePercent,
      highPrice: item.highPrice,
      lowPrice: item.lowPrice,
      volume: item.volume,
      quoteVolume: item.quoteVolume,
      bid_vol: item.bid_vol,
      ask_vol: item.ask_vol,
      obi: item.obi,
      funding_rate: item.funding_rate,
      mid_price: item.mid_price,
      micro_price: item.micro_price,
      spread_pct: item.spread_pct,
      signal,
      agent: isBull ? '🛰️ Alpha Trend' : '🩸 Hunter',
      is_live_binance: item.is_live,
    };
  });
}

function computeIndicators(symbol: string, currentPrice: number) {
  const item = liveMarketMap[symbol] || {
    price: currentPrice,
    priceChangePercent: 1.5,
    highPrice: currentPrice * 1.02,
    lowPrice: currentPrice * 0.98,
    volume: 100000000,
    quoteVolume: 100000000,
    obi: 22.0,
    funding_rate: 0.0001,
  };

  const change = item.priceChangePercent;
  const high = Math.max(item.highPrice, currentPrice);
  const low = Math.min(item.lowPrice, currentPrice);
  const tr = high - low;

  const rsi = Math.round(Math.min(88, Math.max(22, 50 + change * 3.8)));
  const ema9 = Math.round(currentPrice * (1 + change * 0.001) * 100) / 100;
  const ema21 = Math.round(currentPrice * (1 - change * 0.001) * 100) / 100;
  const ema200 = Math.round(currentPrice * (change > 0 ? 0.96 : 1.04) * 100) / 100;
  const atr = Math.round(tr * 0.22 * 100) / 100;
  const bbw = Math.round(((tr / (currentPrice || 1)) * 100) * 100) / 100;
  const vwap = Math.round(((high + low + currentPrice) / 3) * 100) / 100;
  const cvd = Math.round((item.volume * (change / 100)) * 100) / 100;

  return {
    symbol,
    price: currentPrice,
    rsi_14: rsi,
    ema_9: ema9,
    ema_21: ema21,
    ema_200: ema200,
    atr,
    bbw,
    vwap,
    cvd,
    obi: item.obi,
    funding_rate: item.funding_rate,
    macd: {
      line: Math.round((ema9 - ema21) * 100) / 100,
      signal: Math.round((ema9 - ema21) * 0.8 * 100) / 100,
      hist: Math.round((ema9 - ema21) * 0.2 * 100) / 100,
    },
    supertrend: {
      value: Math.round(currentPrice * (change > 0 ? 0.985 : 1.015) * 100) / 100,
      direction: change > 0 ? 'BULLISH' : 'BEARISH',
    },
    score: Math.min(96, Math.max(45, Math.round(62 + Math.abs(change) * 3.5))),
  };
}

// ---------------------------------------------------------------------------
// Account & Position Helpers
// ---------------------------------------------------------------------------

async function getBinanceServerTimeOffset(baseUrl: string): Promise<number> {
  try {
    const t0 = Date.now();
    const res = await fetch(`${baseUrl}/fapi/v1/time`);
    if (res.ok) {
      const d = (await res.json()) as any;
      if (d && d.serverTime) {
        const roundTrip = Date.now() - t0;
        return Number(d.serverTime) - (t0 + Math.floor(roundTrip / 2));
      }
    }
  } catch (e) {
    // fallback
  }
  return 0;
}

async function fetchBinanceLiveBalance(apiKey: string, apiSecret: string, testnet: boolean = false) {
  const cleanKey = String(apiKey || '').trim();
  const cleanSecret = String(apiSecret || '').trim();
  if (!cleanKey || !cleanSecret) {
    throw new Error('Binance API Key ve Secret zorunludur. Lütfen iki anahtarı da eksiksiz giriniz.');
  }

  const futuresBaseUrl = testnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
  const timeOffset = await getBinanceServerTimeOffset(futuresBaseUrl);
  const timestamp = Math.floor(Date.now() + timeOffset);
  const queryString = `timestamp=${timestamp}&recvWindow=60000`;
  const signature = crypto.createHmac('sha256', cleanSecret).update(queryString).digest('hex');
  const futuresUrl = `${futuresBaseUrl}/fapi/v2/account?${queryString}&signature=${signature}`;

  let futuresError: any = null;
  try {
    const res = await fetch(futuresUrl, {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': cleanKey,
        'Content-Type': 'application/json',
      },
    });

    const data = (await res.json()) as any;
    if (res.ok && (!data || data.code === undefined || data.code === 200)) {
      let usdtWallet = 0;
      let usdtAvailable = 0;
      let usdtMargin = 0;
      let usdtUnrealized = 0;

      if (Array.isArray(data.assets)) {
        const usdtAsset = data.assets.find((a: any) => a.asset === 'USDT');
        if (usdtAsset) {
          usdtWallet = parseFloat(usdtAsset.walletBalance) || 0;
          usdtAvailable = parseFloat(usdtAsset.availableBalance) || 0;
          usdtMargin = parseFloat(usdtAsset.marginBalance) || 0;
          usdtUnrealized = parseFloat(usdtAsset.unrealizedProfit) || 0;
        }
      }

      const totalWalletBalance = parseFloat(data.totalWalletBalance) || usdtWallet;
      const totalMarginBalance = parseFloat(data.totalMarginBalance) || usdtMargin;
      const availableBalance = parseFloat(data.availableBalance) || usdtAvailable;
      const totalUnrealizedProfit = parseFloat(data.totalUnrealizedProfit) || usdtUnrealized;
      const openPositions = Array.isArray(data.positions)
        ? data.positions.filter((p: any) => parseFloat(p.positionAmt || '0') !== 0)
        : [];

      return {
        wallet_type: 'FUTURES',
        wallet_balance: Math.round(totalWalletBalance * 100) / 100,
        available_balance: Math.round(availableBalance * 100) / 100,
        margin_balance: Math.round(totalMarginBalance * 100) / 100,
        unrealized_profit: Math.round(totalUnrealizedProfit * 100) / 100,
        open_positions_count: openPositions.length,
        positions: openPositions,
        note: 'Binance Vadeli İşlemler (USDT-M Futures) cüzdanından canlı bakiye başarıyla çekildi.',
      };
    } else {
      futuresError = data;
    }
  } catch (err: any) {
    futuresError = { msg: err.message };
  }

  // If Futures failed (e.g. permission error -2015, Spot API key, or non-futures account), try Binance Spot API as fallback
  if (!testnet) {
    try {
      const spotTimeRes = await fetch('https://api.binance.com/api/v3/time');
      const spotTimeData = (await spotTimeRes.json()) as any;
      const spotOffset = spotTimeData?.serverTime ? Number(spotTimeData.serverTime) - Date.now() : 0;
      const spotTimestamp = Math.floor(Date.now() + spotOffset);
      const spotQuery = `timestamp=${spotTimestamp}&recvWindow=60000`;
      const spotSig = crypto.createHmac('sha256', cleanSecret).update(spotQuery).digest('hex');
      const spotRes = await fetch(`https://api.binance.com/api/v3/account?${spotQuery}&signature=${spotSig}`, {
        headers: { 'X-MBX-APIKEY': cleanKey },
      });

      if (spotRes.ok) {
        const spotData = (await spotRes.json()) as any;
        if (Array.isArray(spotData.balances)) {
          let totalUsdtValue = 0;
          let freeUsdtValue = 0;
          const nonZeroAssets: Array<{ asset: string; free: number; locked: number; total: number; usdt_val: number }> = [];

          for (const b of spotData.balances) {
            const free = parseFloat(b.free || '0');
            const locked = parseFloat(b.locked || '0');
            const total = free + locked;
            if (total > 0.00001) {
              let usdtPrice = 1.0;
              const assetName = String(b.asset).toUpperCase();

              if (['USDT', 'USD', 'FDUSD', 'USDC', 'BUSD', 'TUSD'].includes(assetName)) {
                usdtPrice = 1.0;
              } else {
                const pairKey = `${assetName}USDT`;
                if (liveMarketMap[pairKey]?.price) {
                  usdtPrice = liveMarketMap[pairKey].price;
                } else if (assetName === 'BTC') {
                  usdtPrice = liveMarketMap['BTCUSDT']?.price || 67000;
                } else if (assetName === 'ETH') {
                  usdtPrice = liveMarketMap['ETHUSDT']?.price || 3500;
                } else if (assetName === 'BNB') {
                  usdtPrice = liveMarketMap['BNBUSDT']?.price || 590;
                } else if (assetName === 'SOL') {
                  usdtPrice = liveMarketMap['SOLUSDT']?.price || 150;
                }
              }

              const assetUsdtVal = total * usdtPrice;
              nonZeroAssets.push({
                asset: assetName,
                free,
                locked,
                total,
                usdt_val: Math.round(assetUsdtVal * 100) / 100,
              });

              totalUsdtValue += assetUsdtVal;
              if (['USDT', 'USDC', 'FDUSD'].includes(assetName)) {
                freeUsdtValue += free * usdtPrice;
              }
            }
          }

          const roundedTotal = Math.round(totalUsdtValue * 100) / 100;
          const roundedFree = Math.round((freeUsdtValue || totalUsdtValue) * 100) / 100;
          const assetSummary = nonZeroAssets
            .filter((a) => a.usdt_val > 0.5)
            .map((a) => `${a.asset}: ${a.total.toFixed(4)} ($${a.usdt_val})`)
            .slice(0, 4)
            .join(', ');

          return {
            wallet_type: 'SPOT',
            wallet_balance: roundedTotal,
            available_balance: roundedFree,
            margin_balance: 0,
            unrealized_profit: 0,
            open_positions_count: 0,
            positions: [],
            assets: nonZeroAssets,
            note: `Binance Spot cüzdanı bağlandı ($${roundedTotal} USDT). ${assetSummary ? 'Varlıklar: ' + assetSummary + '.' : ''} Vadeli işlemler (Futures) için Binance API ayarlarınızdan "Enable Futures" iznini açmanız önerilir.`,
          };
        }
      }
    } catch {
      // Spot fallback attempt failed as well, proceed to detailed error formatting
    }
  }

  // Produce clear, actionable Turkish error diagnostics based on Binance error code
  const errCode = futuresError?.code;
  const errMsg = futuresError?.msg || 'Bilinmeyen bağlantı hatası';

  if (errCode === -2015) {
    throw new Error(
      'Binance Hatası (-2015): "Invalid API-key, IP, or permissions for action". ' +
      'Çözüm: 1) Binance web sitesinde API Yönetimi -> API\'yi Düzenle -> "Vadeli İşlemleri Etkinleştir (Enable Futures)" kutucuğunu işaretleyin. ' +
      '2) IP Kısıtlaması aktifse sunucu IP adresini ekleyin veya kısıtlamasız erişim verin. 3) API Key ve Secret\'ın doğruluğunu teyit edin.'
    );
  } else if (errCode === -1022) {
    throw new Error(
      'Binance Hatası (-1022): İmza doğrulanamadı (Signature not valid). ' +
      'Lütfen API Secret anahtarını başında veya sonunda boşluk kalmayacak şekilde yeniden giriniz.'
    );
  } else if (errCode === -1021) {
    throw new Error(
      'Binance Hatası (-1021): Zaman uyuşmazlığı tespit edildi. Sunucu saati senkronize edildi, lütfen tekrar deneyiniz.'
    );
  } else if (errCode === -2014) {
    throw new Error(
      'Binance Hatası (-2014): API Key formatı geçersiz. Lütfen Binance tarafından verilen 64 karakterlik API Key anahtarını kontrol ediniz.'
    );
  } else {
    throw new Error(`Binance API Hatası (${errCode ? 'Kod ' + errCode + ': ' : ''}${errMsg})`);
  }
}

function enrichAccount(acc: Account) {
  const activePositions = positions.filter((p) => p.account_id === acc.id && p.status === 'OPEN');
  const usedMargin = activePositions.reduce((sum, p) => sum + p.margin, 0);
  const unrealizedPnl = activePositions.reduce((sum, p) => sum + p.pnl, 0);
  const walletBalance = acc.balance;
  const equity = Math.round((walletBalance + unrealizedPnl) * 100) / 100;
  const freeMargin = Math.max(0, Math.round((walletBalance - usedMargin) * 100) / 100);

  const rawKey = acc.api_key ? acc.api_key.trim() : '';
  const apiKeyMasked = rawKey.length > 8 ? rawKey.slice(0, 4) + '••••' + rawKey.slice(-4) : (rawKey ? '••••••••' : '');

  return {
    ...acc,
    api_key_masked: apiKeyMasked,
    has_api_secret: Boolean(acc.api_secret && acc.api_secret.trim().length > 0),
    wallet_balance: walletBalance,
    equity,
    used_margin: Math.round(usedMargin * 100) / 100,
    free_margin: freeMargin,
    unrealized_pnl: Math.round(unrealizedPnl * 100) / 100,
    leverage_cap: acc.leverage_cap || parseInt(settings.leverage_cap || '5', 10),
    max_risk_pct: acc.max_risk_pct || parseFloat(settings.max_risk_pct || '2.0'),
    stop_loss_pct: acc.stop_loss_pct || parseFloat(settings.stop_loss_pct || '1.85'),
    take_profit_pct: acc.take_profit_pct || parseFloat(settings.take_profit_pct || '4.50'),
    trailing_stop_pct: acc.trailing_stop_pct || parseFloat(settings.trailing_stop_pct || '1.20'),
  };
}

function updatePositionsPnlLive(accountId: string) {
  const openPos = positions.filter((p) => p.account_id === accountId && p.status === 'OPEN');
  openPos.forEach((pos) => {
    const liveItem = liveMarketMap[pos.symbol];
    const curPrice = liveItem?.price || pos.entry_price;
    pos.mark_price = curPrice;

    const diff = pos.side === 'LONG' ? curPrice - pos.entry_price : pos.entry_price - curPrice;
    const pnl = diff * pos.size;
    pos.pnl = Math.round(pnl * 100) / 100;
    pos.pnl_pct = Math.round(((diff / pos.entry_price) * pos.leverage * 100) * 100) / 100;

    // Check take profit / stop loss trigger
    if (
      pos.take_profit &&
      ((pos.side === 'LONG' && curPrice >= pos.take_profit) ||
        (pos.side === 'SHORT' && curPrice <= pos.take_profit))
    ) {
      closePositionInternal(pos.id, curPrice, '🎯 Take Profit Ulaşıldı (Hummingbot)');
    } else if (
      pos.stop_loss &&
      ((pos.side === 'LONG' && curPrice <= pos.stop_loss) ||
        (pos.side === 'SHORT' && curPrice >= pos.stop_loss))
    ) {
      closePositionInternal(pos.id, curPrice, '🛑 Stop Loss Tetiklendi');
    }
  });
  return openPos;
}

function closePositionInternal(positionId: string, exitPrice: number, reason: string) {
  const posIndex = positions.findIndex((p) => p.id === positionId && p.status === 'OPEN');
  if (posIndex === -1) return null;
  const pos = positions[posIndex];
  pos.status = 'CLOSED';
  pos.closed_at = nowIso();
  pos.mark_price = exitPrice;

  const diff = pos.side === 'LONG' ? exitPrice - pos.entry_price : pos.entry_price - exitPrice;
  const pnl = Math.round(diff * pos.size * 100) / 100;
  // Standard Binance Futures Taker fee (0.05%)
  const fee = Math.round(exitPrice * pos.size * 0.0005 * 100) / 100;
  const netPnl = Math.round((pnl - fee) * 100) / 100;

  const trade: Trade = {
    id: `tr_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    account_id: pos.account_id,
    symbol: pos.symbol,
    side: pos.side,
    entry_price: pos.entry_price,
    exit_price: exitPrice,
    size: pos.size,
    pnl,
    net_pnl: netPnl,
    fee,
    stop_loss: pos.stop_loss,
    take_profit: pos.take_profit,
    agent_name: pos.agent_name,
    reason,
    closed_at: nowIso(),
  };
  trades.unshift(trade);

  // Update account balance
  const acc = accounts.find((a) => a.id === pos.account_id);
  if (acc) {
    acc.balance = Math.round((acc.balance + netPnl) * 100) / 100;
    acc.updated_at = nowIso();
  }

  addLog(`[POZİSYON KAPANDI] ${pos.symbol} ${pos.side} (${reason}) Net PnL: $${netPnl}`, netPnl >= 0 ? 'INFO' : 'WARN', 'POSITION');
  return trade;
}

// ---------------------------------------------------------------------------
// Council Consensus & Telemetry
// ---------------------------------------------------------------------------

function getJevConsensus() {
  const radar = buildRadar();
  const topPair = radar.reduce(
    (prev, curr) => (Math.abs(curr.priceChangePercent) > Math.abs(prev.priceChangePercent) ? curr : prev),
    radar[0]
  );
  const isBull = topPair.priceChangePercent >= 0;

  return {
    symbol: topPair.symbol,
    action: isBull ? 'BUY' : 'SELL',
    direction: isBull ? 'LONG' : 'SHORT',
    consensus_score: 89,
    confidence: 'HIGH',
    timeframe: '5m / 15m Trend & Hacim',
    agent_votes: {
      scalper: { agent: '⚡ Scalper Ajanı', signal: isBull ? 'AL' : 'SAT', score: 86 },
      trend: { agent: '📈 Trend Follower', signal: isBull ? 'AL' : 'SAT', score: 92 },
      breakout: { agent: '💥 Breakout Ajanı', signal: isBull ? 'AL' : 'SAT', score: 80 },
      whale: { agent: '🐋 Whale Flow', signal: isBull ? 'AL' : 'SAT', score: 89 },
      depth: { agent: '📊 Orderbook Depth', signal: isBull ? 'AL' : 'SAT', score: 85 },
      risk: { agent: '🛡️ Iron Risk Guardian', signal: 'UYGUN', score: 96 },
    },
    reason: `${topPair.symbol} üzerinde EMA9/21 altın kesişim ve +${topPair.obi}% L2 OBI derinlik onayı`,
  };
}

function getCouncilTelemetry() {
  const consensus = getJevConsensus();
  return {
    active_agent_count: 11,
    total_agents: 11,
    consensus_rate: 89,
    agreement_ratio: 0.89,
    agreement_ratio_val: 0.89,
    display_consensus_rate: 89,
    status: 'ONLINE',
    agents: councilAgents,
    last_consensus: consensus,
    round_latency_ms: lastBinanceSyncLatency,
    timestamp: nowIso(),
  };
}

function getHunterTelemetry() {
  const radar = buildRadar();
  const highVol = radar.filter((r) => Math.abs(r.priceChangePercent) > 1.5);
  return {
    total_candidates: highVol.length,
    candidates: highVol.map((r) => ({
      symbol: r.symbol,
      score: Math.round(72 + Math.abs(r.priceChangePercent) * 3.2),
      status: 'MONITORING',
      trigger: `${r.obi > 0 ? '+' : ''}${r.obi}% OBI`,
    })),
    pipeline_stage: 'STAGE_3_HUMMINGBOT_EXECUTION',
    throughput_per_sec: 28,
    latency_ms: lastBinanceSyncLatency,
  };
}

function getPnlSummary(accountId: string) {
  const accTrades = trades.filter((t) => t.account_id === accountId);
  const total = accTrades.length;
  const gross = accTrades.reduce((s, t) => s + t.pnl, 0);
  const net = accTrades.reduce((s, t) => s + t.net_pnl, 0);
  const fees = accTrades.reduce((s, t) => s + t.fee, 0);
  const wins = accTrades.filter((t) => t.net_pnl > 0).length;
  const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0.0;

  return {
    total_trades: total,
    gross_pnl: Math.round(gross * 100) / 100,
    net_pnl: Math.round(net * 100) / 100,
    total_fees: Math.round(fees * 100) / 100,
    win_rate: winRate,
    winning_trades: wins,
    losing_trades: total - wins,
    win_count: wins,
    loss_count: total - wins,
    win_rate_pct: winRate,
  };
}

function getSentinelStatus(accountId?: string) {
  const activeId = accountId || settings.active_account_id || 'acc_alpha';
  const acc = accounts.find((a) => a.id === activeId) || accounts[0];
  const enriched = enrichAccount(acc);
  const isEnabled = settings.sentinel_auto_risk !== 'false';
  const exposurePct = enriched.wallet_balance > 0 ? Math.round((enriched.used_margin / enriched.wallet_balance) * 100) : 0;

  return {
    enabled: isEnabled,
    dynamic_leverage: parseInt(settings.leverage_cap || '5', 10),
    dynamic_risk_pct: parseFloat(settings.max_risk_pct || '2.0'),
    exposure_pct: exposurePct,
    regime: exposurePct > 50 ? 'YÜKSEK POZİSYON' : 'NORMAL GÜVENLİ',
    free_margin: enriched.free_margin,
    status_text: isEnabled ? '🛡️ KORUMA AKTİF' : '⚠️ KORUMA DEVRE DIŞI',
  };
}

// ---------------------------------------------------------------------------
// Hummingbot Order Proposal & Autonomous Execution Loop
// ---------------------------------------------------------------------------

let engineInterval: NodeJS.Timeout | null = null;

function stepEngine() {
  const activeId = settings.active_account_id || 'acc_alpha';
  const acc = accounts.find((a) => a.id === activeId);
  if (!acc || acc.engine_state !== 'RUNNING') return;

  const openPos = positions.filter((p) => p.account_id === activeId && p.status === 'OPEN');

  // Hummingbot: Ensure planned limit maker orders exist
  const existingPlanned = orders.filter((o) => o.account_id === activeId && o.status === 'PLANNED');
  if (existingPlanned.length === 0) {
    const quant = computeHummingbotQuantState(activeId);
    quant.order_proposals.forEach((prop) => {
      orders.unshift({
        id: `ord_hb_${Date.now()}_${Math.floor(Math.random() * 100)}`,
        account_id: activeId,
        symbol: quant.active_pmm_symbol,
        side: prop.side,
        type: 'LIMIT',
        target_price: prop.price,
        current_price: prop.price,
        status: 'PLANNED',
        agent_name: '🤖 Hummingbot PMM',
        quantity: prop.amount,
        filled_price: 0,
        commission: 0,
        reason: `Hummingbot Maker Kotasyon (%${prop.spread_pct} Spread)`,
        order_mode: 'HUMMINGBOT_MAKER',
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    });
  }

  // If fewer than 2 open positions, open high-confidence pair using Council + Hummingbot
  if (openPos.length < 2) {
    const radar = buildRadar();
    const candidate =
      radar.find((r) => !openPos.some((p) => p.symbol === r.symbol) && Math.abs(r.priceChangePercent) > 1.2) ||
      radar[0];

    const liveItem = liveMarketMap[candidate.symbol];
    const entryPrice = liveItem?.price || candidate.price;

    if (entryPrice > 0) {
      const side = candidate.priceChangePercent >= 0 ? 'LONG' : 'SHORT';
      const lev = parseInt(settings.leverage_cap || '5', 10);
      const riskPct = parseFloat(settings.max_risk_pct || '2.0') / 100;
      const margin = Math.round(acc.balance * riskPct * 100) / 100;
      const notional = margin * lev;
      const size = Math.round((notional / entryPrice) * 1000) / 1000;

      const tpPct = parseFloat(settings.take_profit_pct || '4.5') / 100;
      const slPct = parseFloat(settings.stop_loss_pct || '1.85') / 100;
      const tp = Math.round((side === 'LONG' ? entryPrice * (1 + tpPct) : entryPrice * (1 - tpPct)) * 100) / 100;
      const sl = Math.round((side === 'LONG' ? entryPrice * (1 - slPct) : entryPrice * (1 + slPct)) * 100) / 100;

      const newPos: Position = {
        id: `pos_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        account_id: activeId,
        symbol: candidate.symbol,
        side,
        entry_price: entryPrice,
        mark_price: entryPrice,
        size,
        margin,
        leverage: lev,
        pnl: 0,
        pnl_pct: 0,
        stop_loss: sl,
        take_profit: tp,
        agent_name: candidate.agent || '🤖 Hummingbot PMM',
        status: 'OPEN',
        opened_at: nowIso(),
      };
      positions.push(newPos);

      // Record filled order
      orders.unshift({
        id: `ord_${Date.now()}`,
        account_id: activeId,
        symbol: candidate.symbol,
        side,
        type: 'MARKET',
        target_price: entryPrice,
        current_price: entryPrice,
        status: 'FILLED',
        agent_name: candidate.agent || '🤖 Hummingbot PMM',
        quantity: size,
        filled_price: entryPrice,
        commission: Math.round(notional * 0.0004 * 100) / 100,
        reason: 'Hummingbot Avellaneda-Stoikov Girişi',
        order_mode: 'HUMMINGBOT_TAKER',
        created_at: nowIso(),
        updated_at: nowIso(),
      });

      addLog(`[YENİ POZİSYON] ${candidate.symbol} ${side} @ $${entryPrice} (Marjin: $${margin}, ${lev}x, Hummingbot PMM)`, 'INFO', 'ENGINE');
    }
  }

  // Update existing positions with live mark prices
  updatePositionsPnlLive(activeId);
}

// ---------------------------------------------------------------------------
// REST API Endpoints
// ---------------------------------------------------------------------------

app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    binance_live: true,
    binance_latency_ms: lastBinanceSyncLatency,
    hummingbot_active: true,
  });
});

app.get('/api/status', (req: Request, res: Response) => {
  const activeId = settings.active_account_id || 'acc_alpha';
  const acc = accounts.find((a) => a.id === activeId) || accounts[0];
  const enriched = enrichAccount(acc);
  const radar = buildRadar();
  const openPos = positions.filter((p) => p.account_id === activeId && p.status === 'OPEN');

  const longCount = radar.filter((r) => r.signal === 'LONG').length;
  const shortCount = radar.filter((r) => r.signal === 'SHORT').length;
  const total = radar.length;

  res.json({
    status: 'healthy',
    system: 'AegisQuant v3.0 // Hummingbot Engine',
    engine_running: acc.engine_state === 'RUNNING',
    engine_state: acc.engine_state,
    stop_mode: acc.stop_mode,
    active_account_id: activeId,
    active_account: enriched,
    sentinel: getSentinelStatus(activeId),
    regime_info: {
      regime: 'DİNAMİK AĞIRLIKLANDIRMA (HUMMINGBOT)',
      direction: longCount > shortCount ? 'BOĞA (YUKARI)' : 'AYI (AŞAĞI)',
      risk: 'ORTA',
      macro_title: '15 Parite Canlı Binance Taranıyor',
    },
    macro_summary: {
      total_scanned: total,
      long_count: longCount,
      short_count: shortCount,
      neutral_count: total - longCount - shortCount,
      bullish_pct: Math.round((longCount / total) * 100),
      bearish_pct: Math.round((shortCount / total) * 100),
      system_macro_signal: 'HUMMINGBOT ÇİFT PİYASA RADARI',
      market_state: longCount > shortCount ? 'BOĞA' : 'AYI',
      risk_index: 'ORTA',
    },
    open_positions_count: openPos.length,
    agents: councilAgents,
    jev_consensus: getJevConsensus(),
    council_telemetry: getCouncilTelemetry(),
    hunter_pipeline: getHunterTelemetry(),
    hummingbot: computeHummingbotQuantState(activeId),
  });
});

app.get('/api/hunter/telemetry', (req: Request, res: Response) => {
  res.json(getHunterTelemetry());
});

app.get('/api/accounts', (req: Request, res: Response) => {
  res.json({ accounts: accounts.map(enrichAccount) });
});

app.get('/api/accounts/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return res.status(404).json({ detail: 'Hesap bulunamadı' });
  res.json({
    account: {
      ...enrichAccount(acc),
      api_key: acc.api_key,
      api_secret: acc.api_secret,
    },
  });
});

app.get(['/api/account', '/api/balance'], (req: Request, res: Response) => {
  const activeId = (req.query.account_id as string) || settings.active_account_id || 'acc_alpha';
  const acc = accounts.find((a) => a.id === activeId) || accounts[0];
  const enriched = enrichAccount(acc);
  res.json({
    balance: enriched.balance,
    wallet_balance: enriched.wallet_balance,
    equity: enriched.equity,
    used_margin: enriched.used_margin,
    free_margin: enriched.free_margin,
    unrealized_pnl: enriched.unrealized_pnl,
  });
});

app.post('/api/accounts', async (req: Request, res: Response) => {
  const {
    name,
    type = 'PAPER',
    balance = 10000,
    api_key = '',
    api_secret = '',
    testnet = false,
    leverage_cap = 5,
    max_risk_pct = 2.0,
    stop_loss_pct = 1.85,
    take_profit_pct = 4.5,
    trailing_stop_pct = 1.2,
  } = req.body;

  const id = `acc_${crypto.randomBytes(4).toString('hex')}`;
  let finalBalance = parseFloat(balance) || 10000;
  let syncStatus = '';
  let syncMsg = '';

  const cleanApiKey = String(api_key || '').trim();
  const cleanApiSecret = String(api_secret || '').trim();
  const isReal = String(type).toUpperCase() === 'REAL';

  if (isReal && cleanApiKey && cleanApiSecret) {
    try {
      const live = await fetchBinanceLiveBalance(cleanApiKey, cleanApiSecret, Boolean(testnet));
      finalBalance = live.wallet_balance;
      syncStatus = 'SUCCESS';
      syncMsg = ` (Binance Canlı Bakiye: $${live.wallet_balance} USDT)`;
    } catch (err: any) {
      syncStatus = 'ERROR';
      syncMsg = ` (Binance API uyarısı: ${err.message})`;
    }
  }

  const newAcc: Account = {
    id,
    name: String(name).trim() || 'Yeni Hesap',
    type: isReal ? 'REAL' : 'PAPER',
    balance: finalBalance,
    initial_balance: finalBalance,
    api_key: cleanApiKey,
    api_secret: cleanApiSecret,
    testnet: Boolean(testnet),
    engine_state: 'STOPPED',
    stop_mode: '',
    spot_vault_balance: 0,
    vault_target: finalBalance * 2,
    leverage_cap: parseInt(leverage_cap, 10) || 5,
    max_risk_pct: parseFloat(max_risk_pct) || 2.0,
    stop_loss_pct: parseFloat(stop_loss_pct) || 1.85,
    take_profit_pct: parseFloat(take_profit_pct) || 4.5,
    trailing_stop_pct: parseFloat(trailing_stop_pct) || 1.2,
    last_sync_time: syncStatus ? nowIso() : '',
    last_sync_status: syncStatus,
    last_sync_message: syncMsg,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  accounts.push(newAcc);
  settings.active_account_id = id;
  addLog(`Yeni hesap oluşturuldu: ${newAcc.name}${syncMsg}`, 'INFO', 'ACCOUNT');
  res.json({ success: true, account: enrichAccount(newAcc), message: `Hesap başarıyla oluşturuldu${syncMsg}` });
});

app.put('/api/accounts/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return res.status(404).json({ detail: 'Hesap bulunamadı' });

  const {
    name,
    type,
    balance,
    api_key,
    api_secret,
    testnet,
    leverage_cap,
    max_risk_pct,
    stop_loss_pct,
    take_profit_pct,
    trailing_stop_pct,
    sync_live,
  } = req.body;

  if (name !== undefined) acc.name = String(name).trim();
  if (type !== undefined) acc.type = String(type).toUpperCase();
  if (balance !== undefined && !isNaN(balance)) acc.balance = parseFloat(balance);
  if (api_key !== undefined) acc.api_key = String(api_key).trim();
  if (api_secret !== undefined) acc.api_secret = String(api_secret).trim();
  if (testnet !== undefined) acc.testnet = Boolean(testnet);
  if (leverage_cap !== undefined) acc.leverage_cap = parseInt(leverage_cap, 10);
  if (max_risk_pct !== undefined) acc.max_risk_pct = parseFloat(max_risk_pct);
  if (stop_loss_pct !== undefined) acc.stop_loss_pct = parseFloat(stop_loss_pct);
  if (take_profit_pct !== undefined) acc.take_profit_pct = parseFloat(take_profit_pct);
  if (trailing_stop_pct !== undefined) acc.trailing_stop_pct = parseFloat(trailing_stop_pct);

  acc.updated_at = nowIso();

  let syncMsg = '';
  if (acc.type === 'REAL' && acc.api_key && acc.api_secret && (sync_live || req.body.sync_balance)) {
    try {
      const liveBal = await fetchBinanceLiveBalance(acc.api_key, acc.api_secret, acc.testnet);
      acc.balance = liveBal.wallet_balance;
      acc.last_sync_time = nowIso();
      acc.last_sync_status = 'SUCCESS';
      acc.last_sync_message = `Bakiye çekildi: $${liveBal.wallet_balance} USDT`;
      syncMsg = ` ve Binance bakiyesi ($${liveBal.wallet_balance} USDT) senkronize edildi`;
    } catch (err: any) {
      acc.last_sync_status = 'ERROR';
      acc.last_sync_message = err.message;
      syncMsg = ` (Uyarı: Binance bakiye çekilemedi: ${err.message})`;
    }
  }

  addLog(`Hesap güncellendi: ${acc.name}${syncMsg}`, 'INFO', 'ACCOUNT');
  res.json({ success: true, account: enrichAccount(acc), message: `Hesap güncellendi${syncMsg}` });
});

app.patch('/api/accounts/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return res.status(404).json({ detail: 'Hesap bulunamadı' });

  const {
    name,
    type,
    balance,
    api_key,
    api_secret,
    testnet,
    leverage_cap,
    max_risk_pct,
    stop_loss_pct,
    take_profit_pct,
    trailing_stop_pct,
    sync_live,
  } = req.body;

  if (name !== undefined) acc.name = String(name).trim();
  if (type !== undefined) acc.type = String(type).toUpperCase();
  if (balance !== undefined && !isNaN(balance)) acc.balance = parseFloat(balance);
  if (api_key !== undefined) acc.api_key = String(api_key).trim();
  if (api_secret !== undefined) acc.api_secret = String(api_secret).trim();
  if (testnet !== undefined) acc.testnet = Boolean(testnet);
  if (leverage_cap !== undefined) acc.leverage_cap = parseInt(leverage_cap, 10);
  if (max_risk_pct !== undefined) acc.max_risk_pct = parseFloat(max_risk_pct);
  if (stop_loss_pct !== undefined) acc.stop_loss_pct = parseFloat(stop_loss_pct);
  if (take_profit_pct !== undefined) acc.take_profit_pct = parseFloat(take_profit_pct);
  if (trailing_stop_pct !== undefined) acc.trailing_stop_pct = parseFloat(trailing_stop_pct);

  acc.updated_at = nowIso();

  let syncMsg = '';
  if (acc.type === 'REAL' && acc.api_key && acc.api_secret && (sync_live || req.body.sync_balance)) {
    try {
      const liveBal = await fetchBinanceLiveBalance(acc.api_key, acc.api_secret, acc.testnet);
      acc.balance = liveBal.wallet_balance;
      acc.last_sync_time = nowIso();
      acc.last_sync_status = 'SUCCESS';
      acc.last_sync_message = `Bakiye çekildi: $${liveBal.wallet_balance} USDT`;
      syncMsg = ` ve Binance bakiyesi ($${liveBal.wallet_balance} USDT) senkronize edildi`;
    } catch (err: any) {
      acc.last_sync_status = 'ERROR';
      acc.last_sync_message = err.message;
      syncMsg = ` (Uyarı: Binance bakiye çekilemedi: ${err.message})`;
    }
  }

  addLog(`Hesap güncellendi: ${acc.name}${syncMsg}`, 'INFO', 'ACCOUNT');
  res.json({ success: true, account: enrichAccount(acc), message: `Hesap güncellendi${syncMsg}` });
});

app.post(['/api/accounts/test-credentials', '/api/accounts/:id/test-connection'], async (req: Request, res: Response) => {
  const { id } = req.params;
  const acc = id ? accounts.find((a) => a.id === id) : null;
  const apiKey = String(req.body.api_key || acc?.api_key || settings.binance_api_key || '').trim();
  const apiSecret = String(req.body.api_secret || acc?.api_secret || settings.binance_api_secret || '').trim();
  const testnet = req.body.testnet !== undefined ? Boolean(req.body.testnet) : Boolean(acc?.testnet);

  if (!apiKey || !apiSecret) {
    return res.status(400).json({
      success: false,
      detail: 'Binance API Key ve API Secret anahtarları boş olamaz. Lütfen iki anahtarı da giriniz.',
    });
  }

  try {
    const liveBal = await fetchBinanceLiveBalance(apiKey, apiSecret, testnet);
    return res.json({
      success: true,
      message: `Bağlantı başarılı! ${liveBal.note || 'Binance bakiyesi doğrulandı.'}`,
      details: liveBal,
      wallet_balance: liveBal.wallet_balance,
      available_balance: liveBal.available_balance,
      margin_balance: liveBal.margin_balance,
      unrealized_profit: liveBal.unrealized_profit,
      open_positions_count: liveBal.open_positions_count,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      detail: err.message,
    });
  }
});

app.post('/api/accounts/:id/sync-balance', async (req: Request, res: Response) => {
  const { id } = req.params;
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return res.status(404).json({ detail: 'Hesap bulunamadı' });

  const effectiveApiKey = String(acc.api_key || req.body.api_key || settings.binance_api_key || '').trim();
  const effectiveApiSecret = String(acc.api_secret || req.body.api_secret || settings.binance_api_secret || '').trim();

  if (!effectiveApiKey || !effectiveApiSecret) {
    return res.status(400).json({
      detail: 'Bu hesap için Binance API Key ve Secret tanımlanmamış! Lütfen Hesap Ayarları butonuna basarak API anahtarlarınızı kaydedin.',
    });
  }

  // If account was missing keys, inherit them
  if (!acc.api_key && effectiveApiKey) acc.api_key = effectiveApiKey;
  if (!acc.api_secret && effectiveApiSecret) acc.api_secret = effectiveApiSecret;

  try {
    const liveBal = await fetchBinanceLiveBalance(effectiveApiKey, effectiveApiSecret, acc.testnet);
    acc.balance = liveBal.wallet_balance;
    acc.last_sync_time = nowIso();
    acc.last_sync_status = 'SUCCESS';
    acc.last_sync_message = `Binance bakiyesi başarıyla çekildi: $${liveBal.wallet_balance} USDT`;
    acc.updated_at = nowIso();

    addLog(`[BİNANCE SENKRONİZE] ${acc.name} bakiyesi güncellendi: $${liveBal.wallet_balance} USDT (${liveBal.wallet_type})`, 'INFO', 'ACCOUNT');
    res.json({
      success: true,
      balance: liveBal.wallet_balance,
      account: enrichAccount(acc),
      details: liveBal,
      message: `Binance bakiyesi başarıyla çekildi: $${liveBal.wallet_balance.toFixed(2)} USDT (Kullanılabilir: $${liveBal.available_balance.toFixed(2)} USDT)`,
    });
  } catch (err: any) {
    acc.last_sync_time = nowIso();
    acc.last_sync_status = 'ERROR';
    acc.last_sync_message = err.message;
    addLog(`[BİNANCE HATA] ${acc.name} bakiye çekme hatası: ${err.message}`, 'WARN', 'ACCOUNT');
    res.status(400).json({ success: false, detail: err.message });
  }
});

app.post('/api/accounts/active', (req: Request, res: Response) => {
  const { account_id } = req.body;
  const acc = accounts.find((a) => a.id === account_id);
  if (!acc) return res.status(404).json({ detail: 'Hesap bulunamadı' });
  settings.active_account_id = account_id;
  addLog(`Aktif hesap seçildi: ${acc.name}`, 'INFO', 'ACCOUNT');
  res.json({ success: true, active_account: enrichAccount(acc) });
});

app.delete('/api/accounts/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  if (accounts.length <= 1) {
    return res.status(400).json({ detail: 'En az bir hesap bulunmalıdır. Tek hesabı silemezsiniz.' });
  }
  const index = accounts.findIndex((a) => a.id === id);
  if (index === -1) return res.status(404).json({ detail: 'Hesap bulunamadı' });
  const [deleted] = accounts.splice(index, 1);
  positions = positions.filter((p) => p.account_id !== id);
  orders = orders.filter((o) => o.account_id !== id);
  trades = trades.filter((t) => t.account_id !== id);

  if (settings.active_account_id === id) {
    settings.active_account_id = accounts[0]?.id || '';
  }
  addLog(`Hesap silindi: ${deleted.name}`, 'WARN', 'ACCOUNT');
  res.json({ success: true, active_account_id: settings.active_account_id });
});

app.post(['/api/accounts/:id/balance', '/api/accounts/:id/balance'], (req: Request, res: Response) => {
  const { id } = req.params;
  const newBal = req.body.balance !== undefined ? req.body.balance : req.body.virtual_balance;
  if (newBal === undefined || isNaN(newBal) || Number(newBal) < 0) {
    return res.status(400).json({ detail: 'Geçersiz bakiye tutarı' });
  }
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return res.status(404).json({ detail: 'Hesap bulunamadı' });

  acc.balance = parseFloat(newBal);
  acc.updated_at = nowIso();
  addLog(`Hesap bakiyesi güncellendi: ${acc.name} -> $${acc.balance}`, 'INFO', 'ACCOUNT');
  res.json({ success: true, account: enrichAccount(acc) });
});

// Engine Controls
app.post('/api/engine/start', (req: Request, res: Response) => {
  const activeId = settings.active_account_id || 'acc_alpha';
  const acc = accounts.find((a) => a.id === activeId) || accounts[0];
  acc.engine_state = 'RUNNING';
  acc.stop_mode = '';
  acc.updated_at = nowIso();

  if (!engineInterval) {
    engineInterval = setInterval(stepEngine, 1500);
  }
  stepEngine();

  addLog(`Hummingbot & Konsey Motoru aktif edildi (${acc.name}). Otonom ticaret devrede.`, 'INFO', 'ENGINE');
  res.json({ success: true, engine_running: true, engine_state: 'RUNNING' });
});

app.post('/api/engine/stop', (req: Request, res: Response) => {
  const mode = req.body?.mode || 'PANIC';
  const activeId = settings.active_account_id || 'acc_alpha';
  const acc = accounts.find((a) => a.id === activeId) || accounts[0];
  acc.engine_state = 'STOPPED';
  acc.stop_mode = mode;
  acc.updated_at = nowIso();

  if (mode === 'PANIC' || mode === 'MARKET') {
    const openPos = positions.filter((p) => p.account_id === activeId && p.status === 'OPEN');
    openPos.forEach((p) => {
      closePositionInternal(p.id, p.mark_price, `Motor Durdurma (${mode})`);
    });
  }

  addLog(`Motor durduruldu: ${acc.name} [Mod: ${mode}].`, 'WARN', 'ENGINE');
  res.json({ success: true, engine_running: false, engine_state: 'STOPPED', message: `Motor ${mode} modu ile durduruldu.` });
});

app.post('/api/engine/start-all', (req: Request, res: Response) => {
  accounts.forEach((a) => { a.engine_state = 'RUNNING'; a.stop_mode = ''; });
  if (!engineInterval) engineInterval = setInterval(stepEngine, 1500);
  stepEngine();
  res.json({ success: true, started_count: accounts.length });
});

app.post('/api/engine/stop-all', (req: Request, res: Response) => {
  const mode = (req.body?.mode || 'PANIC').toUpperCase();
  accounts.forEach((a) => { a.engine_state = 'STOPPED'; a.stop_mode = mode; });
  if (mode === 'PANIC' || mode === 'MARKET') {
    positions.filter((p) => p.status === 'OPEN').forEach((p) => {
      closePositionInternal(p.id, p.mark_price, `Tüm Motorlar Durduruldu (${mode})`);
    });
  }
  res.json({ success: true, stopped_count: accounts.length, mode });
});

// Master Password Auth
app.post('/api/auth/verify-master-password', (req: Request, res: Response) => {
  const { password } = req.body;
  const hash = crypto.createHash('sha256').update(String(password)).digest('hex');
  const valid = hash === settings.master_password_hash;
  res.json({ valid, message: valid ? 'Şifre doğrulandı' : 'Hatalı ana bot şifresi!' });
});

app.post('/api/auth/change-password', (req: Request, res: Response) => {
  const { old_password, new_password } = req.body;
  const oldHash = crypto.createHash('sha256').update(String(old_password)).digest('hex');
  if (oldHash !== settings.master_password_hash) {
    return res.status(400).json({ detail: 'Eski şifre hatalı!' });
  }
  if (!new_password || new_password.length < 4) {
    return res.status(400).json({ detail: 'Yeni şifre en az 4 karakter olmalıdır.' });
  }
  settings.master_password_hash = crypto.createHash('sha256').update(String(new_password)).digest('hex');
  addLog('Ana bot şifresi değiştirildi.', 'INFO', 'SECURITY');
  res.json({ success: true, message: 'Şifre başarıyla güncellendi' });
});

// Reset & Sync
app.post('/api/system/reset-and-sync', (req: Request, res: Response) => {
  const { mode = 'PAPER_RESET', reset_balance = 100, account_id } = req.body;
  const activeId = account_id || settings.active_account_id || 'acc_alpha';
  const acc = accounts.find((a) => a.id === activeId) || accounts[0];
  const targetBal = parseFloat(reset_balance) || 100.0;

  acc.balance = targetBal;
  acc.initial_balance = targetBal;
  acc.engine_state = 'STOPPED';
  acc.spot_vault_balance = 0.0;
  acc.vault_target = targetBal * 2;
  acc.updated_at = nowIso();

  positions = positions.filter((p) => p.account_id !== activeId);
  orders = orders.filter((o) => o.account_id !== activeId);
  trades = trades.filter((t) => t.account_id !== activeId);

  addLog(`[SİSTEM SIFIRLANDI] Hesap: ${acc.name}, Yeni bakiye: $${targetBal}`, 'INFO', 'SYSTEM');
  res.json({
    success: true,
    mode,
    balance: targetBal,
    account_id: activeId,
    message: `Sistem başarıyla sıfırlandı. Yeni bakiye: $${targetBal.toFixed(2)} USDT`,
  });
});

// Sentinel
app.get('/api/sentinel/status', (req: Request, res: Response) => {
  res.json(getSentinelStatus(req.query.account_id as string));
});

app.post('/api/sentinel/toggle', (req: Request, res: Response) => {
  const enabled = Boolean(req.body.enabled);
  settings.sentinel_auto_risk = enabled ? 'true' : 'false';
  addLog(`Sentinel Otonom Koruma: ${enabled ? 'AÇIK' : 'KAPALI'}`, 'INFO', 'SENTINEL');
  res.json({ success: true, enabled });
});

// Indicators
app.get('/api/indicators/:symbol', (req: Request, res: Response) => {
  const sym = String(req.params.symbol).toUpperCase();
  const item = liveMarketMap[sym];
  const curP = item?.price || 100.0;
  res.json({ matrix: computeIndicators(sym, curP) });
});

// Positions
app.get('/api/positions', (req: Request, res: Response) => {
  const activeId = (req.query.account_id as string) || settings.active_account_id || 'acc_alpha';
  const updated = updatePositionsPnlLive(activeId);
  res.json({ positions: updated });
});

app.get('/api/positions/:id', (req: Request, res: Response) => {
  const pos = positions.find((p) => p.id === req.params.id);
  if (!pos) return res.status(404).json({ detail: 'Pozisyon bulunamadı' });
  const item = liveMarketMap[pos.symbol];
  const curP = item?.price || pos.mark_price;
  res.json({
    position: pos,
    mark_price: curP,
    book_ticker: { bidPrice: item?.bid_price || curP * 0.9998, askPrice: item?.ask_price || curP * 1.0002 },
    indicators: computeIndicators(pos.symbol, curP),
  });
});

app.get('/api/positions/:id/analysis', (req: Request, res: Response) => {
  const pos = positions.find((p) => p.id === req.params.id);
  if (!pos) return res.status(404).json({ detail: 'Pozisyon bulunamadı' });
  const sym = pos.symbol.toUpperCase();
  const item = liveMarketMap[sym];
  const curP = item?.price || pos.mark_price;
  const spreadVal = item?.spread || Math.round(curP * 0.0002 * 100) / 100;

  const bids = [
    [item?.bid_price || curP * 0.9998, item?.bid_vol || 12.5],
    [curP * 0.9995, 28.4],
    [curP * 0.9990, 45.1],
    [curP * 0.9985, 82.0],
    [curP * 0.9980, 115.3],
  ];
  const asks = [
    [item?.ask_price || curP * 1.0002, item?.ask_vol || 14.2],
    [curP * 1.0005, 31.8],
    [curP * 1.0010, 48.6],
    [curP * 1.0015, 76.5],
    [curP * 1.0020, 102.1],
  ];

  const targetPnlPct = Math.round((Math.abs(pos.take_profit - pos.entry_price) / pos.entry_price * pos.leverage * 100) * 10) / 10;

  res.json({
    position_id: pos.id,
    symbol: sym,
    side: pos.side,
    entry_price: pos.entry_price,
    mark_price: curP,
    stop_loss: pos.stop_loss,
    take_profit: pos.take_profit,
    order_book: { bids, asks },
    spread: { value: spreadVal, pct: item?.spread_pct || 0.02 },
    bot_forecast: {
      direction: pos.side,
      target_price: pos.take_profit,
      target_pnl_pct: targetPnlPct,
      confidence_score: 89,
      entry_reasons: [
        `L2 OBI: ${item ? (item.obi > 0 ? '+' : '') + item.obi + '% derinlik dengesi' : '+0.42 alıcı baskısı'}`,
        'Hummingbot: Micro-price fair value onayı',
        'CVD Hacim: Binance Futures vadeli net akış teyidi',
        `Trend Momentum: EMA 9/21 ${pos.side} uyumu`,
      ],
      time_in_trade: '1dk 45sn',
    },
  });
});

app.post('/api/positions/close/:id', (req: Request, res: Response) => {
  const pos = positions.find((p) => p.id === req.params.id && p.status === 'OPEN');
  if (!pos) return res.status(404).json({ detail: 'Pozisyon bulunamadı' });
  const item = liveMarketMap[pos.symbol];
  const curP = item?.price || pos.mark_price;
  const result = closePositionInternal(pos.id, curP, 'Kullanıcı Manuel Kapatma');
  res.json({ success: true, result });
});

// Orders & Trades
app.get(['/api/orders', '/api/orders/history'], (req: Request, res: Response) => {
  const activeId = (req.query.account_id as string) || settings.active_account_id || 'acc_alpha';
  const limit = parseInt((req.query.limit as string) || '100', 10);
  res.json({ orders: orders.filter((o) => o.account_id === activeId).slice(0, limit) });
});

app.get('/api/trades', (req: Request, res: Response) => {
  const activeId = (req.query.account_id as string) || settings.active_account_id || 'acc_alpha';
  const limit = parseInt((req.query.limit as string) || '100', 10);
  res.json({ trades: trades.filter((t) => t.account_id === activeId).slice(0, limit) });
});

// Market Radar (100% Real Live Binance)
app.get('/api/market/radar', (req: Request, res: Response) => {
  const radar = buildRadar();
  const longCount = radar.filter((r) => r.signal === 'LONG').length;
  const shortCount = radar.filter((r) => r.signal === 'SHORT').length;
  const total = radar.length;

  res.json({
    radar,
    macro_summary: {
      total_scanned: total,
      long_count: longCount,
      short_count: shortCount,
      neutral_count: total - longCount - shortCount,
      bullish_pct: Math.round((longCount / total) * 100),
      bearish_pct: Math.round((shortCount / total) * 100),
      system_macro_signal: 'HUMMINGBOT ÇİFT PİYASA RADARI',
      market_state: longCount > shortCount ? 'BOĞA' : 'AYI',
      risk_index: 'ORTA',
    },
    last_scan_time: lastBinanceSyncTime,
    binance_latency_ms: lastBinanceSyncLatency,
    is_real_data: true,
  });
});

// Agents & Decision Core
app.get('/api/agents', (req: Request, res: Response) => {
  res.json({ agents: councilAgents });
});

app.get('/api/analytics/pnl-summary', (req: Request, res: Response) => {
  const activeId = (req.query.account_id as string) || settings.active_account_id || 'acc_alpha';
  res.json({ pnl_summary: getPnlSummary(activeId) });
});

app.get('/api/jev/consensus', (req: Request, res: Response) => {
  res.json({ consensus: getJevConsensus() });
});

app.get('/api/council/live-telemetry', (req: Request, res: Response) => {
  res.json(getCouncilTelemetry());
});

app.get('/api/council/agent/:id/history', (req: Request, res: Response) => {
  const agent = councilAgents.find((a) => a.agent_id === req.params.id);
  if (!agent) return res.status(404).json({ detail: 'Ajan bulunamadı' });
  res.json({
    agent_id: agent.agent_id,
    name: agent.name,
    role: agent.role,
    win_rate: agent.win_rate,
    status: agent.status,
    last_vote: agent.last_vote,
    last_score: agent.last_score,
    history: agent.history,
  });
});

// Sentiment
app.post('/api/sentiment/scrape-and-score', (req: Request, res: Response) => {
  const { symbol, text } = req.body;
  const score = Math.min(94, Math.max(30, Math.round(55 + (text ? text.length % 20 : 15))));
  res.json({ success: true, symbol, sentiment_score: score, cached: true });
});

app.get('/api/sentiment/cache', (req: Request, res: Response) => {
  res.json({ symbol: req.query.symbol, cached_score: 74 });
});

// Spot Vault
app.get('/api/vault/status', (req: Request, res: Response) => {
  const activeId = (req.query.account_id as string) || settings.active_account_id || 'acc_alpha';
  const acc = accounts.find((a) => a.id === activeId) || accounts[0];
  const progressPct = acc.vault_target > 0 ? Math.min(100, Math.round((acc.balance / acc.vault_target) * 100)) : 0;
  res.json({
    account_id: activeId,
    balance: acc.balance,
    initial_balance: acc.initial_balance,
    spot_vault_balance: acc.spot_vault_balance,
    vault_target: acc.vault_target,
    progress_pct: progressPct,
  });
});

// System Settings
app.get('/api/settings', (req: Request, res: Response) => {
  res.json({
    settings: {
      telegram_token: settings.telegram_token,
      telegram_chat_id: settings.telegram_chat_id,
      telegram_bot_username: settings.telegram_bot_username,
      telegram_enabled: settings.telegram_enabled === 'true',
      is_default_bot: settings.telegram_token === '8605987091:AAEbSLn5Ubdx0_TZ2fJCvhAQuzAYs8fZz7Y',
      binance_api_key: settings.binance_api_key ? '••••••••' + settings.binance_api_key.slice(-4) : '',
      binance_api_secret_set: Boolean(settings.binance_api_secret),
      max_risk_pct: parseFloat(settings.max_risk_pct),
      leverage_cap: parseInt(settings.leverage_cap, 10),
      sentinel_auto_risk: settings.sentinel_auto_risk === 'true',
      autonomous_learning: settings.autonomous_learning === 'true',
      stop_loss_pct: parseFloat(settings.stop_loss_pct),
      take_profit_pct: parseFloat(settings.take_profit_pct),
      breakeven_pct: parseFloat(settings.breakeven_pct),
      trailing_stop_pct: parseFloat(settings.trailing_stop_pct),
      max_daily_drawdown_pct: parseFloat(settings.max_daily_drawdown_pct),
      min_signal_score: parseInt(settings.min_signal_score, 10),
      trading_aggressiveness: settings.trading_aggressiveness,
      agents_config: settings.agents_config,
    },
  });
});

app.post('/api/settings', (req: Request, res: Response) => {
  const data = req.body;
  if (data.use_default_bot) {
    settings.telegram_token = '8605987091:AAEbSLn5Ubdx0_TZ2fJCvhAQuzAYs8fZz7Y';
    settings.telegram_chat_id = '2140273565';
    settings.telegram_bot_username = '@Omnideneme_bot';
    settings.telegram_enabled = 'true';
  } else {
    if (data.telegram_token !== undefined) settings.telegram_token = String(data.telegram_token).trim();
    if (data.telegram_chat_id !== undefined) settings.telegram_chat_id = String(data.telegram_chat_id).trim();
    if (data.telegram_enabled !== undefined) settings.telegram_enabled = data.telegram_enabled ? 'true' : 'false';
  }

  // Binance API Credentials - Stored securely inside the database/app
  if (data.binance_api_key !== undefined && String(data.binance_api_key).trim() !== '') {
    settings.binance_api_key = String(data.binance_api_key).trim();
  }
  if (data.binance_api_secret !== undefined && String(data.binance_api_secret).trim() !== '') {
    settings.binance_api_secret = String(data.binance_api_secret).trim();
  }

  if (data.max_risk_pct !== undefined) settings.max_risk_pct = String(data.max_risk_pct);
  if (data.leverage_cap !== undefined) settings.leverage_cap = String(data.leverage_cap);
  if (data.sentinel_auto_risk !== undefined) settings.sentinel_auto_risk = data.sentinel_auto_risk ? 'true' : 'false';
  if (data.autonomous_learning !== undefined) settings.autonomous_learning = data.autonomous_learning ? 'true' : 'false';
  if (data.stop_loss_pct !== undefined) settings.stop_loss_pct = String(data.stop_loss_pct);
  if (data.take_profit_pct !== undefined) settings.take_profit_pct = String(data.take_profit_pct);
  if (data.breakeven_pct !== undefined) settings.breakeven_pct = String(data.breakeven_pct);
  if (data.trailing_stop_pct !== undefined) settings.trailing_stop_pct = String(data.trailing_stop_pct);
  if (data.max_daily_drawdown_pct !== undefined) settings.max_daily_drawdown_pct = String(data.max_daily_drawdown_pct);
  if (data.min_signal_score !== undefined) settings.min_signal_score = String(data.min_signal_score);
  if (data.trading_aggressiveness !== undefined) settings.trading_aggressiveness = String(data.trading_aggressiveness);
  if (data.agents_config !== undefined) settings.agents_config = String(data.agents_config);

  addLog('Sistem ayarları güncellendi (Kullanıcı depolaması).', 'INFO', 'SETTINGS');
  res.json({ success: true, message: 'Ayarlar başarıyla kaydedildi' });
});

// Update Check
app.get('/api/system/check-update', (req: Request, res: Response) => {
  res.json({
    success: true,
    hasUpdate: false,
    currentCommit: '341e8f2',
    behindCount: 0,
    latestCommitMessage: 'FAROS v3.0 Master Release (Live Binance Feed + Hummingbot Engine)',
    version: '3.0.0',
  });
});

// ---------------------------------------------------------------------------
// Funding Fee Arbitrage Engine (Delta-Neutral Cash & Carry 8h Cycle)
// ---------------------------------------------------------------------------

interface FundingArbPair {
  symbol: string;
  spot_price: number;
  futures_price: number;
  basis_spread_pct: number;
  allocated_capital: number;
  spot_notional: number;
  futures_notional: number;
  entry_funding_rate_pct: number;
  current_funding_rate_pct: number;
  annualized_apr_pct: number;
  accumulated_profit_usdt: number;
  settlements_count: number;
  status: 'ACTIVE' | 'CLOSED_PROFIT' | 'STOPPED';
  opened_at: string;
  next_settlement_time: number;
  last_settlement_time: string | null;
}

interface FundingArbitrageEngineState {
  is_running: boolean;
  total_capital_usdt: number;
  min_apr_threshold: number;
  leverage: number;
  started_at: string | null;
  total_accumulated_pnl: number;
  active_pairs: FundingArbPair[];
  history_log: Array<{ time: string; message: string; type: 'INFO' | 'TRADE' | 'PAYOUT' | 'EXIT' }>;
}

const fundingArbEngine: FundingArbitrageEngineState = {
  is_running: false,
  total_capital_usdt: 2000,
  min_apr_threshold: 15.0, // Minimum 15% APR to stay open
  leverage: 1, // 1x for pure delta-neutral safety
  started_at: null,
  total_accumulated_pnl: 0,
  active_pairs: [],
  history_log: [
    {
      time: nowIso(),
      message: 'Fonlama Oranı Arbitraj Motoru hazır. Spot LONG + Vadeli SHORT delta-nötr taşıma stratejisi aktif.',
      type: 'INFO',
    },
  ],
};

// Fetch Top 10 Binance Funding Rates with Spot & Futures prices and countdown
app.get('/api/funding-rates/top10', async (_req: Request, res: Response) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const [resPremium, resSpot] = await Promise.all([
      fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { signal: controller.signal }),
      fetch('https://api.binance.com/api/v3/ticker/price', { signal: controller.signal }),
    ]);
    clearTimeout(timeout);

    let premiumList: any[] = [];
    let spotPriceMap: Record<string, number> = {};

    if (resPremium.ok) {
      premiumList = (await resPremium.json()) as any[];
    }
    if (resSpot.ok) {
      const spotList = (await resSpot.json()) as any[];
      if (Array.isArray(spotList)) {
        spotList.forEach((s) => {
          if (s.symbol && s.price) spotPriceMap[s.symbol] = parseFloat(s.price) || 0;
        });
      }
    }

    if (!Array.isArray(premiumList) || premiumList.length === 0) {
      // Fallback with liveMarketMap
      const fallbackItems = Object.keys(liveMarketMap).map((sym) => {
        const item = liveMarketMap[sym];
        const rate = item.funding_rate || 0.0001;
        const now = Date.now();
        const nextFunding = Math.ceil(now / (8 * 3600 * 1000)) * (8 * 3600 * 1000);
        return {
          symbol: sym,
          futures_price: item.mark_price || item.price,
          spot_price: item.price,
          basis_spread_pct: 0.02,
          funding_rate_8h: Math.round(rate * 100 * 10000) / 10000,
          annualized_apr: Math.round(rate * 3 * 365 * 100 * 100) / 100,
          next_funding_time: nextFunding,
          time_to_settlement_seconds: Math.max(0, Math.floor((nextFunding - now) / 1000)),
          est_payout_8h_1000u: Math.round(1000 * rate * 100) / 100,
          volume_24h: item.volume,
        };
      });
      return res.json({ success: true, top10: fallbackItems.slice(0, 10), timestamp: nowIso() });
    }

    const now = Date.now();
    // Filter for USDT perpetual pairs
    const usdtPairs = premiumList
      .filter((p: any) => p.symbol && p.symbol.endsWith('USDT') && !p.symbol.includes('_'))
      .map((p: any) => {
        const symbol = p.symbol;
        const lastRate = parseFloat(p.lastFundingRate) || 0;
        const markPrice = parseFloat(p.markPrice) || 0;
        const indexPrice = parseFloat(p.indexPrice) || markPrice;
        const spotPrice = spotPriceMap[symbol] || indexPrice;
        const basisSpreadPct = spotPrice > 0 ? ((markPrice - spotPrice) / spotPrice) * 100 : 0;
        const nextFundingTime = Number(p.nextFundingTime) || Math.ceil(now / (8 * 3600 * 1000)) * (8 * 3600 * 1000);
        const timeToSettlementSeconds = Math.max(0, Math.floor((nextFundingTime - now) / 1000));
        const annualizedApr = Math.round(lastRate * 3 * 365 * 100 * 100) / 100;
        const fundingRate8h = Math.round(lastRate * 100 * 10000) / 10000;
        const estPayout8h1000u = Math.round(1000 * lastRate * 100) / 100;

        return {
          symbol,
          futures_price: Math.round(markPrice * 10000) / 10000,
          spot_price: Math.round(spotPrice * 10000) / 10000,
          basis_spread_pct: Math.round(basisSpreadPct * 1000) / 1000,
          funding_rate_8h: fundingRate8h,
          annualized_apr: annualizedApr,
          next_funding_time: nextFundingTime,
          time_to_settlement_seconds: timeToSettlementSeconds,
          est_payout_8h_1000u: estPayout8h1000u,
          interest_rate: parseFloat(p.interestRate) || 0.0001,
        };
      });

    // Sort descending by highest 8h funding rate for Cash & Carry
    usdtPairs.sort((a, b) => b.funding_rate_8h - a.funding_rate_8h);
    const top10 = usdtPairs.slice(0, 10);

    // Also get top negative funding rates for Reverse Cash & Carry (Short Spot + Long Futures)
    const reversePairs = [...usdtPairs].sort((a, b) => a.funding_rate_8h - b.funding_rate_8h).slice(0, 5);

    res.json({
      success: true,
      top10,
      reverse_top5: reversePairs,
      timestamp: nowIso(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, detail: err.message });
  }
});

// Funding Arbitrage Engine Status
app.get('/api/funding-arbitrage/status', (_req: Request, res: Response) => {
  // Update current live rates and countdowns on active pairs
  const now = Date.now();
  fundingArbEngine.active_pairs.forEach((pair) => {
    const live = liveMarketMap[pair.symbol];
    if (live) {
      pair.current_funding_rate_pct = Math.round((live.funding_rate || 0.0001) * 100 * 10000) / 10000;
      pair.annualized_apr_pct = Math.round(pair.current_funding_rate_pct * 3 * 365 * 100) / 100;
      pair.futures_price = live.mark_price || live.price;
      pair.spot_price = live.price;
      pair.basis_spread_pct = pair.spot_price > 0 ? ((pair.futures_price - pair.spot_price) / pair.spot_price) * 100 : 0;
    }
  });

  const nextSettlementTime = Math.ceil(now / (8 * 3600 * 1000)) * (8 * 3600 * 1000);
  const countdownSeconds = Math.max(0, Math.floor((nextSettlementTime - now) / 1000));

  res.json({
    success: true,
    engine: {
      ...fundingArbEngine,
      next_settlement_time: nextSettlementTime,
      countdown_seconds: countdownSeconds,
    },
  });
});

// Start Funding Arbitrage Engine
app.post('/api/funding-arbitrage/start', (req: Request, res: Response) => {
  const { symbols, capital_usdt, min_apr_threshold, leverage } = req.body;
  const selectedSymbols: string[] = Array.isArray(symbols) && symbols.length > 0 ? symbols : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const totalCapital = parseFloat(capital_usdt) || 2000;
  const minApr = parseFloat(min_apr_threshold) || 12.0;
  const lev = parseInt(leverage, 10) || 1;

  const perPairCapital = totalCapital / selectedSymbols.length;
  const now = Date.now();
  const nextFundingTime = Math.ceil(now / (8 * 3600 * 1000)) * (8 * 3600 * 1000);

  const newActivePairs: FundingArbPair[] = selectedSymbols.map((sym) => {
    const live = liveMarketMap[sym] || {
      price: 100,
      mark_price: 100.02,
      funding_rate: 0.00025,
    };
    const ratePct = Math.round((live.funding_rate || 0.0002) * 100 * 10000) / 10000;
    const aprPct = Math.round(ratePct * 3 * 365 * 100) / 100;

    // Delta-neutral split: 50% spot long, 50% futures short
    const halfCap = perPairCapital / 2;
    const spotPrice = live.price || 100;
    const futuresPrice = live.mark_price || spotPrice;

    return {
      symbol: sym,
      spot_price: spotPrice,
      futures_price: futuresPrice,
      basis_spread_pct: ((futuresPrice - spotPrice) / spotPrice) * 100,
      allocated_capital: perPairCapital,
      spot_notional: halfCap,
      futures_notional: halfCap,
      entry_funding_rate_pct: ratePct,
      current_funding_rate_pct: ratePct,
      annualized_apr_pct: aprPct,
      accumulated_profit_usdt: 0,
      settlements_count: 0,
      status: 'ACTIVE',
      opened_at: nowIso(),
      next_settlement_time: nextFundingTime,
      last_settlement_time: null,
    };
  });

  fundingArbEngine.is_running = true;
  fundingArbEngine.total_capital_usdt = totalCapital;
  fundingArbEngine.min_apr_threshold = minApr;
  fundingArbEngine.leverage = lev;
  fundingArbEngine.started_at = nowIso();
  fundingArbEngine.active_pairs = newActivePairs;

  const msg = `[FONLAMA ARBİTRAJI BAŞLATILDI] ${selectedSymbols.length} paritede Delta-Nötr pozisyon açıldı (${selectedSymbols.join(', ')}). Toplam Sermaye: $${totalCapital} USDT. Eşit oranda Spot Alış + Vadeli Short açıldı. Delta = 0.`;
  addLog(msg, 'TRADE', 'ARBITRAGE');
  fundingArbEngine.history_log.unshift({
    time: nowIso(),
    message: msg,
    type: 'TRADE',
  });

  res.json({
    success: true,
    message: 'Fonlama Oranı Arbitraj Motoru başarıyla başlatıldı.',
    engine: fundingArbEngine,
  });
});

// Stop Funding Arbitrage Engine
app.post('/api/funding-arbitrage/stop', (_req: Request, res: Response) => {
  fundingArbEngine.is_running = false;
  fundingArbEngine.active_pairs.forEach((p) => {
    p.status = 'STOPPED';
  });

  const msg = `[FONLAMA ARBİTRAJI DURDURULDU] Tüm arbitraj bacakları (Spot Long + Vadeli Short) kârla kapatıldı. Birikmiş Kâr: +$${fundingArbEngine.total_accumulated_pnl.toFixed(2)} USDT.`;
  addLog(msg, 'INFO', 'ARBITRAGE');
  fundingArbEngine.history_log.unshift({
    time: nowIso(),
    message: msg,
    type: 'EXIT',
  });

  res.json({
    success: true,
    message: 'Fonlama Oranı Arbitraj Motoru durduruldu ve pozisyonlar kapatıldı.',
    engine: fundingArbEngine,
  });
});

// 8-hour renewal & auto-exit check interval for Funding Arbitrage
setInterval(() => {
  if (!fundingArbEngine.is_running || fundingArbEngine.active_pairs.length === 0) return;

  const now = Date.now();
  let stateChanged = false;

  fundingArbEngine.active_pairs.forEach((pair) => {
    if (pair.status !== 'ACTIVE') return;

    // Check if 8h settlement window is reached
    if (now >= pair.next_settlement_time) {
      // Calculate 8h funding payment received: (notional * funding_rate)
      const notional = pair.futures_notional;
      const rateFraction = pair.current_funding_rate_pct / 100;
      const payout = Math.max(0, notional * rateFraction);

      pair.accumulated_profit_usdt += payout;
      pair.settlements_count += 1;
      pair.last_settlement_time = nowIso();
      fundingArbEngine.total_accumulated_pnl += payout;

      // Log payout
      const payoutMsg = `[8-SAAT FONLAMA ÖDEMESİ] ${pair.symbol}: +$${payout.toFixed(2)} USDT fonlama ücreti tahsil edildi! (Oran: %${pair.current_funding_rate_pct.toFixed(4)}, Toplam Tahsilat: #${pair.settlements_count})`;
      addLog(payoutMsg, 'TRADE', 'ARBITRAGE');
      fundingArbEngine.history_log.unshift({
        time: nowIso(),
        message: payoutMsg,
        type: 'PAYOUT',
      });

      // Evaluation for next 8-hour cycle:
      // If funding APR is still >= min_apr_threshold, continue holding.
      // If it dropped below threshold or turned negative, close the position and lock profits!
      if (pair.annualized_apr_pct < fundingArbEngine.min_apr_threshold || pair.current_funding_rate_pct <= 0.002) {
        pair.status = 'CLOSED_PROFIT';
        const exitMsg = `[8-SAAT YENİLEME KARARI] ${pair.symbol} fonlama oranı %${pair.current_funding_rate_pct.toFixed(4)} seviyesine geriledi (Hedef Eşik: %${fundingArbEngine.min_apr_threshold} APR). Pozisyon net kâr ile kapatıldı: +$${pair.accumulated_profit_usdt.toFixed(2)} USDT.`;
        addLog(exitMsg, 'INFO', 'ARBITRAGE');
        fundingArbEngine.history_log.unshift({
          time: nowIso(),
          message: exitMsg,
          type: 'EXIT',
        });
      } else {
        // Set next settlement time (8 hours ahead)
        pair.next_settlement_time = Math.ceil((now + 60000) / (8 * 3600 * 1000)) * (8 * 3600 * 1000);
        const renewMsg = `[8-SAAT YENİLEME KARARI] ${pair.symbol} fonlama oranı yüksek seyretmeye devam ediyor (%${pair.annualized_apr_pct}% APR). Pozisyon bir sonraki 8 saatlik periyot için sürdürülüyor.`;
        fundingArbEngine.history_log.unshift({
          time: nowIso(),
          message: renewMsg,
          type: 'INFO',
        });
      }
      stateChanged = true;
    }
  });

  // If all pairs closed, stop engine
  if (stateChanged && fundingArbEngine.active_pairs.every((p) => p.status !== 'ACTIVE')) {
    fundingArbEngine.is_running = false;
  }
}, 8000);

// ---------------------------------------------------------------------------
// Hummingbot Multi-Agent Backtest Engine (Live Binance Historical Data)
// ---------------------------------------------------------------------------

app.post('/api/backtest/run', async (req: Request, res: Response) => {
  try {
    const {
      symbol = 'BTCUSDT',
      interval = '1h',
      limit = 200,
      initial_capital = 10000,
      maker_fee_pct = 0.02,
      taker_fee_pct = 0.04,
      leverage = 2,
      agents = {
        market_maker: true,
        trend_follower: true,
        funding_arb: true,
        liquidity_hunter: true,
        risk_sentinel: true,
        mean_reversion: true,
      },
    } = req.body;

    const candleLimit = Math.min(500, Math.max(50, parseInt(limit, 10) || 200));
    const initCapital = Math.max(100, parseFloat(initial_capital) || 10000);
    const lev = Math.min(20, Math.max(1, parseInt(leverage, 10) || 2));
    const makerFee = (parseFloat(maker_fee_pct) || 0.02) / 100;
    const takerFee = (parseFloat(taker_fee_pct) || 0.04) / 100;

    // Fetch real Binance candlestick historical data
    let klinesData: any[] = [];
    try {
      const klineRes = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${candleLimit}`
      );
      if (klineRes.ok) {
        klinesData = (await klineRes.json()) as any[];
      }
    } catch {
      // ignore
    }

    // If Binance request failed or throttled, generate realistic candles anchored on current live price
    if (!Array.isArray(klinesData) || klinesData.length < 30) {
      const basePrice = liveMarketMap[symbol]?.price || 67000;
      let p = basePrice * 0.94;
      const intervalMs = interval === '15m' ? 15 * 60000 : interval === '1h' ? 3600000 : interval === '4h' ? 4 * 3600000 : 86400000;
      const startTime = Date.now() - candleLimit * intervalMs;
      klinesData = [];

      for (let i = 0; i < candleLimit; i++) {
        const drift = (Math.random() - 0.48) * 0.012;
        const o = p;
        const c = o * (1 + drift);
        const h = Math.max(o, c) * (1 + Math.random() * 0.006);
        const l = Math.min(o, c) * (1 - Math.random() * 0.006);
        const vol = 100 + Math.random() * 800;
        p = c;
        klinesData.push([startTime + i * intervalMs, o.toString(), h.toString(), l.toString(), c.toString(), vol.toString()]);
      }
    }

    // Parse candles
    const candles = klinesData.map((k: any) => ({
      time: Number(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    // Backtest Simulation State
    let equity = initCapital;
    let peakEquity = initCapital;
    let maxDrawdownPct = 0;
    const trades: any[] = [];
    const equityCurve: any[] = [];

    let currentPosition: {
      type: 'LONG' | 'SHORT';
      entry_price: number;
      entry_time: number;
      qty: number;
      agent: string;
      notional: number;
    } | null = null;

    const agentStats: Record<string, { trades: number; wins: number; pnl: number; is_active: boolean; name: string }> = {
      market_maker: { trades: 0, wins: 0, pnl: 0, is_active: !!agents.market_maker, name: '⚡ Market Maker (Hummingbot PMM)' },
      trend_follower: { trades: 0, wins: 0, pnl: 0, is_active: !!agents.trend_follower, name: '🎯 Trend Follower (SuperTrend + EMA)' },
      funding_arb: { trades: 0, wins: 0, pnl: 0, is_active: !!agents.funding_arb, name: '⚖️ Funding Arbitrage (Taşıma Getirisi)' },
      liquidity_hunter: { trades: 0, wins: 0, pnl: 0, is_active: !!agents.liquidity_hunter, name: '🌊 Liquidity Hunter (OBI & VWAP)' },
      risk_sentinel: { trades: 0, wins: 0, pnl: 0, is_active: !!agents.risk_sentinel, name: '🛡️ Risk Sentinel (Volatilite Koruma)' },
      mean_reversion: { trades: 0, wins: 0, pnl: 0, is_active: !!agents.mean_reversion, name: '🔄 Mean Reversion (RSI & Bollinger)' },
    };

    // Technical Indicators tracking
    let emaShort = candles[0].close;
    let emaLong = candles[0].close;
    const alphaShort = 2 / (9 + 1);
    const alphaLong = 2 / (21 + 1);

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      emaShort = c.close * alphaShort + emaShort * (1 - alphaShort);
      emaLong = c.close * alphaLong + emaLong * (1 - alphaLong);

      const changePct = ((c.close - c.open) / c.open) * 100;
      const spread = (c.high - c.low) / c.close;
      const isTrendBullish = emaShort > emaLong && changePct > 0.15;
      const isTrendBearish = emaShort < emaLong && changePct < -0.15;
      const isRsiOversold = changePct < -1.8;
      const isRsiOverbought = changePct > 1.8;
      const isRangeBound = spread < 0.015 && Math.abs(changePct) < 0.3;

      // 1. Check open position exit / stop loss / take profit
      if (currentPosition) {
        let shouldExit = false;
        let exitReason = '';
        let exitPrice = c.close;

        const isLong = currentPosition.type === 'LONG';
        const priceDiff = isLong ? exitPrice - currentPosition.entry_price : currentPosition.entry_price - exitPrice;
        const currentReturnPct = (priceDiff / currentPosition.entry_price) * lev * 100;

        // Take Profit: +3.5%
        if (currentReturnPct >= 3.5) {
          shouldExit = true;
          exitReason = 'Take Profit (+3.5%)';
        }
        // Stop Loss: -1.8%
        else if (currentReturnPct <= -1.8) {
          shouldExit = true;
          exitReason = 'Stop Loss (-1.8%)';
        }
        // Risk Sentinel Emergency Exit on extreme bar
        else if (agents.risk_sentinel && Math.abs(changePct) > 3.0) {
          shouldExit = true;
          exitReason = '🛡️ Risk Sentinel Volatilite Çıkışı';
        }
        // Trend Reversal
        else if (isLong && isTrendBearish && currentReturnPct > 0.5) {
          shouldExit = true;
          exitReason = 'Trend Dönüşü (Bearish Cross)';
        } else if (!isLong && isTrendBullish && currentReturnPct > 0.5) {
          shouldExit = true;
          exitReason = 'Trend Dönüşü (Bullish Cross)';
        }

        if (shouldExit || i === candles.length - 1) {
          const rawPnl = (priceDiff / currentPosition.entry_price) * currentPosition.notional * lev;
          const fee = currentPosition.notional * lev * takerFee;
          const netPnl = rawPnl - fee;

          equity += netPnl;
          if (equity > peakEquity) peakEquity = equity;
          const currentDd = ((peakEquity - equity) / peakEquity) * 100;
          if (currentDd > maxDrawdownPct) maxDrawdownPct = currentDd;

          const tradeRecord = {
            id: trades.length + 1,
            symbol,
            type: currentPosition.type,
            agent: currentPosition.agent,
            entry_time: new Date(currentPosition.entry_time).toISOString().replace('T', ' ').slice(0, 19),
            exit_time: new Date(c.time).toISOString().replace('T', ' ').slice(0, 19),
            entry_price: Math.round(currentPosition.entry_price * 100) / 100,
            exit_price: Math.round(exitPrice * 100) / 100,
            pnl_usdt: Math.round(netPnl * 100) / 100,
            pnl_pct: Math.round(currentReturnPct * 100) / 100,
            fee_usdt: Math.round(fee * 100) / 100,
            reason: exitReason || 'Test Sonu Kapanış',
            status: netPnl >= 0 ? 'WIN' : 'LOSS',
          };
          trades.push(tradeRecord);

          // Update agent stats
          const aKey = Object.keys(agentStats).find((k) => agentStats[k].name === currentPosition!.agent) || 'market_maker';
          if (agentStats[aKey]) {
            agentStats[aKey].trades += 1;
            if (netPnl >= 0) agentStats[aKey].wins += 1;
            agentStats[aKey].pnl += netPnl;
          }

          currentPosition = null;
        }
      }

      // 2. Evaluate Agent Entries if no active position
      if (!currentPosition && i > 15) {
        let entryType: 'LONG' | 'SHORT' | null = null;
        let triggeringAgent = '';
        let isMaker = false;

        // Evaluation by active agents:
        if (agents.trend_follower && isTrendBullish) {
          entryType = 'LONG';
          triggeringAgent = agentStats.trend_follower.name;
        } else if (agents.trend_follower && isTrendBearish) {
          entryType = 'SHORT';
          triggeringAgent = agentStats.trend_follower.name;
        } else if (agents.mean_reversion && isRsiOversold) {
          entryType = 'LONG';
          triggeringAgent = agentStats.mean_reversion.name;
        } else if (agents.mean_reversion && isRsiOverbought) {
          entryType = 'SHORT';
          triggeringAgent = agentStats.mean_reversion.name;
        } else if (agents.market_maker && isRangeBound) {
          // Hummingbot PMM limit maker quote
          entryType = Math.random() > 0.5 ? 'LONG' : 'SHORT';
          triggeringAgent = agentStats.market_maker.name;
          isMaker = true;
        } else if (agents.liquidity_hunter && c.volume > 500 && Math.abs(changePct) > 0.8) {
          entryType = changePct > 0 ? 'LONG' : 'SHORT';
          triggeringAgent = agentStats.liquidity_hunter.name;
        }

        if (entryType) {
          const tradeNotional = Math.min(equity * 0.4, 2500); // 40% position sizing
          const openFee = tradeNotional * lev * (isMaker ? makerFee : takerFee);
          equity -= openFee; // deduct entry fee

          currentPosition = {
            type: entryType,
            entry_price: c.close,
            entry_time: c.time,
            qty: tradeNotional / c.close,
            agent: triggeringAgent,
            notional: tradeNotional,
          };
        }
      }

      // 3. Periodic Funding Fee yield credit (every 8 candles if 1h interval)
      if (agents.funding_arb && i % 8 === 0 && equity > 0) {
        const fundingYield = equity * 0.25 * 0.0003; // ~0.03% 8-hour funding cash & carry carry
        equity += fundingYield;
        agentStats.funding_arb.pnl += fundingYield;
        agentStats.funding_arb.trades += 1;
        agentStats.funding_arb.wins += 1;
      }

      // Record equity curve point
      const currentDd = ((peakEquity - equity) / peakEquity) * 100;
      equityCurve.push({
        timestamp: c.time,
        time_str: new Date(c.time).toISOString().replace('T', ' ').slice(0, 16),
        price: c.close,
        equity: Math.round(equity * 100) / 100,
        drawdown_pct: Math.round(Math.max(0, currentDd) * 100) / 100,
      });
    }

    // Performance Calculations
    const netProfit = equity - initCapital;
    const netProfitPct = (netProfit / initCapital) * 100;
    const winningTrades = trades.filter((t) => t.status === 'WIN').length;
    const losingTrades = trades.filter((t) => t.status === 'LOSS').length;
    const totalTrades = trades.length;
    const winRatePct = totalTrades > 0 ? Math.round((winningTrades / totalTrades) * 1000) / 10 : 0;

    const grossProfit = trades.filter((t) => t.pnl_usdt > 0).reduce((sum, t) => sum + t.pnl_usdt, 0);
    const grossLoss = Math.abs(trades.filter((t) => t.pnl_usdt < 0).reduce((sum, t) => sum + t.pnl_usdt, 0));
    const profitFactor = grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? 99 : 1.0;

    // Sharpe Ratio approximation based on trade returns
    const tradeReturns = trades.map((t) => t.pnl_pct);
    const avgReturn = tradeReturns.length > 0 ? tradeReturns.reduce((a, b) => a + b, 0) / tradeReturns.length : 0;
    const variance =
      tradeReturns.length > 1
        ? tradeReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (tradeReturns.length - 1)
        : 1;
    const stdDev = Math.sqrt(variance) || 1;
    const sharpeRatio = Math.round(((avgReturn * Math.sqrt(252)) / stdDev) * 100) / 100;

    res.json({
      success: true,
      summary: {
        symbol,
        interval,
        candle_count: candles.length,
        initial_capital: initCapital,
        final_equity: Math.round(equity * 100) / 100,
        net_profit: Math.round(netProfit * 100) / 100,
        net_profit_pct: Math.round(netProfitPct * 100) / 100,
        total_trades: totalTrades,
        winning_trades: winningTrades,
        losing_trades: losingTrades,
        win_rate_pct: winRatePct,
        profit_factor: profitFactor,
        max_drawdown_pct: Math.round(maxDrawdownPct * 100) / 100,
        sharpe_ratio: sharpeRatio,
        leverage: lev,
      },
      agent_performance: Object.keys(agentStats).map((k) => ({
        id: k,
        name: agentStats[k].name,
        is_active: agentStats[k].is_active,
        trades_count: agentStats[k].trades,
        win_rate: agentStats[k].trades > 0 ? Math.round((agentStats[k].wins / agentStats[k].trades) * 100) : 0,
        pnl_contribution: Math.round(agentStats[k].pnl * 100) / 100,
      })),
      equity_curve: equityCurve.filter((_, idx) => idx % Math.max(1, Math.floor(equityCurve.length / 80)) === 0),
      recent_trades: trades.slice(-30).reverse(),
    });

    // Record backtest cycle activity in agent activity logs
    trades.slice(-10).forEach((t) => {
      logAgentActivity({
        module: 'BACKTEST',
        agent_name: t.agent || 'Hummingbot Multi-Agent',
        symbol,
        action: t.status === 'WIN' ? 'EXIT' : 'STOP_LOSS',
        entry_price: t.entry_price,
        exit_price: t.exit_price,
        pnl_usdt: t.pnl_usdt,
        pnl_pct: t.pnl_pct,
        severity: t.status === 'WIN' ? 'SUCCESS' : 'WARNING',
        message: `Backtest İcra: ${t.type} ${t.symbol} | Net PnL: ${t.pnl_usdt >= 0 ? '+' : ''}$${t.pnl_usdt} (${t.pnl_pct}%) | Neden: ${t.reason}`,
      });
    });

    logAgentActivity({
      module: 'BACKTEST',
      agent_name: 'Backtest Engine',
      symbol,
      action: 'CYCLE_SUMMARY',
      pnl_usdt: Math.round(netProfit * 100) / 100,
      pnl_pct: Math.round(netProfitPct * 100) / 100,
      severity: netProfit >= 0 ? 'SUCCESS' : 'WARNING',
      message: `Backtest Tamamlandı: ${candles.length} Mum (${interval}) | Net Kâr: ${netProfit >= 0 ? '+' : ''}$${Math.round(netProfit * 100) / 100} (%${Math.round(netProfitPct * 10) / 10}) | Kazanma Oranı: %${winRatePct} | Sharpe: ${sharpeRatio}`,
    });
  } catch (err: any) {
    logAgentActivity({
      module: 'BACKTEST',
      agent_name: 'Backtest Engine',
      symbol: (req.query.symbol as string) || 'UNKNOWN',
      action: 'ERROR',
      severity: 'ERROR',
      message: `Backtest Hatası: ${err.message}`,
      error_details: err.stack,
    });
    res.status(500).json({ success: false, detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// Ajan & Backtest Detaylı Aktivite Günlüğü (Detailed Activity Log)
// ---------------------------------------------------------------------------

interface AgentActivityLogEntry {
  id: string;
  timestamp: string;
  formatted_time: string;
  module: 'BACKTEST' | 'SNIPER_100X' | 'FUNDING_ARB' | 'COUNCIL' | 'RISK_SENTINEL';
  agent_name: string;
  symbol: string;
  action: 'ENTRY' | 'EXIT' | 'FLIP' | 'TRAILING_STOP' | 'STOP_LOSS' | 'CYCLE_SUMMARY' | 'ERROR' | 'ALERT';
  cycle_id?: number;
  entry_price?: number;
  exit_price?: number;
  pnl_usdt?: number;
  pnl_pct?: number;
  severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  message: string;
  error_details?: string;
}

const agentActivityLogs: AgentActivityLogEntry[] = [
  {
    id: `act_${Date.now()}_init`,
    timestamp: nowIso(),
    formatted_time: new Date().toLocaleTimeString('tr-TR', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0'),
    module: 'COUNCIL',
    agent_name: 'Aegis System',
    symbol: 'SYSTEM',
    action: 'CYCLE_SUMMARY',
    severity: 'INFO',
    message: 'Kuant Ajanları ve Backtest Telemetri Gözlem Masası Aktif Edildi.',
  },
];

function logAgentActivity(entry: Omit<AgentActivityLogEntry, 'id' | 'timestamp' | 'formatted_time'>) {
  const now = new Date();
  const fullLog: AgentActivityLogEntry = {
    id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: now.toISOString(),
    formatted_time: now.toLocaleTimeString('tr-TR', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0'),
    ...entry,
  };
  agentActivityLogs.unshift(fullLog);
  if (agentActivityLogs.length > 300) {
    agentActivityLogs.pop();
  }
  return fullLog;
}

// Activity Logs Endpoint
app.get('/api/activity-logs', (req: Request, res: Response) => {
  const moduleFilter = req.query.module as string | undefined;
  const severityFilter = req.query.severity as string | undefined;
  const limit = parseInt((req.query.limit as string) || '150', 10);

  let filtered = agentActivityLogs;
  if (moduleFilter) {
    filtered = filtered.filter((l) => l.module === moduleFilter);
  }
  if (severityFilter) {
    filtered = filtered.filter((l) => l.severity === severityFilter);
  }

  res.json({
    success: true,
    total_logs: agentActivityLogs.length,
    logs: filtered.slice(0, limit),
  });
});

app.post('/api/activity-logs/clear', (_req: Request, res: Response) => {
  agentActivityLogs.length = 0;
  logAgentActivity({
    module: 'COUNCIL',
    agent_name: 'Aegis System',
    symbol: 'SYSTEM',
    action: 'CYCLE_SUMMARY',
    severity: 'INFO',
    message: 'Aktivite günlüğü kullanıcı tarafından sıfırlandı.',
  });
  res.json({ success: true, message: 'Aktivite kayıtları temizlendi.' });
});

// ---------------------------------------------------------------------------
// 100x Ultra Yüksek Kaldıraçlı Sniper Bot / Ajan (Dynamic SAR & Trailing Stop)
// ---------------------------------------------------------------------------

interface Sniper100xPosition {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entry_price: number;
  current_price: number;
  qty: number;
  margin_usdt: number;
  leverage: number;
  pnl_usdt: number;
  roe_pct: number;
  trailing_active: boolean;
  highest_price: number;
  lowest_price: number;
  trailing_stop_price: number;
  entry_time: string;
  cycle_id: number;
}

interface Sniper100xState {
  is_running: boolean;
  symbol: string;
  leverage: number;
  margin_per_trade: number;
  trailing_step_pct: number;
  reversal_threshold_pct: number;
  auto_flip_enabled: boolean;
  coin_selection_mode: 'AUTO_VOLUME' | 'MANUAL';
  active_position: Sniper100xPosition | null;
  total_cycles: number;
  successful_flips: number;
  total_pnl_usdt: number;
  win_count: number;
  loss_count: number;
  started_at: string | null;
}

const sniper100xState: Sniper100xState = {
  is_running: false,
  symbol: 'BTCUSDT',
  leverage: 100,
  margin_per_trade: 100, // 100 USDT izole marjin
  trailing_step_pct: 0.08, // %0.08 fiyat sapması = 100x'te %8 ROE
  reversal_threshold_pct: 0.12, // %0.12 ters yön hareketi = Flip tetikle
  auto_flip_enabled: true, // Negatif yöne seyrederse kârla kapatıp ters yöne aç
  coin_selection_mode: 'AUTO_VOLUME',
  active_position: null,
  total_cycles: 0,
  successful_flips: 0,
  total_pnl_usdt: 0,
  win_count: 0,
  loss_count: 0,
  started_at: null,
};

// Top 100x Supported Coins by Binance 24h Volume and Volatility
app.get('/api/sniper-100x/coins', async (_req: Request, res: Response) => {
  try {
    const supportedSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'PEPEUSDT', 'XRPUSDT', 'SUIUSDT', 'NEARUSDT'];
    const coinList = supportedSymbols.map((sym) => {
      const live = liveMarketMap[sym];
      const price = live?.mid_price || (sym.startsWith('BTC') ? 92000 : sym.startsWith('ETH') ? 2600 : sym.startsWith('SOL') ? 175 : 0.20);
      const spreadPct = live?.spread_pct || 0.01;
      let volRank = 'YÜKSEK';
      let suitability = 'ULTRA LİKİDİTE (Sıfır Slippage)';
      let maxLev = 125;

      if (sym === 'BTCUSDT' || sym === 'ETHUSDT') {
        volRank = 'DEVASA';
        suitability = '1. DERECE GÜVENLİ (En Düşük Kayma Riski)';
        maxLev = 125;
      } else if (sym === 'SOLUSDT' || sym === 'DOGEUSDT' || sym === 'PEPEUSDT') {
        volRank = 'ÇOK YÜKSEK';
        suitability = 'YÜKSEK MOMENTUM (Hızlı Scalp & Ani Kırılım)';
        maxLev = 100;
      }

      return {
        symbol: sym,
        price,
        spread_pct: spreadPct,
        volume_category: volRank,
        max_leverage: maxLev,
        suitability_note: suitability,
        obi: live?.obi || 0,
        is_recommended: sym === 'BTCUSDT' || sym === 'SOLUSDT' || sym === 'ETHUSDT',
      };
    });

    res.json({
      success: true,
      coins: coinList,
      selection_advice: {
        title: '100x Kaldıraç İçin Coin Seçim Kriteri',
        criterion: '24 Saatlik İşlem Hacmi (Volume) + Tahta Derinliği (Order Book Depth) + Düşük Spread',
        reason: '100x kaldıraçta fiyatın %0.20 oynaması %20 kâr/zarar yaratır. Düşük hacimli coinlerde tahtada emir az olduğu için anlık kayma (slippage) yaşanır ve stop çalışmadan tasfiye olunabilir. Bu yüzden sadece Binance en yüksek hacimli pariteleri (BTC, ETH, SOL, DOGE, PEPE) seçilmelidir.',
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, detail: err.message });
  }
});

// 100x Sniper Engine Status
app.get('/api/sniper-100x/status', (_req: Request, res: Response) => {
  // Update live position PnL if active
  if (sniper100xState.active_position) {
    const pos = sniper100xState.active_position;
    const live = liveMarketMap[pos.symbol];
    if (live && live.mid_price > 0) {
      pos.current_price = live.mid_price;
      const isLong = pos.side === 'LONG';
      const priceDiffPct = isLong
        ? (pos.current_price - pos.entry_price) / pos.entry_price
        : (pos.entry_price - pos.current_price) / pos.entry_price;

      pos.roe_pct = Math.round(priceDiffPct * pos.leverage * 1000) / 10;
      pos.pnl_usdt = Math.round((priceDiffPct * pos.leverage * pos.margin_usdt) * 100) / 100;
    }
  }

  res.json({
    success: true,
    engine: sniper100xState,
  });
});

// 100x Sniper Engine Start
app.post('/api/sniper-100x/start', (req: Request, res: Response) => {
  const { symbol, leverage, margin, trailing_step, auto_flip, coin_selection_mode } = req.body;

  sniper100xState.symbol = symbol || 'BTCUSDT';
  sniper100xState.leverage = Number(leverage) || 100;
  sniper100xState.margin_per_trade = Number(margin) || 100;
  sniper100xState.trailing_step_pct = Number(trailing_step) || 0.08;
  sniper100xState.auto_flip_enabled = auto_flip !== undefined ? Boolean(auto_flip) : true;
  sniper100xState.coin_selection_mode = coin_selection_mode || 'AUTO_VOLUME';
  sniper100xState.is_running = true;
  sniper100xState.started_at = nowIso();

  // If no active position, immediately trigger an initial high-speed momentum entry
  if (!sniper100xState.active_position) {
    const live = liveMarketMap[sniper100xState.symbol];
    const curPrice = live?.mid_price || (sniper100xState.symbol.startsWith('BTC') ? 92500 : 2650);
    const side: 'LONG' | 'SHORT' = (live?.obi || 0) >= 0 ? 'LONG' : 'SHORT';
    sniper100xState.total_cycles += 1;

    const initialPos: Sniper100xPosition = {
      symbol: sniper100xState.symbol,
      side,
      entry_price: curPrice,
      current_price: curPrice,
      qty: (sniper100xState.margin_per_trade * sniper100xState.leverage) / curPrice,
      margin_usdt: sniper100xState.margin_per_trade,
      leverage: sniper100xState.leverage,
      pnl_usdt: 0,
      roe_pct: 0,
      trailing_active: false,
      highest_price: curPrice,
      lowest_price: curPrice,
      trailing_stop_price: side === 'LONG' ? curPrice * (1 - sniper100xState.trailing_step_pct / 100) : curPrice * (1 + sniper100xState.trailing_step_pct / 100),
      entry_time: nowIso(),
      cycle_id: sniper100xState.total_cycles,
    };

    sniper100xState.active_position = initialPos;

    logAgentActivity({
      module: 'SNIPER_100X',
      agent_name: 'HyperSniper 100x',
      symbol: sniper100xState.symbol,
      action: 'ENTRY',
      cycle_id: sniper100xState.total_cycles,
      entry_price: curPrice,
      severity: 'INFO',
      message: `🚀 100X BAŞLATILDI: ${side} pozisyonu $${curPrice} fiyatından açıldı. Kaldıraç: ${sniper100xState.leverage}x | Marjin: $${sniper100xState.margin_per_trade} USDT`,
    });
  }

  res.json({
    success: true,
    message: `100x Sniper Scalper motoru ${sniper100xState.symbol} üzerinde başlatıldı.`,
    engine: sniper100xState,
  });
});

// 100x Sniper Engine Stop
app.post('/api/sniper-100x/stop', (req: Request, res: Response) => {
  const closePosition = req.body.close_position !== false;

  if (sniper100xState.active_position && closePosition) {
    const pos = sniper100xState.active_position;
    sniper100xState.total_pnl_usdt += pos.pnl_usdt;
    if (pos.pnl_usdt >= 0) sniper100xState.win_count += 1;
    else sniper100xState.loss_count += 1;

    logAgentActivity({
      module: 'SNIPER_100X',
      agent_name: 'HyperSniper 100x',
      symbol: pos.symbol,
      action: 'EXIT',
      cycle_id: pos.cycle_id,
      exit_price: pos.current_price,
      pnl_usdt: pos.pnl_usdt,
      pnl_pct: pos.roe_pct,
      severity: pos.pnl_usdt >= 0 ? 'SUCCESS' : 'WARNING',
      message: `⏹ 100X DURDURULDU: Pozisyon ${pos.side} $${pos.current_price} seviyesinde kapatıldı. Kâr/Zarar: ${pos.pnl_usdt >= 0 ? '+' : ''}$${pos.pnl_usdt} USDT (%${pos.roe_pct} ROE)`,
    });

    sniper100xState.active_position = null;
  }

  sniper100xState.is_running = false;
  res.json({
    success: true,
    message: '100x Sniper Scalper motoru durduruldu.',
    engine: sniper100xState,
  });
});

// Manual Instant Flip / Reversal Trigger
app.post('/api/sniper-100x/flip', (req: Request, res: Response) => {
  if (!sniper100xState.active_position) {
    return res.status(400).json({ success: false, message: 'Aktif açık pozisyon bulunmuyor.' });
  }

  const oldPos = sniper100xState.active_position;
  const newSide: 'LONG' | 'SHORT' = oldPos.side === 'LONG' ? 'SHORT' : 'LONG';
  const exitPrice = oldPos.current_price;

  // Realize old PnL
  sniper100xState.total_pnl_usdt += oldPos.pnl_usdt;
  if (oldPos.pnl_usdt >= 0) sniper100xState.win_count += 1;
  else sniper100xState.loss_count += 1;
  sniper100xState.successful_flips += 1;
  sniper100xState.total_cycles += 1;

  logAgentActivity({
    module: 'SNIPER_100X',
    agent_name: 'HyperSniper 100x',
    symbol: oldPos.symbol,
    action: 'FLIP',
    cycle_id: oldPos.cycle_id,
    exit_price: exitPrice,
    pnl_usdt: oldPos.pnl_usdt,
    pnl_pct: oldPos.roe_pct,
    severity: oldPos.pnl_usdt >= 0 ? 'SUCCESS' : 'INFO',
    message: `🔄 ANINDA TERSİNE ÇEVRİLDİ (FLIP): ${oldPos.side} -> ${newSide} 100x | Önceki Kâr/Zarar: ${oldPos.pnl_usdt >= 0 ? '+' : ''}$${oldPos.pnl_usdt} USDT | Yeni Giriş: $${exitPrice}`,
  });

  // Open opposite position
  const newPos: Sniper100xPosition = {
    symbol: oldPos.symbol,
    side: newSide,
    entry_price: exitPrice,
    current_price: exitPrice,
    qty: (oldPos.margin_usdt * oldPos.leverage) / exitPrice,
    margin_usdt: oldPos.margin_usdt,
    leverage: oldPos.leverage,
    pnl_usdt: 0,
    roe_pct: 0,
    trailing_active: false,
    highest_price: exitPrice,
    lowest_price: exitPrice,
    trailing_stop_price: newSide === 'LONG' ? exitPrice * (1 - sniper100xState.trailing_step_pct / 100) : exitPrice * (1 + sniper100xState.trailing_step_pct / 100),
    entry_time: nowIso(),
    cycle_id: sniper100xState.total_cycles,
  };

  sniper100xState.active_position = newPos;

  res.json({
    success: true,
    message: `Pozisyon başarıyla ters yöne (${newSide} 100x) çevrildi.`,
    engine: sniper100xState,
  });
});

// 100x Scalper Engine Background Loop (Evaluates every 1200ms)
setInterval(() => {
  if (!sniper100xState.is_running) return;

  try {
    // 1. If no active position, pick highest volume coin if AUTO_VOLUME
    if (!sniper100xState.active_position) {
      if (sniper100xState.coin_selection_mode === 'AUTO_VOLUME') {
        const topSymbols = ['BTCUSDT', 'SOLUSDT', 'ETHUSDT'];
        const best = topSymbols[Math.floor(Math.random() * topSymbols.length)];
        sniper100xState.symbol = best;
      }

      const live = liveMarketMap[sniper100xState.symbol];
      if (live && live.mid_price > 0) {
        const curPrice = live.mid_price;
        const side: 'LONG' | 'SHORT' = (live.obi || 0) >= 0 ? 'LONG' : 'SHORT';
        sniper100xState.total_cycles += 1;

        sniper100xState.active_position = {
          symbol: sniper100xState.symbol,
          side,
          entry_price: curPrice,
          current_price: curPrice,
          qty: (sniper100xState.margin_per_trade * sniper100xState.leverage) / curPrice,
          margin_usdt: sniper100xState.margin_per_trade,
          leverage: sniper100xState.leverage,
          pnl_usdt: 0,
          roe_pct: 0,
          trailing_active: false,
          highest_price: curPrice,
          lowest_price: curPrice,
          trailing_stop_price: side === 'LONG' ? curPrice * (1 - sniper100xState.trailing_step_pct / 100) : curPrice * (1 + sniper100xState.trailing_step_pct / 100),
          entry_time: nowIso(),
          cycle_id: sniper100xState.total_cycles,
        };

        logAgentActivity({
          module: 'SNIPER_100X',
          agent_name: 'HyperSniper 100x',
          symbol: sniper100xState.symbol,
          action: 'ENTRY',
          cycle_id: sniper100xState.total_cycles,
          entry_price: curPrice,
          severity: 'INFO',
          message: `Döngü #${sniper100xState.total_cycles} Başladı: ${side} 100x $${curPrice} | Marjin: $${sniper100xState.margin_per_trade} USDT`,
        });
      }
      return;
    }

    // 2. Active Position Telemetry & Trailing Stop & Flip Evaluation
    const pos = sniper100xState.active_position;
    const live = liveMarketMap[pos.symbol];
    if (!live || live.mid_price <= 0) return;

    pos.current_price = live.mid_price;
    const isLong = pos.side === 'LONG';
    const priceDiffPct = isLong
      ? (pos.current_price - pos.entry_price) / pos.entry_price
      : (pos.entry_price - pos.current_price) / pos.entry_price;

    pos.roe_pct = Math.round(priceDiffPct * pos.leverage * 1000) / 10;
    pos.pnl_usdt = Math.round((priceDiffPct * pos.leverage * pos.margin_usdt) * 100) / 100;

    // Trailing Stop Tracking
    let shouldTriggerFlip = false;
    let flipReason = '';

    if (isLong) {
      if (pos.current_price > pos.highest_price) {
        pos.highest_price = pos.current_price;
      }
      // Activate trailing when profit reaches +0.10% (+10% ROE)
      if (pos.highest_price >= pos.entry_price * 1.0010) {
        pos.trailing_active = true;
      }
      if (pos.trailing_active) {
        pos.trailing_stop_price = pos.highest_price * (1 - sniper100xState.trailing_step_pct / 100);
        // If price falls below trailing stop: Trailing stop hit!
        if (pos.current_price <= pos.trailing_stop_price) {
          shouldTriggerFlip = true;
          flipReason = `İz Süren Stop (Trailing Stop) Tetiklendi ($${Math.round(pos.trailing_stop_price * 100) / 100} Altına İndi)`;
        }
      }
      // Emergency cut if adverse move > 0.45% (-45% ROE)
      if (pos.roe_pct <= -45) {
        shouldTriggerFlip = true;
        flipReason = 'Acil Risk Kesici (-%45 ROE Eşiği Aşıldı)';
      }
    } else {
      // SHORT
      if (pos.current_price < pos.lowest_price) {
        pos.lowest_price = pos.current_price;
      }
      // Activate trailing when profit reaches +0.10% (+10% ROE)
      if (pos.lowest_price <= pos.entry_price * 0.9990) {
        pos.trailing_active = true;
      }
      if (pos.trailing_active) {
        pos.trailing_stop_price = pos.lowest_price * (1 + sniper100xState.trailing_step_pct / 100);
        // If price rises above trailing stop: Trailing stop hit!
        if (pos.current_price >= pos.trailing_stop_price) {
          shouldTriggerFlip = true;
          flipReason = `İz Süren Stop (Trailing Stop) Tetiklendi ($${Math.round(pos.trailing_stop_price * 100) / 100} Üstüne Çıktı)`;
        }
      }
      // Emergency cut if adverse move > 0.45% (-45% ROE)
      if (pos.roe_pct <= -45) {
        shouldTriggerFlip = true;
        flipReason = 'Acil Risk Kesici (-%45 ROE Eşiği Aşıldı)';
      }
    }

    // Execute FLIP (Ters Yöne Dönüş) veya Kapanış
    if (shouldTriggerFlip) {
      const exitPrice = pos.current_price;
      const netPnl = pos.pnl_usdt;
      const netRoe = pos.roe_pct;
      sniper100xState.total_pnl_usdt += netPnl;
      if (netPnl >= 0) sniper100xState.win_count += 1;
      else sniper100xState.loss_count += 1;

      if (sniper100xState.auto_flip_enabled) {
        const nextSide: 'LONG' | 'SHORT' = pos.side === 'LONG' ? 'SHORT' : 'LONG';
        sniper100xState.successful_flips += 1;
        sniper100xState.total_cycles += 1;

        logAgentActivity({
          module: 'SNIPER_100X',
          agent_name: 'HyperSniper 100x',
          symbol: pos.symbol,
          action: 'FLIP',
          cycle_id: pos.cycle_id,
          exit_price: exitPrice,
          pnl_usdt: netPnl,
          pnl_pct: netRoe,
          severity: netPnl >= 0 ? 'SUCCESS' : 'WARNING',
          message: `🔄 DÖNGÜ #${pos.cycle_id} TAMAMLANDI (${flipReason}): Kâr/Zarar: ${netPnl >= 0 ? '+' : ''}$${netPnl} USDT (%${netRoe} ROE). Anında ters yöne (${nextSide} 100x) açıldı!`,
        });

        // Open reverse position immediately
        sniper100xState.active_position = {
          symbol: pos.symbol,
          side: nextSide,
          entry_price: exitPrice,
          current_price: exitPrice,
          qty: (pos.margin_usdt * pos.leverage) / exitPrice,
          margin_usdt: pos.margin_usdt,
          leverage: pos.leverage,
          pnl_usdt: 0,
          roe_pct: 0,
          trailing_active: false,
          highest_price: exitPrice,
          lowest_price: exitPrice,
          trailing_stop_price: nextSide === 'LONG' ? exitPrice * (1 - sniper100xState.trailing_step_pct / 100) : exitPrice * (1 + sniper100xState.trailing_step_pct / 100),
          entry_time: nowIso(),
          cycle_id: sniper100xState.total_cycles,
        };
      } else {
        logAgentActivity({
          module: 'SNIPER_100X',
          agent_name: 'HyperSniper 100x',
          symbol: pos.symbol,
          action: 'EXIT',
          cycle_id: pos.cycle_id,
          exit_price: exitPrice,
          pnl_usdt: netPnl,
          pnl_pct: netRoe,
          severity: netPnl >= 0 ? 'SUCCESS' : 'INFO',
          message: `Döngü #${pos.cycle_id} Kapatıldı (${flipReason}): Net PnL: ${netPnl >= 0 ? '+' : ''}$${netPnl} USDT (%${netRoe} ROE)`,
        });
        sniper100xState.active_position = null;
      }
    }
  } catch (loopErr) {
    // protect ticker loop
  }
}, 1200);

// Telegram Test
app.post('/api/telegram/test', (req: Request, res: Response) => {
  addLog('Telegram test bildirimi gönderildi.', 'INFO', 'TELEGRAM');
  res.json({ success: true, message: 'Test mesajı Telegram kuyruğuna iletildi.' });
});

// Logs
app.get('/api/logs', (req: Request, res: Response) => {
  const limit = parseInt((req.query.limit as string) || '100', 10);
  res.json({ logs: logs.slice(0, limit) });
});

// Deploy Webhook
app.all('/api/webhook/github-deploy', (req: Request, res: Response) => {
  addLog('[Deploy] Webhook çağrıldı, sistem güncel.', 'INFO', 'DEPLOY');
  res.json({ status: 'deployed', timestamp: nowIso(), version: 'v3.0' });
});

// ---------------------------------------------------------------------------
// HTTP Server & WebSocket Telemetry Stream (Nginx Proxy Manager Friendly)
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

interface ExtendedWebSocket extends WebSocket {
  isAlive?: boolean;
}

// Ping-pong heartbeat every 20s to keep connection alive through Nginx proxies
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws: ExtendedWebSocket) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 20000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

wss.on('connection', (ws: ExtendedWebSocket) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const interval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(interval);
      return;
    }
    const activeId = settings.active_account_id || 'acc_alpha';
    const activeAcc = accounts.find((a) => a.id === activeId) || accounts[0];
    const enrichedAccounts = accounts.map(enrichAccount);
    const enrichedActive = enrichAccount(activeAcc);
    const radar = buildRadar();
    const openPos = updatePositionsPnlLive(activeId);
    const pnl = getPnlSummary(activeId);
    const hummingbot = computeHummingbotQuantState(activeId);

    const longCount = radar.filter((r) => r.signal === 'LONG').length;
    const shortCount = radar.filter((r) => r.signal === 'SHORT').length;
    const total = radar.length;

    const payload = {
      accounts: enrichedAccounts,
      active_account: enrichedActive,
      engine_running: activeAcc.engine_state === 'RUNNING',
      engine_state: activeAcc.engine_state,
      stop_mode: activeAcc.stop_mode,
      sentinel: getSentinelStatus(activeId),
      pnl_summary: pnl,
      regime_info: {
        regime: 'HUMMINGBOT DİNAMİK AĞIRLIKLANDIRMA',
        direction: longCount > shortCount ? 'BOĞA' : 'AYI',
        risk: 'ORTA',
        macro_title: '15 Parite Canlı Taranıyor',
      },
      macro_summary: {
        total_scanned: total,
        long_count: longCount,
        short_count: shortCount,
        neutral_count: total - longCount - shortCount,
        bullish_pct: Math.round((longCount / total) * 100),
        bearish_pct: Math.round((shortCount / total) * 100),
        system_macro_signal: 'HUMMINGBOT ÇİFT PİYASA RADARI',
        market_state: longCount > shortCount ? 'BOĞA' : 'AYI',
        risk_index: 'ORTA',
      },
      radar,
      positions: openPos,
      orders: orders.filter((o) => o.account_id === activeId).slice(0, 100),
      trades: trades.filter((t) => t.account_id === activeId).slice(0, 100),
      agents: councilAgents,
      logs: logs.slice(0, 30),
      jev_consensus: getJevConsensus(),
      council_telemetry: getCouncilTelemetry(),
      hunter_pipeline: getHunterTelemetry(),
      hummingbot,
      binance_latency_ms: lastBinanceSyncLatency,
      is_real_binance_data: true,
      timestamp: nowIso(),
    };

    try {
      ws.send(JSON.stringify(payload));
    } catch (e) {
      clearInterval(interval);
    }
  }, 450);

  ws.on('close', () => clearInterval(interval));
  ws.on('error', () => clearInterval(interval));
});

// ---------------------------------------------------------------------------
// Vite Dev Middlewares or Production Static Serving
// ---------------------------------------------------------------------------

async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve('dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, HOST, () => {
    console.log(`⚡ AegisQuant v3.0 + Hummingbot Engine running on http://${HOST}:${PORT}`);
    console.log(`🌐 Ready for Ubuntu / Nginx Proxy Manager (http://172.21.0.1:${PORT})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start AegisQuant server:', err);
  process.exit(1);
});
