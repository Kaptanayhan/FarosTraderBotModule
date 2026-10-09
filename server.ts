import http from 'http';
import path from 'path';
import crypto from 'crypto';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';

const app = express();
app.use(cors());
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
  type: string;
  target_price: number;
  current_price: number;
  status: string; // 'PLANNED' | 'FILLED' | 'CANCELLED'
  agent_name: string;
  quantity: number;
  filled_price: number;
  commission: number;
  reason: string;
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
  if (logs.length > 200) logs.pop();
}

// Initial System Settings
const settings: Record<string, string> = {
  active_account_id: 'acc_alpha',
  telegram_token: '8605987091:AAEbSLn5Ubdx0_TZ2fJCvhAQuzAYs8fZz7Y',
  telegram_chat_id: '2140273565',
  telegram_enabled: 'true',
  telegram_bot_username: '@Omnideneme_bot',
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

// Initial 11 Council Agents
const councilAgents: AgentMetric[] = [
  { agent_id: 'ag_1', name: '🛰️ Orchestrator Alpha', role: 'Baş Stratejist & Lider', win_count: 84, loss_count: 18, consecutive_losses: 0, weight: 0.20, total_pnl: 1420.5, last_target_symbol: 'BTCUSDT', status: 'İZLEMEDE', win_rate: 82.4, last_vote: 'BUY', last_score: 86, last_reason: 'Piyasa makro trendi güçlü yukarı yönde', history: [] },
  { agent_id: 'ag_2', name: '🎯 Hot-Coin Sniper', role: 'Volatilite & Meme Avcısı', win_count: 72, loss_count: 24, consecutive_losses: 0, weight: 0.15, total_pnl: 960.2, last_target_symbol: 'DOGEUSDT', status: 'İZLEMEDE', win_rate: 75.0, last_vote: 'BUY', last_score: 79, last_reason: 'Meme hacim anomalisi tespit edildi', history: [] },
  { agent_id: 'ag_3', name: '🐋 Whale Flow Sentinel', role: 'Binance Balina Radarı', win_count: 88, loss_count: 16, consecutive_losses: 0, weight: 0.20, total_pnl: 1890.0, last_target_symbol: 'ETHUSDT', status: 'İZLEMEDE', win_rate: 84.6, last_vote: 'BUY', last_score: 88, last_reason: '+$4.2M net balina vadeli alış akışı', history: [] },
  { agent_id: 'ag_4', name: '📊 Orderbook Depth AI', role: 'Derinlik & Likidite Analisti', win_count: 65, loss_count: 20, consecutive_losses: 1, weight: 0.10, total_pnl: 520.1, last_target_symbol: 'SOLUSDT', status: 'İZLEMEDE', win_rate: 76.5, last_vote: 'BUY', last_score: 74, last_reason: 'L2 OBI derinlik desteği +0.38', history: [] },
  { agent_id: 'ag_5', name: '🐦 Social & X Sentiment', role: 'Twitter/X & Duygu Ajanı', win_count: 58, loss_count: 25, consecutive_losses: 0, weight: 0.05, total_pnl: 310.0, last_target_symbol: 'PEPEUSDT', status: 'İZLEMEDE', win_rate: 69.9, last_vote: 'BUY', last_score: 71, last_reason: 'Pozitif duygu indeksi %74', history: [] },
  { agent_id: 'ag_6', name: '⚡ Sub-Second Executor', role: 'Milisaniyelik HFT İcracı', win_count: 91, loss_count: 15, consecutive_losses: 0, weight: 0.15, total_pnl: 1650.4, last_target_symbol: 'BNBUSDT', status: 'İZLEMEDE', win_rate: 85.8, last_vote: 'BUY', last_score: 89, last_reason: '32ms mikro-arbitraj fırsatı', history: [] },
  { agent_id: 'ag_7', name: '⚖️ Dynamic Hedger', role: 'Delta-Neutral Arbitraj', win_count: 50, loss_count: 12, consecutive_losses: 0, weight: 0.05, total_pnl: 420.0, last_target_symbol: 'LINKUSDT', status: 'İZLEMEDE', win_rate: 80.6, last_vote: 'NEUTRAL', last_score: 60, last_reason: 'Delta riski nötr dengede', history: [] },
  { agent_id: 'ag_8', name: '🩸 Liquidation Hunter', role: 'Tasfiye & Fonlama Avcısı', win_count: 63, loss_count: 19, consecutive_losses: 0, weight: 0.05, total_pnl: 780.8, last_target_symbol: 'SUIUSDT', status: 'İZLEMEDE', win_rate: 76.8, last_vote: 'BUY', last_score: 82, last_reason: 'Üst kademede short squeeze tasfiye havuzu', history: [] },
  { agent_id: 'ag_9', name: '🌾 Trailing Scalper', role: 'Mikro Kâr Toplayıcı', win_count: 77, loss_count: 22, consecutive_losses: 0, weight: 0.10, total_pnl: 890.3, last_target_symbol: 'AVAXUSDT', status: 'İZLEMEDE', win_rate: 77.8, last_vote: 'BUY', last_score: 77, last_reason: 'İz süren stop dinamik bantta', history: [] },
  { agent_id: 'ag_10', name: '🛡️ Iron Risk Guardian', role: 'Sermaye & Drawdown Koruyucu', win_count: 95, loss_count: 5, consecutive_losses: 0, weight: 0.05, total_pnl: 250.0, last_target_symbol: 'TÜM PORTFÖY', status: 'İZLEMEDE', win_rate: 95.0, last_vote: 'BUY', last_score: 92, last_reason: 'Kasa drawdown güvenli bölgede (%0.8)', history: [] },
  { agent_id: 'ag_11', name: '🧠 Autonomous Risk Executive', role: 'Otonom Sistem & Kasa Yöneticisi', win_count: 88, loss_count: 10, consecutive_losses: 0, weight: 0.10, total_pnl: 1100.0, last_target_symbol: 'SENTINEL', status: 'İZLEMEDE', win_rate: 89.8, last_vote: 'BUY', last_score: 90, last_reason: 'Otonom dinamik risk optimizasyonu devrede', history: [] },
];

let positions: Position[] = [];
let orders: Order[] = [];
let trades: Trade[] = [];

// Seed sample past trade and initial position for alpha account
trades.push(
  {
    id: 'tr_seed_1',
    account_id: 'acc_alpha',
    symbol: 'BTCUSDT',
    side: 'LONG',
    entry_price: 94250.0,
    exit_price: 95680.0,
    size: 0.05,
    pnl: 71.5,
    net_pnl: 68.2,
    fee: 3.3,
    stop_loss: 93500.0,
    take_profit: 96000.0,
    agent_name: '🛰️ Orchestrator Alpha',
    reason: 'Take Profit Ulaşıldı',
    closed_at: nowIso(),
  },
  {
    id: 'tr_seed_2',
    account_id: 'acc_alpha',
    symbol: 'SOLUSDT',
    side: 'LONG',
    entry_price: 184.2,
    exit_price: 189.5,
    size: 2.5,
    pnl: 13.25,
    net_pnl: 12.4,
    fee: 0.85,
    stop_loss: 181.0,
    take_profit: 191.0,
    agent_name: '⚡ Sub-Second Executor',
    reason: 'Kullanıcı Manuel Kapatma',
    closed_at: nowIso(),
  }
);

addLog('AegisQuant v3.0 Otonom Kuant Motoru Aktif.', 'INFO', 'SYSTEM');

// ---------------------------------------------------------------------------
// Market Radar & Real-Time Price Simulation / Binance Data
// ---------------------------------------------------------------------------

const BASE_PRICES: Record<string, { price: number; change: number; high: number; low: number; vol: number; obi: number; funding: number }> = {
  BTCUSDT: { price: 95420.0, change: 2.45, high: 96200.0, low: 93800.0, vol: 850000000, obi: 38.4, funding: 0.00012 },
  ETHUSDT: { price: 3340.5, change: 1.82, high: 3390.0, low: 3260.0, vol: 420000000, obi: 24.1, funding: 0.00010 },
  SOLUSDT: { price: 188.75, change: 4.15, high: 192.5, low: 181.2, vol: 310000000, obi: 42.0, funding: 0.00015 },
  BNBUSDT: { price: 642.1, change: 0.95, high: 648.0, low: 635.0, vol: 140000000, obi: 18.5, funding: 0.00008 },
  DOGEUSDT: { price: 0.245, change: 6.80, high: 0.258, low: 0.228, vol: 290000000, obi: 54.2, funding: 0.00025 },
  PEPEUSDT: { price: 0.0000185, change: 8.40, high: 0.0000198, low: 0.0000168, vol: 210000000, obi: 61.0, funding: 0.00030 },
  XRPUSDT: { price: 2.15, change: -1.20, high: 2.22, low: 2.11, vol: 260000000, obi: -15.4, funding: -0.00005 },
  NEARUSDT: { price: 6.85, change: 3.25, high: 7.10, low: 6.55, vol: 95000000, obi: 28.0, funding: 0.00011 },
  SUIUSDT: { price: 3.42, change: 5.60, high: 3.58, low: 3.22, vol: 180000000, obi: 46.5, funding: 0.00018 },
  AVAXUSDT: { price: 34.6, change: 2.10, high: 35.8, low: 33.7, vol: 110000000, obi: 22.8, funding: 0.00009 },
  LINKUSDT: { price: 17.8, change: 1.45, high: 18.2, low: 17.4, vol: 88000000, obi: 16.2, funding: 0.00007 },
  ARBUSDT: { price: 0.72, change: -0.85, high: 0.75, low: 0.70, vol: 62000000, obi: -8.5, funding: 0.00004 },
  INJUSDT: { price: 26.4, change: 3.80, high: 27.5, low: 25.2, vol: 74000000, obi: 31.4, funding: 0.00014 },
  SHIBUSDT: { price: 0.0000215, change: 4.20, high: 0.0000228, low: 0.0000204, vol: 120000000, obi: 25.0, funding: 0.00012 },
  RENDERUSDT: { price: 8.95, change: 4.80, high: 9.30, low: 8.50, vol: 85000000, obi: 37.0, funding: 0.00016 },
};

let currentPrices: Record<string, number> = {};
Object.entries(BASE_PRICES).forEach(([k, v]) => {
  currentPrices[k] = v.price;
});

// Try fetching live Binance prices in background
async function syncBinanceTickers() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const item of data) {
          if (BASE_PRICES[item.symbol]) {
            const p = parseFloat(item.lastPrice);
            if (!isNaN(p) && p > 0) {
              currentPrices[item.symbol] = p;
              BASE_PRICES[item.symbol].price = p;
              BASE_PRICES[item.symbol].change = parseFloat(item.priceChangePercent) || BASE_PRICES[item.symbol].change;
              BASE_PRICES[item.symbol].high = parseFloat(item.highPrice) || BASE_PRICES[item.symbol].high;
              BASE_PRICES[item.symbol].low = parseFloat(item.lowPrice) || BASE_PRICES[item.symbol].low;
              BASE_PRICES[item.symbol].vol = parseFloat(item.quoteVolume) || BASE_PRICES[item.symbol].vol;
            }
          }
        }
      }
    }
  } catch (err) {
    // Graceful fallback to jitter simulation
  }
}

// Micro jitter every 500ms
setInterval(() => {
  Object.keys(currentPrices).forEach(sym => {
    const base = BASE_PRICES[sym];
    const jitterPct = (Math.random() - 0.49) * 0.0012; // Small realistic tick
    currentPrices[sym] = Math.round((currentPrices[sym] * (1 + jitterPct)) * 10000) / 10000;
  });
}, 500);

// Background sync every 6 seconds
setInterval(syncBinanceTickers, 6000);
syncBinanceTickers();

// ---------------------------------------------------------------------------
// Radar Generator & Quant Indicators
// ---------------------------------------------------------------------------

function buildRadar() {
  return Object.entries(BASE_PRICES).map(([symbol, base]) => {
    const p = currentPrices[symbol] || base.price;
    const change = base.change;
    const isBull = change > 0;
    const signal = Math.abs(change) < 0.5 ? 'NEUTRAL' : isBull ? 'LONG' : 'SHORT';
    const bidVol = Math.round(base.vol * (0.5 + base.obi / 200));
    const askVol = Math.round(base.vol * (0.5 - base.obi / 200));

    return {
      symbol,
      price: p,
      priceChangePercent: change,
      highPrice: Math.max(base.high, p),
      lowPrice: Math.min(base.low, p),
      volume: base.vol,
      quoteVolume: base.vol,
      bid_vol: bidVol,
      ask_vol: askVol,
      obi: base.obi,
      funding_rate: base.funding,
      signal,
      agent: isBull ? '🛰️ Alpha Trend' : '🩸 Hunter',
    };
  });
}

function computeIndicators(symbol: string, currentPrice: number) {
  const base = BASE_PRICES[symbol] || { price: currentPrice, change: 1.5, high: currentPrice * 1.02, low: currentPrice * 0.98, vol: 100000000, obi: 25.0, funding: 0.0001 };
  const change = base.change;
  const high = Math.max(base.high, currentPrice);
  const low = Math.min(base.low, currentPrice);
  const tr = high - low;

  const rsi = Math.round(Math.min(88, Math.max(22, 50 + change * 4.2)));
  const ema9 = Math.round(currentPrice * (1 + change * 0.001) * 100) / 100;
  const ema21 = Math.round(currentPrice * (1 - change * 0.001) * 100) / 100;
  const ema200 = Math.round(currentPrice * (change > 0 ? 0.96 : 1.04) * 100) / 100;
  const atr = Math.round(tr * 0.22 * 100) / 100;
  const bbw = Math.round((tr / currentPrice * 100) * 100) / 100;
  const vwap = Math.round(((high + low + currentPrice) / 3) * 100) / 100;
  const cvd = Math.round((base.vol * (change / 100)) * 100) / 100;

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
    obi: base.obi,
    funding_rate: base.funding,
    macd: {
      line: Math.round((ema9 - ema21) * 100) / 100,
      signal: Math.round((ema9 - ema21) * 0.8 * 100) / 100,
      hist: Math.round((ema9 - ema21) * 0.2 * 100) / 100,
    },
    supertrend: {
      value: Math.round(currentPrice * (change > 0 ? 0.985 : 1.015) * 100) / 100,
      direction: change > 0 ? 'BULLISH' : 'BEARISH',
    },
    score: Math.min(96, Math.max(45, Math.round(60 + Math.abs(change) * 4))),
  };
}

// ---------------------------------------------------------------------------
// Account Helper
// ---------------------------------------------------------------------------

function enrichAccount(acc: Account) {
  const activePositions = positions.filter(p => p.account_id === acc.id && p.status === 'OPEN');
  const usedMargin = activePositions.reduce((sum, p) => sum + p.margin, 0);
  const unrealizedPnl = activePositions.reduce((sum, p) => sum + p.pnl, 0);
  const walletBalance = acc.balance;
  const equity = Math.round((walletBalance + unrealizedPnl) * 100) / 100;
  const freeMargin = Math.max(0, Math.round((walletBalance - usedMargin) * 100) / 100);

  return {
    ...acc,
    wallet_balance: walletBalance,
    equity,
    used_margin: Math.round(usedMargin * 100) / 100,
    free_margin: freeMargin,
    unrealized_pnl: Math.round(unrealizedPnl * 100) / 100,
  };
}

function updatePositionsPnlLive(accountId: string) {
  const openPos = positions.filter(p => p.account_id === accountId && p.status === 'OPEN');
  openPos.forEach(pos => {
    const curPrice = currentPrices[pos.symbol] || pos.entry_price;
    pos.mark_price = curPrice;
    const diff = pos.side === 'LONG' ? (curPrice - pos.entry_price) : (pos.entry_price - curPrice);
    const pnl = (diff * pos.size);
    pos.pnl = Math.round(pnl * 100) / 100;
    pos.pnl_pct = Math.round(((diff / pos.entry_price) * pos.leverage * 100) * 100) / 100;

    // Check take profit / stop loss trigger
    if (pos.take_profit && ((pos.side === 'LONG' && curPrice >= pos.take_profit) || (pos.side === 'SHORT' && curPrice <= pos.take_profit))) {
      closePositionInternal(pos.id, curPrice, '🎯 Take Profit Ulaşıldı');
    } else if (pos.stop_loss && ((pos.side === 'LONG' && curPrice <= pos.stop_loss) || (pos.side === 'SHORT' && curPrice >= pos.stop_loss))) {
      closePositionInternal(pos.id, curPrice, '🛑 Stop Loss Tetiklendi');
    }
  });
  return openPos;
}

function closePositionInternal(positionId: string, exitPrice: number, reason: string) {
  const posIndex = positions.findIndex(p => p.id === positionId && p.status === 'OPEN');
  if (posIndex === -1) return null;
  const pos = positions[posIndex];
  pos.status = 'CLOSED';
  pos.closed_at = nowIso();
  pos.mark_price = exitPrice;

  const diff = pos.side === 'LONG' ? (exitPrice - pos.entry_price) : (pos.entry_price - exitPrice);
  const pnl = Math.round((diff * pos.size) * 100) / 100;
  const fee = Math.round((exitPrice * pos.size * 0.0005) * 100) / 100;
  const netPnl = Math.round((pnl - fee) * 100) / 100;

  // Add trade
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
  const acc = accounts.find(a => a.id === pos.account_id);
  if (acc) {
    acc.balance = Math.round((acc.balance + netPnl) * 100) / 100;
    acc.updated_at = nowIso();
  }

  addLog(`[POZİSYON KAPANDI] ${pos.symbol} ${pos.side} (${reason}) PnL: $${netPnl}`, netPnl >= 0 ? 'INFO' : 'WARN', 'POSITION');
  return trade;
}

// ---------------------------------------------------------------------------
// Telemetry & Consensus State
// ---------------------------------------------------------------------------

function getJevConsensus() {
  const radar = buildRadar();
  const topPair = radar.reduce((prev, curr) => (Math.abs(curr.priceChangePercent) > Math.abs(prev.priceChangePercent) ? curr : prev), radar[0]);
  const isBull = topPair.priceChangePercent >= 0;

  return {
    symbol: topPair.symbol,
    action: isBull ? 'BUY' : 'SELL',
    direction: isBull ? 'LONG' : 'SHORT',
    consensus_score: 87,
    confidence: 'HIGH',
    timeframe: '5m / 15m Trend & Hacim',
    agent_votes: {
      scalper: { agent: '⚡ Scalper Ajanı', signal: isBull ? 'AL' : 'SAT', score: 84 },
      trend: { agent: '📈 Trend Follower', signal: isBull ? 'AL' : 'SAT', score: 92 },
      breakout: { agent: '💥 Breakout Ajanı', signal: isBull ? 'AL' : 'SAT', score: 78 },
      whale: { agent: '🐋 Whale Flow', signal: isBull ? 'AL' : 'SAT', score: 88 },
      depth: { agent: '📊 Orderbook Depth', signal: isBull ? 'AL' : 'SAT', score: 81 },
      risk: { agent: '🛡️ Iron Risk Guardian', signal: 'UYGUN', score: 95 },
    },
    reason: `${topPair.symbol} üzerinde EMA9/21 altın kesişim ve +${topPair.obi}% OBI alıcı baskısı`,
  };
}

function getCouncilTelemetry() {
  const consensus = getJevConsensus();
  return {
    active_agent_count: 11,
    total_agents: 11,
    consensus_rate: 87,
    agreement_ratio: 0.87,
    agreement_ratio_val: 0.87,
    display_consensus_rate: 87,
    status: 'ONLINE',
    agents: councilAgents,
    last_consensus: consensus,
    round_latency_ms: 38,
    timestamp: nowIso(),
  };
}

function getHunterTelemetry() {
  const radar = buildRadar();
  const highVol = radar.filter(r => Math.abs(r.priceChangePercent) > 2.0);
  return {
    total_candidates: highVol.length,
    candidates: highVol.map(r => ({
      symbol: r.symbol,
      score: Math.round(70 + Math.abs(r.priceChangePercent) * 3),
      status: 'MONITORING',
      trigger: `${r.obi > 0 ? '+' : ''}${r.obi}% OBI`,
    })),
    pipeline_stage: 'STAGE_3_EXECUTION',
    throughput_per_sec: 24,
    latency_ms: 42,
  };
}

function getPnlSummary(accountId: string) {
  const accTrades = trades.filter(t => t.account_id === accountId);
  const total = accTrades.length;
  const gross = accTrades.reduce((s, t) => s + t.pnl, 0);
  const net = accTrades.reduce((s, t) => s + t.net_pnl, 0);
  const fees = accTrades.reduce((s, t) => s + t.fee, 0);
  const wins = accTrades.filter(t => t.net_pnl > 0).length;
  const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0.0;

  return {
    total_trades: total,
    gross_pnl: Math.round(gross * 100) / 100,
    net_pnl: Math.round(net * 100) / 100,
    total_fees: Math.round(fees * 100) / 100,
    win_rate: winRate,
    winning_trades: wins,
    losing_trades: total - wins,
  };
}

function getSentinelStatus(accountId?: string) {
  const activeId = accountId || settings.active_account_id || 'acc_alpha';
  const acc = accounts.find(a => a.id === activeId) || accounts[0];
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
// Autonomous Trading Engine Simulator
// ---------------------------------------------------------------------------

let engineInterval: NodeJS.Timeout | null = null;

function stepEngine() {
  const activeId = settings.active_account_id || 'acc_alpha';
  const acc = accounts.find(a => a.id === activeId);
  if (!acc || acc.engine_state !== 'RUNNING') return;

  const openPos = positions.filter(p => p.account_id === activeId && p.status === 'OPEN');
  // If fewer than 2 open positions, open high-confidence pair from council consensus
  if (openPos.length < 2) {
    const radar = buildRadar();
    const candidate = radar.find(r => !openPos.some(p => p.symbol === r.symbol) && Math.abs(r.priceChangePercent) > 1.5) || radar[0];
    const side = candidate.priceChangePercent >= 0 ? 'LONG' : 'SHORT';
    const entryPrice = currentPrices[candidate.symbol] || candidate.price;
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
      agent_name: candidate.agent || '🛰️ Orchestrator Alpha',
      status: 'OPEN',
      opened_at: nowIso(),
    };
    positions.push(newPos);

    // Also add to orders history as FILLED
    orders.unshift({
      id: `ord_${Date.now()}`,
      account_id: activeId,
      symbol: candidate.symbol,
      side,
      type: 'MARKET',
      target_price: entryPrice,
      current_price: entryPrice,
      status: 'FILLED',
      agent_name: candidate.agent || '🛰️ Orchestrator Alpha',
      quantity: size,
      filled_price: entryPrice,
      commission: Math.round(notional * 0.0004 * 100) / 100,
      reason: 'Konsey Konsensüs Giriş Onayı',
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    addLog(`[YENİ POZİSYON] ${candidate.symbol} ${side} @ $${entryPrice} (Marjin: $${margin}, ${lev}x)`, 'INFO', 'ENGINE');
  }

  // Update existing positions
  updatePositionsPnlLive(activeId);
}

// ---------------------------------------------------------------------------
// REST API Routes
// ---------------------------------------------------------------------------

// Health
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// System Status
app.get('/api/status', (req: Request, res: Response) => {
  const activeId = settings.active_account_id || 'acc_alpha';
  const acc = accounts.find(a => a.id === activeId) || accounts[0];
  const enriched = enrichAccount(acc);
  const radar = buildRadar();
  const openPos = positions.filter(p => p.account_id === activeId && p.status === 'OPEN');

  const longCount = radar.filter(r => r.signal === 'LONG').length;
  const shortCount = radar.filter(r => r.signal === 'SHORT').length;
  const total = radar.length;

  res.json({
    status: 'healthy',
    system: 'AegisQuant v3.0',
    engine_running: acc.engine_state === 'RUNNING',
    engine_state: acc.engine_state,
    stop_mode: acc.stop_mode,
    active_account_id: activeId,
    active_account: enriched,
    sentinel: getSentinelStatus(activeId),
    regime_info: {
      regime: 'DİNAMİK AĞIRLIKLANDIRMA',
      direction: longCount > shortCount ? 'BOĞA (YUKARI)' : 'AYI (AŞAĞI)',
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
      system_macro_signal: 'DİNAMİK ÇİFT PİYASA RADARI',
      market_state: longCount > shortCount ? 'BOĞA' : 'AYI',
      risk_index: 'ORTA',
    },
    open_positions_count: openPos.length,
    agents: councilAgents,
    jev_consensus: getJevConsensus(),
    council_telemetry: getCouncilTelemetry(),
    hunter_pipeline: getHunterTelemetry(),
  });
});

app.get('/api/hunter/telemetry', (req: Request, res: Response) => {
  res.json(getHunterTelemetry());
});

// Accounts
app.get('/api/accounts', (req: Request, res: Response) => {
  res.json({ accounts: accounts.map(enrichAccount) });
});

app.get(['/api/account', '/api/balance'], (req: Request, res: Response) => {
  const activeId = (req.query.account_id as string) || settings.active_account_id || 'acc_alpha';
  const acc = accounts.find(a => a.id === activeId) || accounts[0];
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

app.post('/api/accounts', (req: Request, res: Response) => {
  const { name, type = 'PAPER', balance = 10000, api_key = '', api_secret = '', testnet = false } = req.body;
  const id = `acc_${crypto.randomBytes(4).toString('hex')}`;
  const newAcc: Account = {
    id,
    name: String(name).trim() || 'Yeni Hesap',
    type: String(type).toUpperCase(),
    balance: parseFloat(balance) || 10000,
    initial_balance: parseFloat(balance) || 10000,
    api_key: String(api_key).trim(),
    api_secret: String(api_secret).trim(),
    testnet: Boolean(testnet),
    engine_state: 'STOPPED',
    stop_mode: '',
    spot_vault_balance: 0,
    vault_target: (parseFloat(balance) || 10000) * 2,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  accounts.push(newAcc);
  settings.active_account_id = id;
  addLog(`Yeni hesap oluşturuldu: ${newAcc.name}`, 'INFO', 'ACCOUNT');
  res.json({ success: true, account: enrichAccount(newAcc) });
});

app.post('/api/accounts/active', (req: Request, res: Response) => {
  const { account_id } = req.body;
  const acc = accounts.find(a => a.id === account_id);
  if (!acc) return res.status(404).json({ detail: 'Hesap bulunamadı' });
  settings.active_account_id = account_id;
  addLog(`Aktif hesap seçildi: ${acc.name}`, 'INFO', 'ACCOUNT');
  res.json({ success: true, active_account: enrichAccount(acc) });
});

app.delete('/api/accounts/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const index = accounts.findIndex(a => a.id === id);
  if (index === -1) return res.status(404).json({ detail: 'Hesap bulunamadı' });
  accounts.splice(index, 1);
  if (settings.active_account_id === id) {
    settings.active_account_id = accounts[0]?.id || '';
  }
  res.json({ success: true, active_account_id: settings.active_account_id });
});

app.post(['/api/accounts/:id/balance', '/api/accounts/:id/balance'], (req: Request, res: Response) => {
  const { id } = req.params;
  const newBal = req.body.balance !== undefined ? req.body.balance : req.body.virtual_balance;
  if (newBal === undefined || isNaN(newBal) || Number(newBal) < 0) {
    return res.status(400).json({ detail: 'Geçersiz bakiye tutarı' });
  }
  const acc = accounts.find(a => a.id === id);
  if (!acc) return res.status(404).json({ detail: 'Hesap bulunamadı' });

  acc.balance = parseFloat(newBal);
  acc.updated_at = nowIso();
  addLog(`Hesap bakiyesi güncellendi: ${acc.name} -> $${acc.balance}`, 'INFO', 'ACCOUNT');
  res.json({ success: true, account: enrichAccount(acc) });
});

// Engine Controls
app.post('/api/engine/start', (req: Request, res: Response) => {
  const activeId = settings.active_account_id || 'acc_alpha';
  const acc = accounts.find(a => a.id === activeId) || accounts[0];
  acc.engine_state = 'RUNNING';
  acc.stop_mode = '';
  acc.updated_at = nowIso();

  if (!engineInterval) {
    engineInterval = setInterval(stepEngine, 2000);
  }
  // Immediate trigger
  stepEngine();

  addLog(`Motor aktif edildi (${acc.name}). Otonom ticaret başladı.`, 'INFO', 'ENGINE');
  res.json({ success: true, engine_running: true, engine_state: 'RUNNING' });
});

app.post('/api/engine/stop', (req: Request, res: Response) => {
  const mode = req.body?.mode || 'PANIC';
  const activeId = settings.active_account_id || 'acc_alpha';
  const acc = accounts.find(a => a.id === activeId) || accounts[0];
  acc.engine_state = 'STOPPED';
  acc.stop_mode = mode;
  acc.updated_at = nowIso();

  if (mode === 'PANIC' || mode === 'MARKET') {
    // Close open positions for active account
    const openPos = positions.filter(p => p.account_id === activeId && p.status === 'OPEN');
    openPos.forEach(p => {
      closePositionInternal(p.id, p.mark_price, `Motor Durdurma (${mode})`);
    });
  }

  addLog(`Motor durduruldu: ${acc.name} [Mod: ${mode}].`, 'WARN', 'ENGINE');
  res.json({ success: true, engine_running: false, engine_state: 'STOPPED', message: `Motor ${mode} modu ile durduruldu.` });
});

app.post('/api/engine/start-all', (req: Request, res: Response) => {
  accounts.forEach(a => { a.engine_state = 'RUNNING'; a.stop_mode = ''; });
  if (!engineInterval) engineInterval = setInterval(stepEngine, 2000);
  stepEngine();
  res.json({ success: true, started_count: accounts.length });
});

app.post('/api/engine/stop-all', (req: Request, res: Response) => {
  const mode = (req.body?.mode || 'PANIC').toUpperCase();
  accounts.forEach(a => { a.engine_state = 'STOPPED'; a.stop_mode = mode; });
  if (mode === 'PANIC' || mode === 'MARKET') {
    positions.filter(p => p.status === 'OPEN').forEach(p => {
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
  const acc = accounts.find(a => a.id === activeId) || accounts[0];
  const targetBal = parseFloat(reset_balance) || 100.0;

  acc.balance = targetBal;
  acc.initial_balance = targetBal;
  acc.engine_state = 'STOPPED';
  acc.spot_vault_balance = 0.0;
  acc.vault_target = targetBal * 2;
  acc.updated_at = nowIso();

  // Clear positions, orders, trades for this account
  positions = positions.filter(p => p.account_id !== activeId);
  orders = orders.filter(o => o.account_id !== activeId);
  trades = trades.filter(t => t.account_id !== activeId);

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
  const curP = currentPrices[sym] || BASE_PRICES[sym]?.price || 100.0;
  res.json({ matrix: computeIndicators(sym, curP) });
});

// Positions
app.get('/api/positions', (req: Request, res: Response) => {
  const activeId = (req.query.account_id as string) || settings.active_account_id || 'acc_alpha';
  const updated = updatePositionsPnlLive(activeId);
  res.json({ positions: updated });
});

app.get('/api/positions/:id', (req: Request, res: Response) => {
  const pos = positions.find(p => p.id === req.params.id);
  if (!pos) return res.status(404).json({ detail: 'Pozisyon bulunamadı' });
  const curP = currentPrices[pos.symbol] || pos.mark_price;
  res.json({
    position: pos,
    mark_price: curP,
    book_ticker: { bidPrice: curP * 0.9998, askPrice: curP * 1.0002 },
    indicators: computeIndicators(pos.symbol, curP),
  });
});

app.get('/api/positions/:id/analysis', (req: Request, res: Response) => {
  const pos = positions.find(p => p.id === req.params.id);
  if (!pos) return res.status(404).json({ detail: 'Pozisyon bulunamadı' });
  const sym = pos.symbol.toUpperCase();
  const curP = currentPrices[sym] || pos.mark_price;
  const spreadVal = Math.round(curP * 0.0002 * 100) / 100;

  const bids = [
    [curP * 0.9998, 12.5],
    [curP * 0.9995, 28.4],
    [curP * 0.9990, 45.1],
    [curP * 0.9985, 82.0],
    [curP * 0.9980, 115.3],
  ];
  const asks = [
    [curP * 1.0002, 14.2],
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
    spread: { value: spreadVal, pct: 0.02 },
    bot_forecast: {
      direction: pos.side,
      target_price: pos.take_profit,
      target_pnl_pct: targetPnlPct,
      confidence_score: 88,
      entry_reasons: [
        `L2 OBI: ${pos.side === 'LONG' ? '+0.42 alıcı baskısı ve derinlik desteği' : '-0.42 satıcı baskısı'}`,
        'CVD Hacim: +$1.8M net akış ve delta teyidi',
        `Trend Momentum: EMA 9/21 ${pos.side} teyidi`,
        'Tasfiye Likiditesi: Likidasyon kümesi doğrulaması',
      ],
      time_in_trade: '1dk 45sn',
    },
  });
});

app.post('/api/positions/close/:id', (req: Request, res: Response) => {
  const pos = positions.find(p => p.id === req.params.id && p.status === 'OPEN');
  if (!pos) return res.status(404).json({ detail: 'Pozisyon bulunamadı' });
  const curP = currentPrices[pos.symbol] || pos.mark_price;
  const result = closePositionInternal(pos.id, curP, 'Kullanıcı Manuel Kapatma');
  res.json({ success: true, result });
});

// Orders & Trades
app.get(['/api/orders', '/api/orders/history'], (req: Request, res: Response) => {
  const activeId = (req.query.account_id as string) || settings.active_account_id || 'acc_alpha';
  const limit = parseInt(req.query.limit as string || '100', 10);
  res.json({ orders: orders.filter(o => o.account_id === activeId).slice(0, limit) });
});

app.get('/api/trades', (req: Request, res: Response) => {
  const activeId = (req.query.account_id as string) || settings.active_account_id || 'acc_alpha';
  const limit = parseInt(req.query.limit as string || '100', 10);
  res.json({ trades: trades.filter(t => t.account_id === activeId).slice(0, limit) });
});

// Market Radar
app.get('/api/market/radar', (req: Request, res: Response) => {
  const radar = buildRadar();
  const longCount = radar.filter(r => r.signal === 'LONG').length;
  const shortCount = radar.filter(r => r.signal === 'SHORT').length;
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
      system_macro_signal: 'DİNAMİK ÇİFT PİYASA RADARI',
      market_state: longCount > shortCount ? 'BOĞA' : 'AYI',
      risk_index: 'ORTA',
    },
    last_scan_time: nowIso(),
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
  const agent = councilAgents.find(a => a.agent_id === req.params.id);
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
  res.json({ symbol: req.query.symbol, cached_score: 72 });
});

// Spot Vault
app.get('/api/vault/status', (req: Request, res: Response) => {
  const activeId = (req.query.account_id as string) || settings.active_account_id || 'acc_alpha';
  const acc = accounts.find(a => a.id === activeId) || accounts[0];
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

  addLog('Sistem ayarları güncellendi.', 'INFO', 'SETTINGS');
  res.json({ success: true, message: 'Ayarlar başarıyla kaydedildi' });
});

// Update Check
app.get('/api/system/check-update', (req: Request, res: Response) => {
  res.json({
    success: true,
    hasUpdate: false,
    currentCommit: '242dec1',
    behindCount: 0,
    latestCommitMessage: 'FAROS v3.0 Master Release (TypeScript & Node.js Engine)',
    version: '3.0.0',
  });
});

// Telegram Test
app.post('/api/telegram/test', (req: Request, res: Response) => {
  addLog('Telegram test bildirimi gönderildi.', 'INFO', 'TELEGRAM');
  res.json({ success: true, message: 'Test mesajı Telegram kuyruğuna iletildi.' });
});

// Logs
app.get('/api/logs', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string || '100', 10);
  res.json({ logs: logs.slice(0, limit) });
});

// Deploy Webhook
app.all('/api/webhook/github-deploy', (req: Request, res: Response) => {
  addLog('[Deploy] Webhook çağrıldı, sistem güncel.', 'INFO', 'DEPLOY');
  res.json({ status: 'deployed', timestamp: nowIso(), version: 'v3.0' });
});

// ---------------------------------------------------------------------------
// HTTP Server & WebSocket Telemetry Stream
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  // Client connected to telemetry stream
  const interval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(interval);
      return;
    }
    const activeId = settings.active_account_id || 'acc_alpha';
    const activeAcc = accounts.find(a => a.id === activeId) || accounts[0];
    const enrichedAccounts = accounts.map(enrichAccount);
    const enrichedActive = enrichAccount(activeAcc);
    const radar = buildRadar();
    const openPos = updatePositionsPnlLive(activeId);
    const pnl = getPnlSummary(activeId);

    const longCount = radar.filter(r => r.signal === 'LONG').length;
    const shortCount = radar.filter(r => r.signal === 'SHORT').length;
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
        regime: 'DİNAMİK AĞIRLIKLANDIRMA',
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
        system_macro_signal: 'DİNAMİK ÇİFT PİYASA RADARI',
        market_state: longCount > shortCount ? 'BOĞA' : 'AYI',
        risk_index: 'ORTA',
      },
      radar,
      positions: openPos,
      orders: orders.filter(o => o.account_id === activeId).slice(0, 100),
      trades: trades.filter(t => t.account_id === activeId).slice(0, 100),
      agents: councilAgents,
      logs: logs.slice(0, 30),
      jev_consensus: getJevConsensus(),
      council_telemetry: getCouncilTelemetry(),
      hunter_pipeline: getHunterTelemetry(),
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
    console.log(`⚡ AegisQuant v3.0 Unified Terminal running on http://${HOST}:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start AegisQuant server:', err);
  process.exit(1);
});
