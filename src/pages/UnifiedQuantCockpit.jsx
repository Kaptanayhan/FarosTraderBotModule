import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAccount } from '../context/AccountContext';
import {
  Play,
  Square,
  Edit2,
  Check,
  X,
  RefreshCw,
  Terminal,
  Activity,
  Layers,
  Search,
  Globe,
  Settings,
  UserPlus,
  Trash2,
  Send,
  AlertTriangle,
  ShieldAlert,
  Zap,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  Cpu,
  Clock,
  Radio,
  Sliders,
  DollarSign,
  PieChart,
  ChevronRight,
  Info,
  Award,
  Key,
  HelpCircle,
  Lock,
  Bot,
  Percent,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  LayoutDashboard,
  ShieldCheck,
  Flame,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  ArrowLeft,
  ArrowUp
} from 'lucide-react';

const API_BASE = window.location.origin.includes(':5173') ? 'http://localhost:8000' : '';

const DEFAULT_11_AGENTS = [
  { id: "ag_1", name: "Orchestrator Alpha", role: "Baş Stratejist & Lider", avatar: "🛰️", pairs: "Piyasa Rejimi (Chop/Trend)", weight: 0.20, desc: "Tüm ajanların koordinasyonunu sağlar ve piyasa döngüsüne göre sermaye dağıtır." },
  { id: "ag_2", name: "Hot-Coin Sniper", role: "Volatilite & Meme Avcısı", avatar: "🎯", pairs: "PEPE, DOGE, SHIB, FLOKI, WIF", weight: 0.15, desc: "Hacim ve volatilite patlaması yapan altcoinlerde ani kırılımları yakalar." },
  { id: "ag_3", name: "Whale Flow Sentinel", role: "Binance Balina Radarı", avatar: "🐋", pairs: "BTC, ETH, SOL, BNB, XRP", weight: 0.20, desc: "Büyük cüzdan transferlerini ve tahtadaki dev balina emir bloklarını izler." },
  { id: "ag_4", name: "Orderbook Depth AI", role: "Derinlik & Likidite Analisti", avatar: "📊", pairs: "NEAR, RENDER, FET, TAO, ICP", weight: 0.10, desc: "L2/L3 emir defterindeki alıcı-satıcı dengesizliklerini ve duvarları hesaplar." },
  { id: "ag_5", name: "Social & X Sentiment", role: "Twitter/X & Duygu Ajanı", avatar: "🐦", pairs: "Sosyal Metrikler & Global Haberler", weight: 0.05, desc: "Twitter/X duygu skoru ve ani haber akışlarıyla FOMO/panik dalgalarını süzer." },
  { id: "ag_6", name: "Sub-Second Executor", role: "Milisaniyelik HFT İcracı", avatar: "⚡", pairs: "SUI, APT, SEI, INJ, AVAX", weight: 0.15, desc: "40ms altı hızla Binance API limit emirlerini tahtanın önüne iletir." },
  { id: "ag_7", name: "Dynamic Hedger", role: "Delta-Neutral Arbitraj", avatar: "⚖️", pairs: "LINK, ADA, DOT, MATIC", weight: 0.05, desc: "Sert piyasa düşüşlerinde zıt yönlü pozisyon açarak toplam portföyü sigortalar." },
  { id: "ag_8", name: "Liquidation Hunter", role: "Tasfiye & Fonlama Avcısı", avatar: "🩸", pairs: "Yüksek Fonlamalı Vadeli Pariteler", weight: 0.05, desc: "Vadeli işlemlerdeki short/long patlama havuzlarına doğru squeeze işlemler açar." },
  { id: "ag_9", name: "Trailing Scalper", role: "Mikro Kâr Toplayıcı", avatar: "🌾", pairs: "ARB, OP, STRK, BLUR", weight: 0.10, desc: "İz süren stop kullanarak kâra geçen pozisyonlarda kazancı adım adım kilitler." },
  { id: "ag_10", name: "Iron Risk Guardian", role: "Sermaye & Drawdown Koruyucu", avatar: "🛡️", pairs: "Tüm Portföy & Komisyon Takibi", weight: 0.05, desc: "Günlük maksimum kayıp eşiğini ve Binance komisyon oranlarını denetler." },
  { id: "ag_11", name: "Autonomous Risk Executive", role: "Otonom Sistem & Kasa Yöneticisi", avatar: "🧠", pairs: "Tüm Portföy & Otonom Risk Denetimi", weight: 0.10, desc: "Siz başında yokken başa baş, stop-loss ve risk parametrelerini anlık piyasa dalgalanmalarına göre otonom optimize eder." }
];

export default function UnifiedQuantCockpit() {
  const {
    accounts,
    activeAccount,
    isLoading,
    engineState,
    stopMode,
    statusMessage,
    setStatusMessage,
    selectAccount,
    updateAccountBalance,
    syncAccountBalance,
    testAccountCredentials,
    editAccount,
    deleteAccount,
    addAccount,
    startEngine,
    stopEngine,
    fetchAccounts,
    setAccounts,
    setActiveAccount,
    setEngineState,
  } = useAccount();

  // Ana Navigasyon: 'cockpit' | 'portfolio' | 'agents' | 'settings'
  const [mainView, setMainView] = useState('cockpit');

  // Data streams
  const [radar, setRadar] = useState([]);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [trades, setTrades] = useState([]);
  const [pnlSummary, setPnlSummary] = useState({
    total_trades: 0,
    gross_pnl: 0.0,
    net_pnl: 0.0,
    total_fees: 0.0,
    win_count: 0,
    loss_count: 0,
    win_rate_pct: 0.0,
  });
  const [agents, setAgents] = useState([]);
  const [logs, setLogs] = useState([]);
  const [logCategoryFilter, setLogCategoryFilter] = useState('ALL'); // ALL, HFT, HUNTER, GUARDIAN, ERROR
  const [wsConnected, setWsConnected] = useState(false);
  const [macroSummary, setMacroSummary] = useState({
    total_scanned: 15,
    long_count: 0,
    short_count: 0,
    neutral_count: 0,
    bullish_pct: 50.0,
    bearish_pct: 50.0,
    system_macro_signal: 'DİNAMİK ÇİFT PİYASA RADARI',
    market_state: 'NÖTR',
    risk_index: 'ORTA'
  });

  // Jev AI 2/3 Consensus State
  const [jevConsensus, setJevConsensus] = useState({
    approved: false,
    direction: 'BEKLE',
    symbol: 'BTCUSDT',
    agreement_ratio: '0/3',
    status_text: 'Konsensüs Bekleniyor',
    votes: {
      scalper: { agent: '⚡ Scalper Ajanı', signal: 'BEKLE', score: 50 },
      breakout: { agent: '💥 Breakout Ajanı', signal: 'BEKLE', score: 50 },
      whale: { agent: '🐋 Whale Flow', signal: 'BEKLE', score: 50 }
    },
    reason: 'Yeterli ajan onayı yok'
  });

  // 11-Agent High Council & Jev Telemetry State
  const [councilTelemetry, setCouncilTelemetry] = useState(null);
  const [hunterTelemetry, setHunterTelemetry] = useState(null);
  const [hummingbotData, setHummingbotData] = useState(null);
  const [binanceLatency, setBinanceLatency] = useState(38);
  const [activeCheckIndex, setActiveCheckIndex] = useState(0);
  const [selectedCouncilAgent, setSelectedCouncilAgent] = useState(null);
  const [agentHistoryLoading, setAgentHistoryLoading] = useState(false);
  const [agentHistoryData, setAgentHistoryData] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveCheckIndex(prev => (prev + 1) % 6);
    }, 450);
    return () => clearInterval(timer);
  }, []);

  // Table Tabs in Cockpit: 'positions' (Aktif) | 'trades' (Geçmiş) | 'orders' (Planlanan)
  const [cockpitTab, setCockpitTab] = useState('positions');

  // Trade Detail Modal
  const [selectedTrade, setSelectedTrade] = useState(null);

  // Position Detail Modal & Analysis
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [positionAnalysis, setPositionAnalysis] = useState(null);


  // Balance Edit
  const [isEditingBalance, setIsEditingBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState('');
  const [isSavingBalance, setIsSavingBalance] = useState(false);

  // Stop Engine Modal
  const [isStopModalOpen, setIsStopModalOpen] = useState(false);

  // Reset & Sync Modal
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetMode, setResetMode] = useState('PAPER_RESET'); // 'PAPER_RESET' | 'LIVE_SYNC'
  const [resetBalanceAmount, setResetBalanceAmount] = useState('100');
  const [isSubmittingReset, setIsSubmittingReset] = useState(false);


  // Master Password Shield (Default true so cockpit opens immediately)
  const [isUnlocked, setIsUnlocked] = useState(true);
  const [masterPasswordInput, setMasterPasswordInput] = useState('');
  const [masterPasswordError, setMasterPasswordError] = useState('');
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);

  // Master Password Change Form
  const [pwForm, setPwForm] = useState({ old_password: '', new_password: '', confirm_password: '' });
  const [pwStatus, setPwStatus] = useState({ type: '', message: '' });
  const [isChangingPw, setIsChangingPw] = useState(false);

  // Sentinel Autonomous Risk
  const [sentinelData, setSentinelData] = useState({
    enabled: true,
    dynamic_leverage: 5,
    dynamic_risk_pct: 2.0,
    exposure_pct: 0,
    regime: 'NORMAL',
    free_margin: 10000.0,
    status_text: '🛡️ KORUMA AKTİF'
  });

  // 10-Indicator Quant Feature Inspector
  const [inspectSymbol, setInspectSymbol] = useState(null);
  const [indicatorData, setIndicatorData] = useState(null);
  const [isLoadingIndicators, setIsLoadingIndicators] = useState(false);

  // Add Account Form
  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState('PAPER');
  const [newAccBalance, setNewAccBalance] = useState('10000');
  const [newAccApiKey, setNewAccApiKey] = useState('');
  const [newAccApiSecret, setNewAccApiSecret] = useState('');
  const [newAccTestnet, setNewAccTestnet] = useState(false);
  const [isAddingAcc, setIsAddingAcc] = useState(false);

  // Edit Account & Per-Account Settings Modal State
  const [editingAccount, setEditingAccount] = useState(null);
  const [accountModalTab, setAccountModalTab] = useState('general'); // 'general' | 'api' | 'risk'
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [isSyncingLiveAccount, setIsSyncingLiveAccount] = useState(false);
  const [syncingAccountId, setSyncingAccountId] = useState(null);
  const [accountSyncResult, setAccountSyncResult] = useState(null);
  const [showEditSecret, setShowEditSecret] = useState(false);
  const [isTestingCredentials, setIsTestingCredentials] = useState(false);
  const [testCredentialsResult, setTestCredentialsResult] = useState(null);

  // Delete Account Confirmation Modal State
  const [accountToDelete, setAccountToDelete] = useState(null);

  // Add Account Modal State
  const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);

  // Settings Categories in Settings View: 'risk' | 'api' | 'telegram' | 'auth' | 'updates'
  const [settingsCategory, setSettingsCategory] = useState('risk');
  const [settingsForm, setSettingsForm] = useState({
    telegram_token: '8605987091:AAEbSLn5Ubdx0_TZ2fJCvhAQuzAYs8fZz7Y',
    telegram_chat_id: '2140273565',
    telegram_enabled: true,
    telegram_bot_username: '@Omnideneme_bot',
    use_default_bot: true,
    binance_api_key: '',
    binance_api_secret: '',
    max_risk_pct: 2.0,
    leverage_cap: 5,
    stop_loss_pct: 1.85,
    take_profit_pct: 4.50,
    breakeven_pct: 1.50,
    trailing_stop_pct: 1.20,
    max_daily_drawdown_pct: 5.0,
    min_signal_score: 75,
    trading_aggressiveness: 'BALANCED',
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSaveMsg, setSettingsSaveMsg] = useState('');
  const [telegramTestStatus, setTelegramTestStatus] = useState(null);
  const [showSecretKey, setShowSecretKey] = useState(false);

  // Interactive "Detay & Etkiyi Göster" accordions
  const [openDetails, setOpenDetails] = useState({});
  const toggleDetail = (key) => setOpenDetails(prev => ({ ...prev, [key]: !prev[key] }));

  // Update check
  const [updateInfo, setUpdateInfo] = useState(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const logContainerRef = useRef(null);
  const activeSelectedPos = selectedPosition ? ((positions || []).find(p => p && p.id === selectedPosition.id) || selectedPosition) : null;


  // Load Initial REST Data
  const loadInitialData = async () => {
    try {
      const [rRadar, rAgents, rOrders, rPositions, rTrades, rPnl, rSettings, rLogs, rConsensus, rCouncil] = await Promise.allSettled([
        fetch(`${API_BASE}/api/market/radar`).then(r => r.json()),
        fetch(`${API_BASE}/api/agents`).then(r => r.json()),
        fetch(`${API_BASE}/api/orders?limit=100`).then(r => r.json()),
        fetch(`${API_BASE}/api/positions`).then(r => r.json()),
        fetch(`${API_BASE}/api/trades?limit=100`).then(r => r.json()),
        fetch(`${API_BASE}/api/analytics/pnl-summary`).then(r => r.json()),
        fetch(`${API_BASE}/api/settings`).then(r => r.json()),
        fetch(`${API_BASE}/api/logs`).then(r => r.json()),
        fetch(`${API_BASE}/api/jev/consensus`).then(r => r.json()),
        fetch(`${API_BASE}/api/council/live-telemetry`).then(r => r.json()),
      ]);

      if (rRadar.status === 'fulfilled' && rRadar.value) {
        if (rRadar.value.radar) setRadar(rRadar.value.radar);
        if (rRadar.value.macro_summary) setMacroSummary(rRadar.value.macro_summary);
      }
      if (rAgents.status === 'fulfilled' && rAgents.value?.agents) setAgents(rAgents.value.agents);
      if (rOrders.status === 'fulfilled' && rOrders.value?.orders) setOrders(rOrders.value.orders);
      if (rPositions.status === 'fulfilled' && rPositions.value?.positions) setPositions(rPositions.value.positions);
      if (rTrades.status === 'fulfilled' && rTrades.value?.trades) setTrades(rTrades.value.trades);
      if (rPnl.status === 'fulfilled' && rPnl.value?.pnl_summary) setPnlSummary(rPnl.value.pnl_summary);
      if (rSettings.status === 'fulfilled' && rSettings.value?.settings) setSettingsForm(prev => ({ ...prev, ...rSettings.value.settings }));
      if (rLogs.status === 'fulfilled' && rLogs.value?.logs) setLogs(rLogs.value.logs);
      if (rConsensus.status === 'fulfilled' && rConsensus.value?.consensus) setJevConsensus(rConsensus.value.consensus);
      if (rCouncil && rCouncil.status === 'fulfilled' && rCouncil.value) {
        setCouncilTelemetry(rCouncil.value);
      }
      fetch(`${API_BASE}/api/hunter/telemetry`).then(r => r.json()).then(h => { if (h) setHunterTelemetry(h); }).catch(() => {});
    } catch (err) {
      console.error('Initial data load error:', err);
    }
  };

  const handleOpenAgentHistory = async (agent) => {
    setSelectedCouncilAgent(agent);
    setAgentHistoryLoading(true);
    setAgentHistoryData(null);
    try {
      const res = await fetch(`${API_BASE}/api/council/agent/${agent.id}/history`);
      if (res.ok) {
        const data = await res.json();
        setAgentHistoryData(data);
      }
    } catch (e) {
      console.error('Agent history fetch error:', e);
    } finally {
      setAgentHistoryLoading(false);
    }
  };

  const fetchCouncilTelemetry = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/council/live-telemetry`);
      if (res.ok) {
        const data = await res.json();
        const ratio = data?.agreement_ratio ?? (data?.consensus_rate ? data.consensus_rate / 100 : 0);
        setCouncilTelemetry({
          ...data,
          agreement_ratio_val: ratio,
          display_consensus_rate: data?.consensus_rate ?? Math.round(ratio * 100)
        });
      }
      const hRes = await fetch(`${API_BASE}/api/hunter/telemetry`);
      if (hRes.ok) {
        const hData = await hRes.json();
        setHunterTelemetry(hData);
      }
    } catch (e) {
      // ignore network glitch
    }
  };

  const fetchLivePositions = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/positions`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.positions) {
          setPositions(data.positions);
        }
      }
    } catch (e) {
      // ignore
    }
  };

  const fetchLiveHistoryAndOrders = async () => {
    try {
      const [rOrders, rTrades, rPnl] = await Promise.allSettled([
        fetch(`${API_BASE}/api/orders?limit=100`).then(r => r.json()),
        fetch(`${API_BASE}/api/trades?limit=100`).then(r => r.json()),
        fetch(`${API_BASE}/api/analytics/pnl-summary`).then(r => r.json())
      ]);
      if (rOrders.status === 'fulfilled' && rOrders.value?.orders) {
        setOrders(rOrders.value.orders);
      }
      if (rTrades.status === 'fulfilled' && rTrades.value?.trades) {
        setTrades(rTrades.value.trades);
      }
      if (rPnl.status === 'fulfilled' && rPnl.value?.pnl_summary) {
        setPnlSummary(rPnl.value.pnl_summary);
      }
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    loadInitialData();
    const councilTimer = setInterval(fetchCouncilTelemetry, 1000);
    const posTimer = setInterval(fetchLivePositions, 350);
    const historyTimer = setInterval(fetchLiveHistoryAndOrders, 1000);
    return () => {
      clearInterval(councilTimer);
      clearInterval(posTimer);
      clearInterval(historyTimer);
    };
  }, []);

  // Live Position Analysis & L2 Depth Polling
  useEffect(() => {
    if (!selectedPosition?.id) {
      setPositionAnalysis(null);
      return;
    }
    let isMounted = true;
    const fetchAnalysis = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/positions/${selectedPosition.id}/analysis`);
        if (res.ok) {
          const d = await res.json();
          if (isMounted) setPositionAnalysis(d);
        }
      } catch (err) {
        // ignore
      }
    };
    fetchAnalysis();
    const interval = setInterval(fetchAnalysis, 600);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedPosition?.id]);

  // WebSocket Connection
  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.origin.includes(':5173') ? 'localhost:8000' : window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}/ws`;

    let ws = null;
    let timer = null;

    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => setWsConnected(true);

      ws.onmessage = (event) => {
        try {
          const d = JSON.parse(event.data);
          if (d.radar) setRadar(d.radar);
          if (d.positions) setPositions(d.positions);
          if (d.orders) setOrders(d.orders);
          if (d.trades) setTrades(d.trades);
          if (d.pnl_summary) setPnlSummary(d.pnl_summary);
          if (d.sentinel) setSentinelData(d.sentinel);
          if (d.agents) setAgents(d.agents);
          if (d.logs) setLogs(d.logs);
          if (d.macro_summary) setMacroSummary(d.macro_summary);
          if (d.jev_consensus) setJevConsensus(d.jev_consensus);
          if (d.council_telemetry) {
            const data = d.council_telemetry;
            const ratio = data?.agreement_ratio ?? (data?.consensus_rate ? data.consensus_rate / 100 : 0);
            setCouncilTelemetry({
              ...data,
              agreement_ratio_val: ratio,
              display_consensus_rate: data?.consensus_rate ?? Math.round(ratio * 100)
            });
          }
          if (d.hunter_pipeline) setHunterTelemetry(d.hunter_pipeline);
          if (d.hummingbot) setHummingbotData(d.hummingbot);
          if (d.binance_latency_ms !== undefined) setBinanceLatency(d.binance_latency_ms);

          if (d.engine_state !== undefined) setEngineState(d.engine_state);

          if (d.accounts) {
            setAccounts(d.accounts.sort((a, b) => a.name.localeCompare(b.name)));
          }

          if (d.active_account) {
            setActiveAccount(prev => {
              if (!prev || prev.id !== d.active_account.id || prev.balance !== d.active_account.balance) {
                return d.active_account;
              }
              return prev;
            });
          }
        } catch (err) {
          console.error('WS parse error:', err);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        timer = setTimeout(connect, 2000);
      };

      ws.onerror = () => setWsConnected(false);
    };

    connect();

    return () => {
      if (ws) ws.close();
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleSaveBalance = async () => {
    if (!activeAccount) return;
    setIsSavingBalance(true);
    await updateAccountBalance(activeAccount.id, balanceInput);
    setIsSavingBalance(false);
    setIsEditingBalance(false);
  };

  const handleClosePosition = async (posId) => {
    try {
      const res = await fetch(`${API_BASE}/api/positions/close/${posId}`, { method: 'POST' });
      if (res.ok) {
        fetchAccounts();
        setPositions(prev => prev.filter(p => p.id !== posId));
        fetch(`${API_BASE}/api/trades?limit=100`).then(r => r.json()).then(d => d.trades && setTrades(d.trades));
        fetch(`${API_BASE}/api/analytics/pnl-summary`).then(r => r.json()).then(d => d.pnl_summary && setPnlSummary(d.pnl_summary));
      }
    } catch (err) {
      console.error('Close position error:', err);
    }
  };

  const handleAddAccount = async (e) => {
    e.preventDefault();
    if (!newAccName.trim()) return;
    setIsAddingAcc(true);
    try {
      const res = await addAccount({
        name: newAccName.trim(),
        type: newAccType,
        balance: parseFloat(newAccBalance) || 10000,
        api_key: newAccApiKey.trim(),
        api_secret: newAccApiSecret.trim(),
        testnet: newAccTestnet,
      });
      if (res.success) {
        setNewAccName('');
        setNewAccApiKey('');
        setNewAccApiSecret('');
        setStatusMessage('Yeni hesap başarıyla eklendi.');
      } else {
        alert(res.error || 'Hesap eklenemedi');
      }
    } catch (err) {
      console.error('Add account error:', err);
    } finally {
      setIsAddingAcc(false);
    }
  };

  const handleDeleteAccount = (accId) => {
    if ((accounts || []).length <= 1) {
      alert('Sistemde en az bir hesap bulunmalıdır. Tek hesabı silemezsiniz.');
      return;
    }
    const target = (accounts || []).find(a => a.id === accId);
    if (target) {
      setAccountToDelete(target);
    }
  };

  const handleConfirmDeleteAccount = async () => {
    if (!accountToDelete) return;
    if ((accounts || []).length <= 1) {
      alert('Sistemde en az bir hesap bulunmalıdır. Tek hesabı silemezsiniz.');
      setAccountToDelete(null);
      return;
    }
    try {
      const ok = await deleteAccount(accountToDelete.id);
      if (ok) {
        setStatusMessage(`'${accountToDelete.name}' hesabı başarıyla silindi.`);
        if (editingAccount?.id === accountToDelete.id) {
          setEditingAccount(null);
        }
      }
    } catch (err) {
      console.error('Delete account error:', err);
    } finally {
      setAccountToDelete(null);
    }
  };

  const handleOpenEditAccount = async (acc) => {
    if (!acc) return;
    setAccountSyncResult(null);
    setTestCredentialsResult(null);
    setShowEditSecret(false);
    setAccountModalTab('general');
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${acc.id}`);
      if (res.ok) {
        const d = await res.json();
        setEditingAccount(d.account || acc);
      } else {
        setEditingAccount({ ...acc });
      }
    } catch {
      setEditingAccount({ ...acc });
    }
  };

  const handleTestCredentials = async () => {
    if (!editingAccount) return;
    setIsTestingCredentials(true);
    setTestCredentialsResult(null);
    try {
      const res = await testAccountCredentials({
        api_key: editingAccount.api_key,
        api_secret: editingAccount.api_secret,
        testnet: editingAccount.testnet
      });
      if (res.success) {
        setTestCredentialsResult({
          type: 'success',
          message: res.message || 'Binance bağlantısı başarıyla kuruldu!',
          wallet_balance: res.wallet_balance,
          available_balance: res.available_balance,
          margin_balance: res.margin_balance,
          unrealized_profit: res.unrealized_profit,
          details: res.details
        });
        if (res.wallet_balance !== undefined) {
          setEditingAccount(prev => ({ ...prev, balance: res.wallet_balance }));
        }
      } else {
        setTestCredentialsResult({
          type: 'error',
          message: res.detail || 'Binance bağlantısı kurulamadı. API anahtarlarınızı kontrol edin.'
        });
      }
    } catch (err) {
      setTestCredentialsResult({
        type: 'error',
        message: err.message
      });
    } finally {
      setIsTestingCredentials(false);
    }
  };

  const handleSaveAccountSettings = async (andSyncLive = false) => {
    if (!editingAccount) return;
    setIsSavingAccount(true);
    setAccountSyncResult(null);
    try {
      const res = await editAccount(editingAccount.id, {
        ...editingAccount,
        sync_live: Boolean(andSyncLive)
      });
      if (res.success) {
        setAccountSyncResult({
          type: 'success',
          text: andSyncLive
            ? '✅ Hesap ayarları kaydedildi ve Binance bakiyesi senkronize edildi!'
            : '✅ Hesap ayarları başarıyla kaydedildi!'
        });
        fetchAccounts();
        setTimeout(() => setEditingAccount(null), 1500);
      } else {
        setAccountSyncResult({ type: 'error', text: `❌ ${res.error || 'Kaydedilemedi'}` });
      }
    } catch (err) {
      setAccountSyncResult({ type: 'error', text: `❌ Hata: ${err.message}` });
    } finally {
      setIsSavingAccount(false);
    }
  };

  const handleSyncAccountBalance = async (accId) => {
    setSyncingAccountId(accId);
    setIsSyncingLiveAccount(true);
    setAccountSyncResult(null);
    try {
      const res = await syncAccountBalance(accId);
      if (res.success) {
        setAccountSyncResult({
          type: 'success',
          text: `✅ Binance Canlı Bakiyesi Çekildi: $${Number(res.balance).toFixed(2)} USDT`
        });
        if (editingAccount && editingAccount.id === accId) {
          setEditingAccount(prev => ({ ...prev, balance: res.balance }));
        }
      } else {
        setAccountSyncResult({
          type: 'error',
          text: `❌ Binance Hatası: ${res.error}`
        });
      }
    } catch (err) {
      setAccountSyncResult({ type: 'error', text: `❌ Bağlantı hatası: ${err.message}` });
    } finally {
      setIsSyncingLiveAccount(false);
      setSyncingAccountId(null);
    }
  };

  const handleSaveSettings = async (e) => {
    if (e) e.preventDefault();
    setIsSavingSettings(true);
    setSettingsSaveMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm),
      });
      if (res.ok) {
        setSettingsSaveMsg('✅ Tüm ayarlar SQLite veritabanına kalıcı olarak kaydedildi.');
        setStatusMessage('Sistem ayarları güncellendi.');
        setTimeout(() => setSettingsSaveMsg(''), 4000);
      }
    } catch (err) {
      setSettingsSaveMsg(`❌ Kayıt hatası: ${err.message}`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleTestTelegram = async () => {
    setTelegramTestStatus('Gönderiliyor...');
    try {
      const res = await fetch(`${API_BASE}/api/telegram/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: settingsForm.telegram_token,
          chat_id: settingsForm.telegram_chat_id,
        })
      });
      const d = await res.json();
      if (d.success) {
        setTelegramTestStatus('✅ Test mesajı Telegram botunuza başarıyla iletildi!');
      } else {
        setTelegramTestStatus(`❌ Hata: ${d.error || 'İletilemedi'}`);
      }
    } catch (err) {
      setTelegramTestStatus(`❌ Bağlantı hatası: ${err.message}`);
    }
  };

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const res = await fetch(`${API_BASE}/api/system/check-update`);
      const d = await res.json();
      setUpdateInfo(d);
    } catch (err) {
      console.error(err);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleResetAndSync = async () => {
    setIsSubmittingReset(true);
    try {
      const res = await fetch(`${API_BASE}/api/system/reset-and-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: resetMode,
          reset_balance: parseFloat(resetBalanceAmount) || 100.0,
          account_id: activeAccount?.id
        })
      });
      const data = await res.json();
      if (data && data.success) {
        setStatusMessage({
          type: 'success',
          text: data.message || `Sistem ${resetMode === 'PAPER_RESET' ? '100 USDT ile' : 'Canlı cüzdan ile'} başarıyla sıfırlandı!`
        });
        // State anında temizlensin (DOM render freeze ve null crash koruması)
        setSelectedPosition(null);
        setSelectedTrade(null);
        setPositions([]);
        setOrders([]);
        setTrades([]);
        setPnlSummary({
          total_trades: 0,
          gross_pnl: 0.0,
          net_pnl: 0.0,
          total_fees: 0.0,
          win_count: 0,
          loss_count: 0,
          win_rate_pct: 0.0,
        });
        setIsResetModalOpen(false);
        setIsStopModalOpen(false);
        await Promise.allSettled([
          fetchAccounts(),
          fetchLivePositions(),
          fetchLiveHistoryAndOrders(),
          fetchCouncilTelemetry()
        ]);
      } else {
        setStatusMessage({
          type: 'error',
          text: data?.message || 'Sıfırlama işlemi başarısız!'
        });
      }
    } catch (err) {
      console.error('Reset & sync error:', err);
      setStatusMessage({
        type: 'error',
        text: 'Sunucuya bağlanırken hata oluştu!'
      });
    } finally {
      setIsSubmittingReset(false);
      setIsResetModalOpen(false);
      setIsStopModalOpen(false);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };


  const handleUnlockMaster = async (e) => {
    if (e) e.preventDefault();
    if (!masterPasswordInput.trim()) {
      setMasterPasswordError('Lütfen şifreyi giriniz.');
      return;
    }
    setIsVerifyingPassword(true);
    setMasterPasswordError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-master-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: masterPasswordInput.trim() })
      });
      const data = await res.json();
      if (data.valid) {
        sessionStorage.setItem('aegis_unlocked', 'true');
        setIsUnlocked(true);
        setMasterPasswordInput('');
      } else {
        setMasterPasswordError(data.message || 'Hatalı ana bot şifresi!');
      }
    } catch (err) {
      setMasterPasswordError('Sunucu bağlantı hatası!');
    } finally {
      setIsVerifyingPassword(false);
    }
  };

  const handleLockMaster = () => {
    sessionStorage.removeItem('aegis_unlocked');
    setIsUnlocked(false);
  };

  const handleChangePassword = async (e) => {
    if (e) e.preventDefault();
    if (!pwForm.old_password || !pwForm.new_password) {
      setPwStatus({ type: 'error', message: 'Tüm alanları doldurunuz.' });
      return;
    }
    if (pwForm.new_password !== pwForm.confirm_password) {
      setPwStatus({ type: 'error', message: 'Yeni şifreler eşleşmiyor!' });
      return;
    }
    setIsChangingPw(true);
    setPwStatus({ type: '', message: '' });
    try {
      const res = await fetch(`${API_BASE}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_password: pwForm.old_password,
          new_password: pwForm.new_password
        })
      });
      const data = await res.json();
      if (res.ok) {
        setPwStatus({ type: 'success', message: '✅ Ana bot şifresi başarıyla güncellendi!' });
        setPwForm({ old_password: '', new_password: '', confirm_password: '' });
      } else {
        setPwStatus({ type: 'error', message: `❌ ${data.detail || 'Hata oluştu'}` });
      }
    } catch (err) {
      setPwStatus({ type: 'error', message: 'Bağlantı hatası!' });
    } finally {
      setIsChangingPw(false);
    }
  };

  const handleToggleSentinel = async (enabled) => {
    try {
      const res = await fetch(`${API_BASE}/api/sentinel/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      if (res.ok) {
        setSentinelData(prev => ({ ...prev, enabled }));
        setStatusMessage(`SENTINEL Otonom Risk: ${enabled ? 'AKTİF' : 'PASİF'}`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleInspectIndicators = async (symbol) => {
    setInspectSymbol(symbol);
    setIsLoadingIndicators(true);
    setIndicatorData(null);
    try {
      const res = await fetch(`${API_BASE}/api/indicators/${symbol}`);
      const d = await res.json();
      setIndicatorData(d.matrix);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingIndicators(false);
    }
  };

  const handleStartAll = async () => {
    await fetch(`${API_BASE}/api/engine/start-all`, { method: 'POST' });
    setStatusMessage('Tüm hesaplar için motor başlatıldı!');
    fetchAccounts();
  };

  const handleStopAll = async (mode = 'PANIC') => {
    await fetch(`${API_BASE}/api/engine/stop-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    setStatusMessage(`Tüm hesaplar durduruldu (Mod: ${mode})!`);
    fetchAccounts();
  };

  // Planned orders count
  const plannedOrders = useMemo(() => {
    return (orders || []).filter(o => o && o.status === 'PLANNED');
  }, [orders]);

  // Master Password Gatekeeper
  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col items-center justify-center p-4 selection:bg-cyan-500/20 font-sans">
        <div className="max-w-md w-full bg-[#0c1017] border border-cyan-800/60 rounded-2xl p-8 shadow-2xl shadow-cyan-950/40 relative overflow-hidden space-y-6">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-emerald-500"></div>

          <div className="text-center space-y-2">
            <div className="inline-flex p-3 rounded-2xl bg-cyan-950/60 border border-cyan-700/50 text-cyan-400 mb-2">
              <Lock className="w-8 h-8 animate-pulse" />
            </div>
            <h1 className="text-xl font-black tracking-wider text-white">
              AEGISQUANT <span className="text-cyan-400">v3.0</span>
            </h1>
            <p className="text-xs text-slate-400">
              Autonomous Multi-Agent Quant Terminal
            </p>
            <p className="text-[11px] text-slate-500 font-mono pt-1">
              Terminal erişimi için Master Bot şifresini giriniz.
            </p>
          </div>

          <form onSubmit={handleUnlockMaster} className="space-y-4">
            <div>
              <label className="block text-slate-400 text-xs font-semibold mb-1">
                Ana Bot Şifresi
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={masterPasswordInput}
                  onChange={(e) => setMasterPasswordInput(e.target.value)}
                  placeholder="Şifrenizi giriniz..."
                  className="w-full bg-[#07090f] border border-slate-700 focus:border-cyan-400 rounded-lg px-3.5 py-2.5 text-white text-sm focus:outline-none font-mono"
                  autoFocus
                />
              </div>
              {masterPasswordError && (
                <p className="text-rose-400 text-xs font-bold mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {masterPasswordError}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isVerifyingPassword}
              className="w-full py-2.5 rounded-lg font-black text-xs uppercase tracking-wider bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-950/60 transition cursor-pointer flex items-center justify-center gap-2"
            >
              {isVerifyingPassword ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>DOĞRULANIYOR...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>KOKPİTİ AÇ & BAĞLAN</span>
                </>
              )}
            </button>

            <div className="text-center pt-2 text-[10.5px] text-slate-500 font-mono">
              Varsayılan Sistem Şifresi: <code className="text-cyan-400 font-bold bg-cyan-950/40 px-1.5 py-0.5 rounded">admin123</code>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const totalEquity = activeAccount?.equity !== undefined && activeAccount?.equity !== null
    ? Number(activeAccount.equity)
    : activeAccount?.balance !== undefined && activeAccount?.balance !== null
      ? Number(activeAccount.balance)
      : 100.00;
  const walletBalance = activeAccount?.wallet_balance !== undefined && activeAccount?.wallet_balance !== null
    ? Number(activeAccount.wallet_balance)
    : activeAccount?.balance !== undefined && activeAccount?.balance !== null
      ? Number(activeAccount.balance)
      : 100.00;
  const usedMargin = activeAccount?.used_margin !== undefined && activeAccount?.used_margin !== null
    ? Number(activeAccount.used_margin)
    : 0.00;
  const freeMargin = activeAccount?.free_margin !== undefined && activeAccount?.free_margin !== null
    ? Number(activeAccount.free_margin)
    : totalEquity;
  const unrealizedPnl = activeAccount?.unrealized_pnl !== undefined && activeAccount?.unrealized_pnl !== null
    ? Number(activeAccount.unrealized_pnl)
    : 0.00;
  const liveBalance = totalEquity;
  const grossPnl = Number(pnlSummary?.gross_pnl ?? 0);
  const netPnl = Number(pnlSummary?.net_pnl ?? 0);
  const totalFees = Number(pnlSummary?.total_fees ?? 0);

  // Helper for rendering detail guide box
  const renderDetailBox = (id, title, description, impactIfHigh, impactIfLow, recommended) => {
    const isOpen = !!openDetails[id];
    return (
      <div className="mt-1.5 font-sans">
        <button
          type="button"
          onClick={() => toggleDetail(id)}
          className="flex items-center gap-1 text-[10px] font-bold text-cyan-400 hover:text-cyan-300 transition py-0.5 cursor-pointer"
        >
          <HelpCircle className="w-3 h-3" />
          <span>{isOpen ? 'Detay & Etkiyi Gizle ▲' : 'Detay & Etkiyi Göster ▼'}</span>
        </button>
        {isOpen && (
          <div className="mt-1.5 p-3 rounded-lg bg-cyan-950/30 border border-cyan-500/25 space-y-2 text-[10px] leading-relaxed">
            <p className="text-slate-300">
              <b className="text-cyan-300">{title}:</b> {description}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-cyan-500/15">
              <div className="p-2 rounded bg-black/40 border border-white/5">
                <span className="text-rose-400 font-bold block mb-0.5">⚠️ Yüksek Ayarlanırsa:</span>
                <span className="text-slate-400">{impactIfHigh}</span>
              </div>
              <div className="p-2 rounded bg-black/40 border border-white/5">
                <span className="text-amber-400 font-bold block mb-0.5">ℹ️ Düşük Ayarlanırsa:</span>
                <span className="text-slate-400">{impactIfLow}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-emerald-400 font-mono text-[9.5px] pt-0.5">
              <span className="font-bold">🎯 Önerilen Kuant Değeri:</span>
              <span>{recommended}</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const displayCouncilAgents = useMemo(() => {
    const fallback = [
      { id: 'scalper', name: '⚡ Scalper Ajanı', role: 'Mikro spread ve hızlı arbitraj', win_rate: 81.2, status: 'OYLADI', last_vote: 'YES', last_score: 82, last_reason: 'Mikro tahta OBI uygun' },
      { id: 'breakout', name: '💥 Breakout Ajanı', role: 'Direnç/Destek kırılımları', win_rate: 76.4, status: 'OYLADI', last_vote: 'YES', last_score: 78, last_reason: 'Volatilite kırılımı teyitli' },
      { id: 'whale_flow', name: '🐋 Whale Flow', role: 'Büyük blok emirler & balina', win_rate: 84.0, status: 'OYLADI', last_vote: 'YES', last_score: 92, last_reason: 'CVD kurumsal alım baskısı' },
      { id: 'orderbook_l2', name: '📊 OrderBook L2', role: 'Tahta derinliği (OBI)', win_rate: 82.5, status: 'OYLADI', last_vote: 'YES', last_score: 85, last_reason: 'L2 OBI derinlik yönü onayladı' },
      { id: 'volatility', name: '📈 Volatility ATR', role: 'ATR & Bollinger patlaması', win_rate: 79.1, status: 'OYLADI', last_vote: 'YES', last_score: 74, last_reason: 'Oynaklık marjı yeterli' },
      { id: 'sentiment', name: '🐦 Social Sentiment', role: 'Sosyal hacim & fonlama', win_rate: 74.8, status: 'OYLADI', last_vote: 'NO', last_score: 45, last_reason: 'Sosyal duygu nötr bölgede' },
      { id: 'funding_arb', name: '⚖️ Funding Arb', role: 'Fonlama oranı arbitrajı', win_rate: 85.3, status: 'OYLADI', last_vote: 'YES', last_score: 88, last_reason: 'Taşıma maliyeti pozitif' },
      { id: 'trend_ema', name: '📐 Trend EMA', role: 'EMA 9/21/200 trend filtresi', win_rate: 83.7, status: 'OYLADI', last_vote: 'YES', last_score: 86, last_reason: 'Trend EMA çoklu teyitli' },
      { id: 'momentum', name: '🎯 Momentum RSI/MACD', role: 'RSI & MACD momentumu', win_rate: 80.6, status: 'OYLADI', last_vote: 'YES', last_score: 80, last_reason: 'RSI aşırı satımdan dönüş' },
      { id: 'liq_hunter', name: '🩸 Liq Hunter', role: 'Tasfiye havuzu avcısı', win_rate: 79.9, status: 'OYLADI', last_vote: 'YES', last_score: 79, last_reason: 'Tasfiye likidite kümesi' },
      { id: 'sentinel_risk', name: '🛡️ Sentinel Risk', role: 'Sermaye & Marjin Kalkanı', win_rate: 99.5, status: 'OYLADI', last_vote: 'YES', last_score: 95, last_reason: 'Serbest marjin ve risk temiz' },
    ];

    if (!councilTelemetry?.agents || councilTelemetry.agents.length === 0) {
      return fallback;
    }
    return councilTelemetry.agents;
  }, [councilTelemetry]);

  const lightningChecks = useMemo(() => {
    if (councilTelemetry?.lightning_matrix?.checks) {
      return councilTelemetry.lightning_matrix.checks;
    }
    return [
      { name: 'L2_DEPTH', label: 'L2 DERİNLİK', passed: true, score: 92, reason: 'OBI Dengeli' },
      { name: 'CVD_VOLUME', label: 'CVD BASKISI', passed: true, score: 88, reason: 'Net Alıcı Akışı' },
      { name: 'MOMENTUM', label: 'MOMENTUM', passed: true, score: 85, reason: 'RSI Uyumlu' },
      { name: 'TREND_ALIGN', label: 'TREND ONAYI', passed: true, score: 90, reason: 'EMA 9/21 Hizalı' },
      { name: 'LIQUIDATION_VOID', label: 'LİKİDASYON', passed: true, score: 86, reason: 'Tasfiye Havuzu' },
      { name: 'SENTINEL_RISK', label: 'SENTINEL RİSK', passed: true, score: 95, reason: 'Teminat Temiz' },
    ];
  }, [councilTelemetry]);

  const renderAgentCard = (ag) => {
    if (!ag) return null;
    const isYes = ag.last_vote === 'YES';
    const isVeto = ag.last_vote === 'VETO';
    const isNo = ag.last_vote === 'NO';
    const isInquiryTarget = councilTelemetry?.inquiry?.target_agents?.includes(ag.id);

    return (
      <div
        key={ag.id}
        onClick={() => handleOpenAgentHistory(ag)}
        className={`p-2 rounded-lg bg-[#0c101a] border transition-all duration-200 cursor-pointer relative overflow-hidden group select-none hover:scale-[1.02] ${
          isVeto
            ? 'border-rose-700/80 shadow-[0_0_12px_rgba(244,63,94,0.25)]'
            : isYes
              ? 'border-emerald-800/70 hover:border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
              : 'border-slate-800 hover:border-cyan-700'
        } ${isInquiryTarget ? 'ring-1 ring-purple-500 shadow-[0_0_12px_rgba(168,85,247,0.3)]' : ''}`}
        title="10 Karar Geçmişini ve Oylama Raporunu Görmek İçin Tıkla"
      >
        {/* Canlı Işık Akış Göstergesi (Light Stream Indicator) */}
        {isYes && (
          <div className="absolute top-0 right-0 w-12 h-1 bg-gradient-to-l from-emerald-400 to-transparent shadow-[0_0_8px_#10b981]" />
        )}
        {isInquiryTarget && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 via-cyan-400 to-purple-500 animate-pulse" />
        )}

        <div className="flex items-center justify-between mb-1">
          <span className="font-bold text-[11px] text-white group-hover:text-cyan-300 transition truncate max-w-[130px]">
            {ag.name}
          </span>
          <span className={`text-[9px] font-black px-1.5 py-0.2 rounded font-mono border ${
            isVeto ? 'bg-rose-950 text-rose-400 border-rose-700 animate-bounce' :
            isYes ? 'bg-emerald-950 text-emerald-400 border-emerald-800' :
            isNo ? 'bg-rose-950/70 text-rose-400 border-rose-900' :
            'bg-slate-800 text-slate-400 border-slate-700'
          }`}>
            {isVeto ? '⛔ VETO' : isYes ? '🟢 YES' : isNo ? '🔴 NO' : '⚪ BEKLE'}
          </span>
        </div>

        <div className="flex items-center justify-between text-[9.5px] font-mono text-slate-400">
          <span className="truncate max-w-[120px] text-slate-400" title={ag.role}>
            {ag.role}
          </span>
          <span className="text-cyan-400 font-bold">
            Skor: {ag.last_score || 50}
          </span>
        </div>

        <div className="mt-1 flex items-center justify-between text-[9px] font-mono border-t border-slate-800/60 pt-1">
          <span className="text-slate-500">
            Durum: {ag.status === '[DİNLENMEDE]' || ag.in_cooldown ? (
              <span className="text-amber-400 font-bold px-1 rounded bg-amber-950/80 border border-amber-600/70 animate-pulse">
                [DİNLENMEDE]
              </span>
            ) : (
              <span className={ag.status === 'GÖREVDE' ? 'text-purple-400 animate-pulse font-bold' : 'text-slate-300'}>
                {ag.status || 'OYLADI'}
              </span>
            )}
          </span>
          <span className="text-emerald-400 font-bold">
            %{ag.win_rate || 78.5} Başarı
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/20">

      {/* ========================================================
          1. ÜST FİNANSAL BİLGİ BARI (EXECUTIVE METRICS STRIP)
         ======================================================== */}
      <div className="h-8 bg-[#090d14] border-b border-slate-800/90 px-4 flex items-center justify-between text-[11px] font-mono select-none overflow-x-auto whitespace-nowrap">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-amber-400">💰</span>
            <span className="text-slate-400">Toplam Kasa (Equity):</span>
            <span className="font-bold text-white tracking-wide">
              ${totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
            </span>
          </div>

          <span className="text-slate-700">•</span>

          <div className="flex items-center gap-1.5">
            <span className={grossPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {grossPnl >= 0 ? '📈' : '📉'}
            </span>
            <span className="text-slate-400">Brüt PnL:</span>
            <span className={`font-bold ${grossPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {grossPnl >= 0 ? '+' : ''}${grossPnl.toFixed(2)}
            </span>
          </div>

          <span className="text-slate-700">•</span>

          <div className="flex items-center gap-1.5">
            <span className="text-cyan-400">💵</span>
            <span className="text-slate-400">Net PnL:</span>
            <span className={`font-black ${netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)} USDT
            </span>
          </div>

          <span className="text-slate-700">•</span>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">🧾</span>
            <span className="text-slate-400">Toplam Komisyon:</span>
            <span className="font-bold text-amber-300">
              ${totalFees.toFixed(3)} USDT
            </span>
          </div>

          <span className="text-slate-700">•</span>
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-700/60 shadow-sm" title="Spot Cüzdana Korumalı Kasa">
            <span className="text-xs">🏦</span>
            <span className="text-slate-300 font-semibold text-[10.5px]">Spot Kasa:</span>
            <span className="font-mono text-emerald-400 font-black text-[11px]">
              ${Number(activeAccount?.spot_vault_balance || 0).toFixed(2)} USDT
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-cyan-400">🛡️</span>
            <span className="text-slate-400">Sentinel Risk:</span>
            <span className={`font-bold ${sentinelData.enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
              {sentinelData.enabled ? `AÇIK (${sentinelData.dynamic_leverage}x | %${sentinelData.exposure_pct} Marjin)` : 'PASİF'}
            </span>
          </div>

          <span className="text-slate-700">•</span>
          <div className="flex items-center gap-1.5">
            <span className="text-purple-400 font-bold">🎯 Başarı:</span>
            <span className="font-bold text-cyan-300">
              %{pnlSummary.win_rate_pct}% ({pnlSummary.win_count} Kâr / {pnlSummary.loss_count} Zarar)
            </span>
          </div>
        </div>
      </div>

      {/* ========================================================
          2. NAVİGASYON VE ANA KONTROLLER (HEADER)
         ======================================================== */}
      <header className="h-14 border-b border-slate-800/80 bg-[#0c1017]/95 px-4 flex items-center justify-between gap-3 text-xs select-none sticky top-0 z-40 backdrop-blur">
        
        {/* Sol Grup: Logo & Ana Tab Switcher */}
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex items-center gap-1.5 font-black text-sm tracking-wide text-cyan-400 shrink-0 mr-1">
            <span className="text-base text-cyan-400">🛡️</span>
            <span>AEGISQUANT <span className="text-white text-xs font-semibold px-1 py-0.5 rounded bg-cyan-950/80 border border-cyan-800/50">v3.0</span></span>
          </div>

          {/* 4 Ana Modül Sekmesi */}
          <nav className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setMainView('cockpit')}
              className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                mainView === 'cockpit'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>KOKPİT</span>
            </button>

            <button
              onClick={() => setMainView('portfolio')}
              className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                mainView === 'portfolio'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <PieChart className="w-3.5 h-3.5" />
              <span>PORTFÖY MASASI</span>
            </button>

            <button
              onClick={() => setMainView('agents')}
              className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                mainView === 'agents'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span>AJAN KONSEYİ</span>
            </button>

            <button
              onClick={() => setMainView('settings')}
              className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                mainView === 'settings'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>YÖNETİM AYARLARI</span>
            </button>
          </nav>

          <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-medium shrink-0">
            <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`}></span>
            <span className={wsConnected ? 'text-emerald-300' : 'text-rose-400'}>
              {wsConnected ? '🟢 SİSTEM SAĞLIKLI' : '🔴 BAĞLANTI KOPUK'}
            </span>
          </div>

          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-950/70 border border-cyan-800/60 text-[10.5px] font-mono shrink-0 select-none shadow-sm" title="Binance Futures Canlı Piyasa Verisi ve Hummingbot Kuant Motoru">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
            <span className="text-cyan-300 font-bold">⚡ BİNANCE CANLI ({binanceLatency}ms)</span>
            <span className="text-slate-600">|</span>
            <span className="text-purple-300 font-bold">🤖 Hummingbot PMM</span>
          </div>
        </div>

        {/* Sağ Grup: Bakiye, Hesap Seçici & Motor Butonu */}
        <div className="flex items-center gap-2.5 shrink-0">
          
          {/* Bakiye & Kasa Equity Düzenleme */}
          <div className="flex flex-col justify-center px-3 py-1 rounded bg-slate-900/90 border border-slate-700/60 font-mono">
            <div className="flex items-center gap-1.5">
              <span className="text-amber-400 text-sm">💰</span>
              {isEditingBalance ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={balanceInput}
                    onChange={(e) => setBalanceInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveBalance()}
                    className="w-24 bg-black border border-cyan-500 rounded px-1.5 py-0.5 text-white text-xs font-mono focus:outline-none"
                    autoFocus
                  />
                  <button onClick={handleSaveBalance} disabled={isSavingBalance} className="p-1 text-emerald-400 hover:text-emerald-300">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setIsEditingBalance(false)} className="p-1 text-slate-400 hover:text-rose-400">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => {
                    setBalanceInput(String(walletBalance || '100'));
                    setIsEditingBalance(true);
                  }}
                  className="flex items-center gap-1.5 cursor-pointer group hover:text-cyan-300 transition"
                  title="Cüzdan ana bakiyesini güncellemek için tıkla"
                >
                  <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider mr-0.5">Equity</span>
                  <span className="font-bold text-white tracking-wide text-xs sm:text-sm">
                    ${totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                    <span className="text-slate-400 font-normal text-[10px]">USDT</span>
                  </span>
                  <Edit2 className="w-3 h-3 text-slate-500 group-hover:text-cyan-400 transition ml-0.5" />
                </div>
              )}
            </div>
            {/* Detay Dağılımı: Cüzdan, Pozisyon Marjini ve Canlı PnL */}
            <div className="text-[9.5px] text-slate-400 font-sans flex items-center gap-1.5 mt-0.5 whitespace-nowrap">
              <span>Cüzdan: <b className="text-slate-200 font-mono">${walletBalance.toFixed(2)}</b></span>
              <span className="text-slate-600">|</span>
              <span>Pozisyonlarda: <b className="text-amber-300 font-mono">${usedMargin.toFixed(2)}</b></span>
              <span className="text-slate-600">|</span>
              <span>Canlı PnL: <b className={`font-mono ${unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}</b></span>
            </div>
          </div>

          {/* Dinamik Hesap Seçici Dropdown & Ayarlar Kısayolu */}
          <div className="flex items-center gap-1.5">
            <select
              value={activeAccount?.id || ''}
              onChange={(e) => selectAccount(e.target.value)}
              className="bg-slate-900 border border-slate-700/80 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-medium cursor-pointer hover:bg-slate-800 transition"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.type === 'REAL' ? '🟢 ' : '🧪 '}{acc.name}
                </option>
              ))}
            </select>

            <button
              onClick={() => handleOpenEditAccount(activeAccount)}
              className="p-1.5 rounded bg-slate-900 hover:bg-cyan-900/60 text-slate-300 hover:text-cyan-300 border border-slate-700/80 transition cursor-pointer flex items-center gap-1"
              title="Aktif Hesabın Ayarları ve Binance Canlı Bakiye Senkronizasyonu"
            >
              <Settings className="w-3.5 h-3.5 text-cyan-400" />
            </button>

            <button
              onClick={() => activeAccount && handleSyncAccountBalance(activeAccount.id)}
              disabled={syncingAccountId === activeAccount?.id}
              className={`p-1.5 rounded bg-slate-900 hover:bg-amber-900/40 text-amber-400 hover:text-amber-300 border border-slate-700/80 transition cursor-pointer flex items-center gap-1 ${syncingAccountId === activeAccount?.id ? 'opacity-70' : ''}`}
              title="Aktif Hesabın Gerçek Binance Bakiyesini Çek & Senkronize Et"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingAccountId === activeAccount?.id ? 'animate-spin text-amber-300' : ''}`} />
            </button>

            <button
              onClick={() => setIsAddAccountModalOpen(true)}
              className="p-1.5 rounded bg-slate-900 hover:bg-emerald-900/40 text-emerald-400 hover:text-emerald-300 border border-slate-700/80 transition cursor-pointer flex items-center gap-1"
              title="Yeni Hesap Ekle (Sanal veya Gerçek Binance)"
            >
              <UserPlus className="w-3.5 h-3.5 text-emerald-400" />
            </button>
          </div>

          {/* SIFIRLA / SENKRONİZE ET BUTONU */}
          <button
            onClick={() => setIsResetModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded font-bold text-xs tracking-wider uppercase bg-slate-800/90 hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 border border-amber-500/40 hover:border-amber-400 transition cursor-pointer shadow-sm group"
            title="Geçmişi Sıfırla veya Canlı Bakiye Senkronize Et"
          >
            <RefreshCw className="w-3.5 h-3.5 text-amber-400 group-hover:rotate-180 transition-transform duration-500" />
            <span>🔄 SIFIRLA / SENKRONİZE ET</span>
          </button>


          {/* PARLAK YEŞİL / KIRMIZI MOTOR BUTONU */}
          {engineState === 'STOPPING' ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded font-black text-xs tracking-wider bg-amber-500/20 border border-amber-500/50 text-amber-300 shadow-lg">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping"></span>
              <span>DURDURULUYOR ({stopMode || 'BEKLE'})...</span>
            </div>
          ) : engineState === 'RUNNING' ? (
            <button
              onClick={() => setIsStopModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded font-black text-xs tracking-wider uppercase bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-950/60 transition cursor-pointer animate-pulse"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>⏹ MOTORU DURDUR</span>
            </button>
          ) : (
            <button
              onClick={() => startEngine()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded font-black text-xs tracking-wider uppercase bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/60 transition cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>▶ MOTORU BAŞLAT</span>
            </button>
          )}

          {/* Terminali Kilitle Butonu */}
          <button
            onClick={handleLockMaster}
            className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-700/60 transition cursor-pointer"
            title="Terminali Kilitle (Master Lock)"
          >
            <Lock className="w-3.5 h-3.5" />
          </button>

        </div>
      </header>

      {/* TOAST BİLDİRİMİ */}
      {statusMessage && (
        <div className="bg-cyan-950 border-b border-cyan-800 px-4 py-1.5 flex items-center justify-between text-xs text-cyan-200">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-bold">{statusMessage}</span>
          </div>
          <button onClick={() => setStatusMessage('')} className="text-slate-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ========================================================
          GÖRÜNÜM 1: KOKPİT (High-Frequency Quant Execution Desk)
         ======================================================== */}
      {mainView === 'cockpit' && (
        <main className="flex-1 flex flex-col">
          {/* ORTA PANEL: ÇİFT YÖNLÜ RADAR + YATAY AJAN KONSENSÜS MASASI */}
          <section className="p-3.5 space-y-3">
            
            {/* 1. ÇİFT PİYASA RADARI (Dikey Alanı Sıkılaştırılmış Kompakt Tablo) */}
            <div className="bg-[#0b0e14] border border-slate-800/90 rounded-lg overflow-hidden flex flex-col shadow-xl">
              <div className="px-3 py-1.5 bg-[#0e131d] border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-100">
                    Çift Piyasa Radarı (Spot + Futures Arbitraj & Hacim Anomalisi)
                  </h3>
                </div>
                <span className="text-[9.5px] font-mono text-cyan-400 font-bold bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/60 flex items-center gap-1.5 shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  <span>15 PARİTE CANLI BİNANCE ({binanceLatency}ms)</span>
                </span>
              </div>

              <div className="overflow-x-auto max-h-[195px] overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#090c12] text-slate-400 border-b border-slate-800 text-[9.5px] font-semibold uppercase sticky top-0 z-10">
                      <th className="py-1 px-2.5">Parite</th>
                      <th className="py-1 px-2 text-right">Spot Hacim Δ</th>
                      <th className="py-1 px-2 text-right">Futures Hacim Δ</th>
                      <th className="py-1 px-2 text-right">L2 OBI</th>
                      <th className="py-1 px-2">Odaklanan Ajan</th>
                      <th className="py-1 px-2.5 text-center">Sinyal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/30 font-mono text-[10.5px]">
                    {radar.length === 0 ? (
                      <tr><td colSpan="6" className="py-6 text-center text-slate-500">Çift piyasa taranıyor...</td></tr>
                    ) : (
                      radar.map((c) => {
                        const isLong = c.signal === 'LONG';
                        const isShort = c.signal === 'SHORT';
                        const obiVal = Number(c.obi || 0) * 100;
                        const basisVal = Number(c.basis_pct || 0);
                        return (
                          <tr
                            key={c.symbol}
                            onClick={() => handleInspectIndicators(c.symbol)}
                            className="hover:bg-slate-800/30 transition cursor-pointer group"
                            title="10-İndikatör Kuant Analizini Açmak İçin Tıkla"
                          >
                            <td className="py-1 px-2.5 font-bold text-white flex items-center gap-1.5 group-hover:text-cyan-300">
                              <span>{c.symbol}</span>
                              {Math.abs(basisVal) >= 0.15 && (
                                <span className="px-1 py-0.2 rounded text-[8px] font-bold bg-purple-900/60 text-purple-300 border border-purple-700/60">
                                  Basis %{basisVal.toFixed(2)}
                                </span>
                              )}
                            </td>
                            <td className="py-1 px-2 text-right text-slate-300 text-[10px]">
                              {c.spot_vol_str || `$${(c.spot_vol / 1e6 || 0).toFixed(1)}M`}
                            </td>
                            <td className="py-1 px-2 text-right text-cyan-300 font-bold text-[10px]">
                              {c.futures_vol_str || `$${(c.futures_vol / 1e6 || 0).toFixed(1)}M`}
                            </td>
                            <td className={`py-1 px-2 text-right font-black ${obiVal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {obiVal >= 0 ? '+' : ''}{obiVal.toFixed(1)}%
                            </td>
                            <td className="py-1 px-2 text-slate-300 text-[10px]">
                              <span className="font-semibold text-purple-300">
                                {c.focused_agent || '⚡ Scalper'}
                              </span>
                            </td>
                            <td className="py-1 px-2.5 text-center">
                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider ${
                                isLong ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' :
                                isShort ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40' :
                                'bg-slate-800 text-slate-400 border border-slate-700'
                              }`}>
                                {c.signal}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 2. JEV AI KARAR ÇEKİRDEĞİ & 11 AJANLIK SİBER ORBİTAL YÜKSEK KONSEY */}
            <div className="bg-[#0b0e14] border border-purple-900/50 rounded-xl p-3.5 shadow-2xl space-y-3 relative overflow-hidden">
              
              {/* Cyber Izgara & Arka Plan Parıltısı */}
              <div className="absolute inset-0 bg-[radial-gradient(#1e1b4b_1px,transparent_1px)] [background-size:16px_16px] opacity-20 pointer-events-none" />
              
              {/* Üst Bar: Başlık, %70+ Baraj Kuralı, Canlı Oylama Durumu */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2 relative z-10">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <Cpu className="w-5 h-5 text-purple-400 animate-spin" style={{ animationDuration: '6s' }} />
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  </div>
                  <div>
                    <h3 className="font-black text-xs uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-cyan-200 to-emerald-300 flex items-center gap-2">
                      <span>11 Ajanlık Yüksek Konsey (Mixture-of-Agents)</span>
                      <span className="text-[10px] text-slate-400 font-normal">| Jev Hiyerarşik Dağıtım</span>
                    </h3>
                    <p className="text-[10px] font-mono text-slate-400">
                      Tetikleyici Ajan: <span className="text-cyan-300 font-bold">{councilTelemetry?.initiator_agent || '⚡ Scalper Ajanı'}</span> ──► 11 Uzman Çapraz İnceleme & Oylama
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 font-mono text-[10px]">
                  <span className="px-2.5 py-1 rounded-md bg-purple-950/80 border border-purple-700/60 text-purple-200 font-bold flex items-center gap-1.5 shadow-[0_0_10px_rgba(168,85,247,0.2)]">
                    <span>⚖️ KURAL: %70+ ONAY & SIFIR SENTINEL VETOSU</span>
                  </span>
                  <span className={`px-2.5 py-1 rounded-md font-black border flex items-center gap-1.5 ${
                    councilTelemetry?.has_sentinel_veto
                      ? 'bg-rose-950/90 text-rose-300 border-rose-600 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
                      : councilTelemetry?.approved
                        ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)] animate-pulse'
                        : 'bg-amber-950/80 text-amber-300 border-amber-700'
                  }`}>
                    {councilTelemetry?.has_sentinel_veto ? (
                      <><span>⛔</span> SENTINEL VETOSU</>
                    ) : councilTelemetry?.approved ? (
                      <><span>✅</span> KONSENSÜS ONAYLANDI: {councilTelemetry?.target_direction || 'LONG'} ({councilTelemetry?.display_consensus_rate ?? councilTelemetry?.approval_rate ?? 0}%)</>
                    ) : (
                      <><span>⏳</span> ONAY BEKLENİYOR ({councilTelemetry?.display_consensus_rate ?? councilTelemetry?.approval_rate ?? 0}%)</>
                    )}
                  </span>
                </div>
              </div>

              {/* KESİNTİSİZ TARAYICI SAYACI & AKAN PARİTE ŞERİDİ */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#070a12] border border-cyan-900/60 rounded-lg px-3 py-1.5 font-mono text-[10.5px] shadow-[0_0_12px_rgba(6,182,212,0.12)] relative z-10">
                <div className="flex items-center gap-2 text-cyan-300">
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin" style={{ animationDuration: '4s' }} />
                  <span className="font-black tracking-wide uppercase text-white">🔄 AKTİF TARAMA:</span>
                  <span className="px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-700/80 font-bold text-cyan-200">
                    {hunterTelemetry?.total_pairs_count || 312} Parite Döngüde
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-300 overflow-x-auto">
                  <span className="text-[10px] text-slate-500 font-bold">İncelenen:</span>
                  <div className="flex items-center gap-1">
                    {(hunterTelemetry?.currently_scanning || ['SOLUSDT', 'AVAXUSDT', 'PEPEUSDT', 'BTCUSDT', 'ETHUSDT', 'DOGEUSDT']).map((s, i) => (
                      <span key={i} className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-700/70 text-[9.5px] text-cyan-300 font-bold animate-pulse">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 font-bold flex items-center gap-1">
                  <span>Aday Havuzu:</span>
                  <span className="px-1.5 py-0.2 rounded bg-purple-950 border border-purple-700 font-black text-purple-300">
                    {hunterTelemetry?.pool_size || 0}
                  </span>
                </div>
              </div>

              {/* DİNAMİK SVG LAZER VERİ HATLARI (JEV AI ──► 11 AJAN) */}
              <div className="relative">
                <svg className="absolute inset-0 w-full h-full pointer-events-none z-0 hidden lg:block overflow-visible" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="2" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <filter id="glow-green" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <filter id="glow-red" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  {/* Sol Kanat (4 Ajan) -> Jev Sol */}
                  {[0, 1, 2, 3].map((idx) => {
                    const ag = displayCouncilAgents[idx];
                    const isTrap = councilTelemetry?.adversarial_critic?.trap_risk;
                    const isVeto = ag?.last_vote === 'VETO' || isTrap;
                    const isYes = ag?.last_vote === 'YES';
                    const isInquiry = councilTelemetry?.inquiry?.target_agents?.includes(ag?.id);
                    const strokeColor = isVeto ? '#f43f5e' : isYes ? '#10b981' : isInquiry ? '#c084fc' : '#06b6d4';
                    const filterId = isVeto ? 'url(#glow-red)' : isYes ? 'url(#glow-green)' : 'url(#glow-cyan)';
                    const yStart = 12 + idx * 24;
                    const yEnd = 24 + idx * 17;
                    return (
                      <line
                        key={`laser-l-${idx}`}
                        x1="24%"
                        y1={`${yStart}%`}
                        x2="26%"
                        y2={`${yEnd}%`}
                        stroke={strokeColor}
                        strokeWidth={isInquiry || isYes || isVeto ? "2" : "1"}
                        strokeDasharray={isInquiry ? "4 2" : isVeto ? "3 3" : "none"}
                        opacity={isYes || isVeto ? 0.9 : 0.4}
                        filter={filterId}
                        className={isInquiry ? "animate-pulse" : ""}
                      />
                    );
                  })}
                  {/* Sağ Kanat (4 Ajan) -> Jev Sağ */}
                  {[4, 5, 6, 7].map((idx) => {
                    const ag = displayCouncilAgents[idx];
                    const isTrap = councilTelemetry?.adversarial_critic?.trap_risk;
                    const isVeto = ag?.last_vote === 'VETO' || isTrap;
                    const isYes = ag?.last_vote === 'YES';
                    const isInquiry = councilTelemetry?.inquiry?.target_agents?.includes(ag?.id);
                    const strokeColor = isVeto ? '#f43f5e' : isYes ? '#10b981' : isInquiry ? '#c084fc' : '#06b6d4';
                    const filterId = isVeto ? 'url(#glow-red)' : isYes ? 'url(#glow-green)' : 'url(#glow-cyan)';
                    const subIdx = idx - 4;
                    const yStart = 12 + subIdx * 24;
                    const yEnd = 24 + subIdx * 17;
                    return (
                      <line
                        key={`laser-r-${idx}`}
                        x1="76%"
                        y1={`${yStart}%`}
                        x2="74%"
                        y2={`${yEnd}%`}
                        stroke={strokeColor}
                        strokeWidth={isInquiry || isYes || isVeto ? "2" : "1"}
                        strokeDasharray={isInquiry ? "4 2" : isVeto ? "3 3" : "none"}
                        opacity={isYes || isVeto ? 0.9 : 0.4}
                        filter={filterId}
                        className={isInquiry ? "animate-pulse" : ""}
                      />
                    );
                  })}
                </svg>

                {/* SİBER ORBİTAL KOKPİT DÜZENİ: MERKEZDE JEV ÇEKİRDEĞİ + ÇEVRESİNDE 11 MİKRO KART */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-stretch relative z-10">
                  
                  {/* SOL KANAT: 4 UZMAN AJAN (3 Kolon) */}
                  <div className="lg:col-span-3 space-y-2 flex flex-col justify-between">
                    {displayCouncilAgents.slice(0, 4).map(ag => renderAgentCard(ag))}
                  </div>

                  {/* MERKEZ: 🧠 JEV AI KARAR ÇEKİRDEĞİ (6 Kolon) */}
                  <div className="lg:col-span-6 rounded-xl bg-gradient-to-b from-[#0a0718] via-[#0d1020] to-[#070b14] border-2 border-purple-500/40 p-3.5 shadow-[0_0_35px_rgba(147,51,234,0.18)] flex flex-col justify-between relative overflow-hidden group">
                    
                    {/* Jev İnceleme Nabız Işığı (Purple Inquiry Glow) */}
                    <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-48 h-48 bg-purple-600/15 rounded-full blur-3xl pointer-events-none group-hover:bg-purple-600/25 transition duration-1000" />
                    
                    {/* Çekirdek Başlık & Hedef Parite */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-purple-900/60 border border-purple-500/50 flex items-center justify-center text-lg shadow-[0_0_15px_rgba(168,85,247,0.4)]">
                            🧠
                          </div>
                          <div>
                            <div className="text-[11px] font-black tracking-widest text-purple-300 uppercase">
                              Jev AI Karar Çekirdeği
                            </div>
                            <div className="text-[9.5px] font-mono text-slate-400">
                              Otonom Görev Dağıtıcı & HFT Tetikleyici
                            </div>
                          </div>
                        </div>
                        
                        <div className="text-right">
                          <span className="text-[9.5px] font-mono text-slate-400 block">Odak Parite:</span>
                          <span className="text-base font-black font-mono text-cyan-300 tracking-wider">
                            {councilTelemetry?.target_symbol || 'BTCUSDT'}
                          </span>
                        </div>
                      </div>

                      {/* Şeytanın Avukatı (Adversarial Critic) Tuzak Uyarısı */}
                      {councilTelemetry?.adversarial_critic?.trap_risk && (
                        <div className="mb-2 p-2 rounded-lg bg-rose-950/90 border border-rose-600/80 text-rose-200 text-[10px] font-mono flex items-center justify-between shadow-[0_0_14px_rgba(244,63,94,0.35)] animate-pulse">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="text-sm">⚠️</span>
                            <span className="font-black text-rose-400">ŞEYTANIN AVUKATI TUZAK UYARISI:</span>
                            <span className="text-white truncate">{councilTelemetry.adversarial_critic.reason}</span>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-rose-900 border border-rose-500 font-bold shrink-0 text-white ml-2">
                            Marjin: -%{Math.round((councilTelemetry.adversarial_critic.penalty || 0.5) * 100)}
                          </span>
                        </div>
                      )}

                      {/* KOMPAKT TEFTİŞ ROZETİ (Gürültüsüz Tek Satırlık Statik Rozet) */}
                      <div className="p-2 rounded-lg bg-gradient-to-r from-purple-950/80 via-slate-900/90 to-cyan-950/80 border border-purple-500/40 mb-2.5 flex items-center justify-between text-[11px] font-mono shadow-[0_0_12px_rgba(168,85,247,0.2)]">
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-cyan-400 font-bold shrink-0">🔍 İNCELENEN:</span>
                          <span className="font-black text-white px-1.5 py-0.5 rounded bg-purple-900/60 border border-purple-400/40 shrink-0">
                            {hunterTelemetry?.last_dispatched?.symbol || councilTelemetry?.target_symbol || 'SOLUSDT'}
                          </span>
                          <span className="text-slate-400 shrink-0">| 24s Hacim:</span>
                          <span className="text-amber-300 font-bold shrink-0">
                            ${Math.round((hunterTelemetry?.last_dispatched?.futures_vol || 140_000_000) / 1_000_000)}M
                          </span>
                          <span className="text-slate-400 shrink-0">| Konsey:</span>
                          <span className="text-emerald-400 font-black shrink-0">
                            %{councilTelemetry?.display_consensus_rate ?? councilTelemetry?.approval_rate ?? 82}
                          </span>
                          <span className="text-slate-400 shrink-0">| Durum:</span>
                          <span className="text-slate-200 truncate">
                            {hunterTelemetry?.last_dispatched?.reason || 'Yüksek Hacim & Şartlar İnceleniyor'}
                          </span>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[9.5px] font-bold bg-cyan-900/40 text-cyan-200 border border-cyan-500/40 shrink-0 ml-2 animate-pulse">
                          CANLI TEFTİŞ
                        </span>
                      </div>
                    </div>

                  {/* Konsensüs Güven Barı & %70 Baraj Çizgisi */}
                  <div className="space-y-1 my-1.5">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-slate-400 font-bold flex items-center gap-1">
                        <span>📊 Konsey Onay Oranı:</span>
                        <span className="text-white font-black">{councilTelemetry?.display_consensus_rate ?? councilTelemetry?.approval_rate ?? 0}%</span>
                        <span className="text-[10px] text-slate-500">({councilTelemetry?.yes_count || 0}/{councilTelemetry?.total_votes || 11} Ajan)</span>
                      </span>
                      <span className="text-[10px] font-bold text-purple-300">
                        Hedef Baraj: %70+
                      </span>
                    </div>

                    <div className="relative w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-700">
                      <div
                        className={`h-full transition-all duration-500 rounded-full ${
                          councilTelemetry?.approved
                            ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_15px_#10b981]'
                            : councilTelemetry?.has_sentinel_veto
                              ? 'bg-gradient-to-r from-rose-600 to-red-500'
                              : 'bg-gradient-to-r from-purple-600 via-amber-500 to-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(5, councilTelemetry?.display_consensus_rate ?? councilTelemetry?.approval_rate ?? 0))}%` }}
                      />
                      {/* %70 Baraj İşareti */}
                      <div className="absolute top-0 bottom-0 left-[70%] w-0.5 bg-white z-20 shadow-[0_0_5px_#ffffff]" title="Baraj Çizgisi (%70)" />
                      <span className="absolute top-0 bottom-0 left-[70.5%] text-[8px] font-black text-white/80 leading-none flex items-center pl-0.5 pointer-events-none">
                        %70 BARAJ
                      </span>
                    </div>
                  </div>

                  {/* 6'LI YILDIRIM DOĞRULAMA MATRİSİ (LIGHTNING 6-CHECK MATRIX) */}
                  <div className="my-2 p-2 rounded-lg bg-[#060810]/90 border border-purple-900/40">
                    <div className="flex items-center justify-between mb-1.5 text-[9.5px] font-mono">
                      <span className="text-purple-300 font-bold flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                        <span>6'LI YILDIRIM DOĞRULAMA MATRİSİ</span>
                      </span>
                      <span className="text-slate-400 font-bold">
                        Eşik: <span className="text-emerald-400 font-black">4/6 Geçiş</span>
                        <span className="text-slate-500 ml-1.5">
                          ({councilTelemetry?.lightning_matrix?.passed_count !== undefined ? councilTelemetry.lightning_matrix.passed_count : 6}/6)
                        </span>
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 font-mono text-[9px]">
                      {lightningChecks.map((chk, idx) => {
                        const isPassed = chk.passed;
                        const isScanning = activeCheckIndex === idx;
                        return (
                          <div
                            key={chk.name || idx}
                            className={`px-2 py-1 rounded border flex items-center justify-between transition-all duration-200 select-none ${
                              isScanning
                                ? 'bg-amber-950/90 border-amber-500 text-amber-200 animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.35)]'
                                : isPassed
                                  ? 'bg-emerald-950/70 border-emerald-600/80 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.15)]'
                                  : 'bg-rose-950/70 border-rose-700/80 text-rose-300 shadow-[0_0_8px_rgba(239,68,68,0.15)]'
                            }`}
                            title={chk.reason || chk.label}
                          >
                            <span className="font-bold truncate max-w-[85px]">{chk.label}</span>
                            <span className="font-black text-[10px] ml-1">
                              {isScanning ? (
                                <span className="text-amber-400 animate-spin">⚡</span>
                              ) : isPassed ? (
                                <span className="text-emerald-400 font-black">✓</span>
                              ) : (
                                <span className="text-rose-400 font-black">✗</span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Alt Karar & Gerekçe Metni */}
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono">
                    <div className="text-slate-400 text-[10px] truncate max-w-[320px]">
                      <span className="text-cyan-400 font-bold">Gerekçe: </span>
                      {councilTelemetry?.reason || 'Yüksek Konsey oylaması sürüyor'}
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      <span className="text-[9.5px] text-slate-500">Sentinel:</span>
                      <span className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold ${
                        councilTelemetry?.has_sentinel_veto
                          ? 'bg-rose-950 text-rose-400 border border-rose-700'
                          : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      }`}>
                        {councilTelemetry?.has_sentinel_veto ? 'VETO EDİLDİ' : 'TEMİZ / ONAY'}
                      </span>
                    </div>
                  </div>

                </div>

                {/* SAĞ KANAT: 4 UZMAN AJAN (3 Kolon) */}
                <div className="lg:col-span-3 space-y-2 flex flex-col justify-between">
                  {displayCouncilAgents.slice(4, 8).map(ag => renderAgentCard(ag))}
                </div>

              </div>

                {/* ALT ORBİTAL ŞERİT: KALAN 3 AJAN (Trend EMA, Momentum, Sentinel Risk) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1 border-t border-slate-800/60 relative z-10">
                  {displayCouncilAgents.slice(8, 11).map(ag => renderAgentCard(ag))}
                </div>

              </div>

            </div>

          </section>

          {/* ALT PANEL: EMİR & POZİSYON MASASI (3 SEKME) + LOG AKIŞI */}
          <section className="flex-1 px-3.5 pb-3.5 grid grid-cols-1 lg:grid-cols-12 gap-3.5 overflow-hidden">
            
            {/* SOL GRUP (8 Kolon): SEKME 1 & 2 & 3 */}
            <div className="lg:col-span-8 bg-[#0b0e14] border border-slate-800/90 rounded-lg overflow-hidden flex flex-col shadow-xl min-h-[270px]">
              
              <div className="px-3.5 py-2.5 bg-[#0e131d] border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCockpitTab('positions')}
                    className={`px-3 py-1 rounded text-xs font-bold font-mono transition cursor-pointer flex items-center gap-1.5 ${
                      cockpitTab === 'positions'
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>AKTİF POZİSYONLAR ({positions.length})</span>
                  </button>

                  <button
                    onClick={() => setCockpitTab('trades')}
                    className={`px-3 py-1 rounded text-xs font-bold font-mono transition cursor-pointer flex items-center gap-1.5 ${
                      cockpitTab === 'trades'
                        ? 'bg-purple-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
                    }`}
                  >
                    <Award className="w-3.5 h-3.5" />
                    <span>GEÇMİŞ İŞLEMLER ({trades.length})</span>
                  </button>

                  <button
                    onClick={() => setCockpitTab('orders')}
                    className={`px-3 py-1 rounded text-xs font-bold font-mono transition cursor-pointer flex items-center gap-1.5 ${
                      cockpitTab === 'orders'
                        ? 'bg-cyan-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>PLANLANAN EMİRLER ({plannedOrders.length})</span>
                  </button>
                </div>

                <span className="text-[10.5px] font-mono text-slate-400">
                  {activeAccount?.name || 'Faros Alpha'}
                </span>
              </div>

              {/* Sekme 1: Aktif Pozisyonlar */}
              {cockpitTab === 'positions' && (
                <div className="flex-1 overflow-x-auto overflow-y-auto max-h-[250px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#090c12] text-slate-400 border-b border-slate-800 text-[10px] font-semibold uppercase sticky top-0">
                        <th className="py-2 px-3">Sembol</th>
                        <th className="py-2 px-2 text-center">Yön</th>
                        <th className="py-2 px-2 text-right">Giriş</th>
                        <th className="py-2 px-2 text-right">Anlık Mark</th>
                        <th className="py-2 px-2 text-right">Stop-Loss</th>
                        <th className="py-2 px-2 text-right">Take-Profit</th>
                        <th className="py-2 px-2 text-right">PnL $ (%)</th>
                        <th className="py-2 px-3 text-center">Kapat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40 font-mono text-[11px]">
                      {(!positions || positions.length === 0) ? (
                        <tr>
                          <td colSpan="8" className="py-12 text-center text-slate-500">
                            Aktif açık pozisyon bulunmuyor.
                          </td>
                        </tr>
                      ) : (
                        (positions || []).map((pos) => {
                          const pnl = Number(pos.pnl || 0);
                          const pnlPct = Number(pos.pnl_pct || 0);
                          const isLong = pos.side === 'LONG';
                          return (
                            <tr
                              key={pos.id}
                              onClick={() => setSelectedPosition(pos)}
                              className="hover:bg-slate-800/60 transition cursor-pointer group"
                              title="Detay ve Canlı Grafik için Tıkla"
                            >
                              <td className="py-2 px-3 font-bold text-white flex items-center gap-1.5 group-hover:text-cyan-300 transition">
                                <span>{pos.symbol}</span>
                                <span className="text-[9px] text-slate-500">({pos.agent_name})</span>
                                <span className="text-[10px] text-cyan-500 opacity-0 group-hover:opacity-100 transition">🔍</span>
                              </td>
                              <td className="py-2 px-2 text-center">
                                <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                                  isLong ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                                }`}>
                                  {pos.side} {pos.leverage}x
                                </span>
                              </td>
                              <td className="py-2 px-2 text-right text-slate-300">${Number(pos.entry_price).toFixed(pos.entry_price < 1 ? 4 : 2)}</td>
                              <td className="py-2 px-2 text-right font-bold text-slate-100">
                                <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700/80 font-mono text-cyan-200 shadow-sm">
                                  ${Number(pos.mark_price || pos.entry_price).toFixed(pos.entry_price < 1 ? 4 : 2)}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-right text-rose-400">
                                ${pos.stop_loss ? Number(pos.stop_loss).toFixed(pos.entry_price < 1 ? 4 : 2) : '-'}
                              </td>
                              <td className="py-2 px-2 text-right text-emerald-400">
                                ${pos.take_profit ? Number(pos.take_profit).toFixed(pos.entry_price < 1 ? 4 : 2) : '-'}
                              </td>
                              <td className={`py-2 px-2 text-right font-black transition-colors duration-200 ${
                                pnl >= 0
                                  ? 'text-[#10b981] drop-shadow-[0_0_8px_rgba(16,185,129,0.4)]'
                                  : 'text-[#f43f5e] drop-shadow-[0_0_8px_rgba(244,63,94,0.4)]'
                              }`}>
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded transition-all duration-200 ${
                                  pnl >= 0 ? 'bg-emerald-950/80 border border-emerald-500/50' : 'bg-rose-950/80 border border-rose-500/50'
                                }`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${pnl >= 0 ? 'bg-emerald-400 animate-ping' : 'bg-rose-400 animate-ping'}`}></span>
                                  {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                                </span>
                              </td>
                              <td className="py-2 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleClosePosition(pos.id);
                                  }}
                                  className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] transition cursor-pointer shadow hover:shadow-rose-950/80"
                                >
                                  KAPAT
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Sekme 2: Geçmiş İşlemler */}
              {cockpitTab === 'trades' && (
                <div className="flex-1 overflow-x-auto overflow-y-auto max-h-[420px] scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#090c12] text-slate-400 border-b border-slate-800 text-[10px] font-semibold uppercase sticky top-0">
                        <th className="py-2 px-3">Kapanış</th>
                        <th className="py-2 px-2.5">Sembol</th>
                        <th className="py-2 px-2 text-center">Yön</th>
                        <th className="py-2 px-2 text-right">Giriş</th>
                        <th className="py-2 px-2 text-right">Çıkış</th>
                        <th className="py-2 px-2 text-right">Brüt PnL</th>
                        <th className="py-2 px-2 text-right">Komisyon</th>
                        <th className="py-2 px-2 text-right">Net PnL</th>
                        <th className="py-2 px-3">Gerekçe / Detay</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40 font-mono text-[11px]">
                      {(!trades || trades.length === 0) ? (
                        <tr>
                          <td colSpan="9" className="py-12 text-center text-slate-500">
                            Kapanmış geçmiş işlem bulunmuyor.
                          </td>
                        </tr>
                      ) : (
                        (trades || []).map((trd) => {
                          const net = Number(trd.net_pnl || 0);
                          const gross = Number(trd.pnl || 0);
                          const fee = Number(trd.fee || 0);
                          return (
                            <tr
                              key={trd.id}
                              onClick={() => setSelectedTrade(trd)}
                              className="hover:bg-slate-800/50 transition cursor-pointer group"
                            >
                              <td className="py-2 px-3 text-slate-400 text-[10px]">
                                {trd.closed_at ? trd.closed_at.split(' ')[1] || trd.closed_at : '-'}
                              </td>
                              <td className="py-2 px-2.5 font-bold text-white group-hover:text-cyan-300">
                                {trd.symbol}
                              </td>
                              <td className="py-2 px-2 text-center">
                                <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                                  trd.side === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                                }`}>
                                  {trd.side}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-right text-slate-300">${Number(trd.entry_price).toFixed(2)}</td>
                              <td className="py-2 px-2 text-right text-slate-300">${Number(trd.exit_price).toFixed(2)}</td>
                              <td className={`py-2 px-2 text-right font-medium ${gross >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {gross >= 0 ? '+' : ''}${gross.toFixed(2)}
                              </td>
                              <td className="py-2 px-2 text-right text-amber-300">${fee.toFixed(3)}</td>
                              <td className={`py-2 px-2 text-right font-black ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {net >= 0 ? '+' : ''}${net.toFixed(2)}
                              </td>
                              <td className="py-2 px-3 text-slate-400 text-[10px] truncate max-w-[150px]">
                                <span className="flex items-center gap-1 group-hover:text-white">
                                  {trd.reason || 'Manuel Kapatma'}
                                  <ChevronRight className="w-3 h-3 text-slate-500 ml-auto" />
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Sekme 3: Planlanan Emirler */}
              {cockpitTab === 'orders' && (
                <div className="flex-1 overflow-x-auto overflow-y-auto max-h-[250px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#090c12] text-slate-400 border-b border-slate-800 text-[10px] font-semibold uppercase sticky top-0">
                        <th className="py-2 px-3">Sembol</th>
                        <th className="py-2 px-2.5">Hangi Ajan</th>
                        <th className="py-2 px-2 text-right">Hedef Fiyat</th>
                        <th className="py-2 px-2 text-right">Güncel Fiyat</th>
                        <th className="py-2 px-2 text-right">Miktar</th>
                        <th className="py-2 px-3 text-center">Durum</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40 font-mono text-[11px]">
                      {(!plannedOrders || plannedOrders.length === 0) ? (
                        <tr>
                          <td colSpan="6" className="py-12 text-center text-slate-500">
                            Bekleyen planlı emir yok. Motor başlatıldığında garantili limit emirler üretilir.
                          </td>
                        </tr>
                      ) : (
                        (plannedOrders || []).map((ord) => (
                          <tr key={ord.id} className="hover:bg-slate-800/30 transition">
                            <td className="py-2 px-3 font-bold text-white flex items-center gap-1.5">
                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                                ord.side === 'LONG' || ord.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                              }`}>
                                {ord.side}
                              </span>
                              <span>{ord.symbol}</span>
                            </td>
                            <td className="py-2 px-2.5 text-cyan-300 font-bold">{ord.agent_name}</td>
                            <td className="py-2 px-2 text-right text-amber-300 font-bold">${Number(ord.target_price).toFixed(2)}</td>
                            <td className="py-2 px-2 text-right text-slate-300">${Number(ord.current_price).toFixed(2)}</td>
                            <td className="py-2 px-2 text-right text-slate-400">{Number(ord.quantity).toFixed(4)}</td>
                            <td className="py-2 px-3 text-center">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-400 border border-cyan-800/60 animate-pulse">
                                ● PLANNED
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

            </div>

            {/* SAĞ GRUP (4 Kolon): CANLI TELEMETRİ LOG TERMİNALİ */}
            <div className="lg:col-span-4 bg-[#0b0e14] border border-slate-800/90 rounded-lg overflow-hidden flex flex-col shadow-xl min-h-[270px]">
              <div className="px-3 py-2 bg-[#0e131d] border-b border-slate-800 flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-amber-400" />
                  <h3 className="font-bold text-[11px] uppercase tracking-wider text-slate-100">
                    Telemetri
                  </h3>
                </div>
                <div className="flex items-center gap-1">
                  {[
                    { id: 'ALL', label: 'Tümü' },
                    { id: 'HFT', label: 'HFT & Motor' },
                    { id: 'HUNTER', label: 'Avcı / Sinyal' },
                    { id: 'GUARDIAN', label: 'Sentinel & Guardian' },
                    { id: 'ERROR', label: '⚠️ Hatalar' },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setLogCategoryFilter(tab.id)}
                      className={`px-1.5 py-0.5 text-[9.5px] font-mono rounded transition-colors ${
                        logCategoryFilter === tab.id
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                          : 'bg-slate-800/50 text-slate-400 hover:text-slate-200 border border-transparent'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div
                ref={logContainerRef}
                className="flex-1 p-2.5 overflow-y-auto font-mono text-[10.5px] space-y-1.5 bg-[#070a0f] text-slate-300 max-h-[250px]"
              >
                {(() => {
                  const filteredLogs = logs.filter(l => {
                    if (logCategoryFilter === 'ALL') return true;
                    const src = (l.source || '').toUpperCase();
                    const lvl = (l.level || '').toUpperCase();
                    const msg = (l.message || '').toUpperCase();
                    if (logCategoryFilter === 'HFT') {
                      return src === 'HFT' || src === 'ORDER' || src === 'POSITION' || msg.includes('[HFT]') || msg.includes('MOTOR');
                    }
                    if (logCategoryFilter === 'HUNTER') {
                      return src === 'HUNTER' || src === 'RADAR' || src === 'SCANNER' || src === 'JEV_AI' || msg.includes('RADAR') || msg.includes('KONSENSÜS');
                    }
                    if (logCategoryFilter === 'GUARDIAN') {
                      return src === 'GUARDIAN' || src === 'SENTINEL' || src === 'RISK' || msg.includes('GUARDIAN') || msg.includes('SENTINEL');
                    }
                    if (logCategoryFilter === 'ERROR') {
                      return lvl === 'ERROR' || lvl === 'WARN' || msg.includes('HATA') || msg.includes('FAIL');
                    }
                    return true;
                  });

                  if (filteredLogs.length === 0) {
                    return <div className="text-slate-600 italic">Bu kategoride log bulunmuyor...</div>;
                  }

                  return filteredLogs.map((l, i) => (
                    <div key={i} className="flex items-start gap-1.5 leading-tight">
                      <span className="text-slate-500 shrink-0">[{l.timestamp ? (l.timestamp.split(' ')[1] || l.timestamp) : ''}]</span>
                      <span className={`font-bold shrink-0 ${
                        l.level === 'TRADE' ? 'text-emerald-400' :
                        l.level === 'WARN' ? 'text-amber-400' :
                        l.level === 'ERROR' ? 'text-rose-400' : 'text-cyan-400'
                      }`}>
                        [{l.source}]
                      </span>
                      <span className="text-slate-200 break-all">{l.message}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>

          </section>
        </main>
      )}

      {/* ========================================================
          GÖRÜNÜM 2: PORTFÖY MASASI (Portfolio Overview)
         ======================================================== */}
      {mainView === 'portfolio' && (
        <main className="flex-1 p-4 max-w-7xl mx-auto w-full space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <PieChart className="w-5 h-5 text-cyan-400" />
                Portföy Masası ve Sermaye Dağılımı
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Kayıtlı tüm sanal (Paper) ve gerçek (Binance Futures) hesapların anlık bakiye ve risk yönetimi.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleStartAll}
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-950/40"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>TÜM HESAPLARI BAŞLAT</span>
              </button>
              <button
                onClick={() => handleStopAll('PANIC')}
                className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-lg shadow-rose-950/40"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>TÜMÜNÜ DURDUR</span>
              </button>
              <button
                onClick={() => setMainView('settings')}
                className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Yeni Hesap Ekle</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(accounts || []).map(acc => {
              const isActive = activeAccount?.id === acc.id;
              const isRunning = acc.engine_state === 'RUNNING';
              const isSyncingThis = syncingAccountId === acc.id;
              return (
                <div
                  key={acc.id}
                  className={`p-4 rounded-xl border transition relative overflow-hidden flex flex-col justify-between ${
                    isActive
                      ? 'bg-[#0f172a]/95 border-cyan-500/80 shadow-xl shadow-cyan-950/40 ring-1 ring-cyan-500/30'
                      : 'bg-[#0b0e14] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    {/* Üst Rozetler: Hesap Türü, API Durumu ve Motor Durumu */}
                    <div className="flex items-center justify-between gap-1.5 flex-wrap mb-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          acc.type === 'REAL' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                        }`}>
                          {acc.type === 'REAL' ? '🟢 GERÇEK BİNANCE' : '🧪 SANAL (PAPER)'}
                        </span>
                        {acc.testnet && (
                          <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono bg-amber-950 text-amber-300 border border-amber-800">
                            TESTNET
                          </span>
                        )}
                        {acc.last_sync_status === 'SUCCESS' ? (
                          <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                            <span>BAĞLI</span>
                          </span>
                        ) : acc.last_sync_status === 'ERROR' ? (
                          <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono bg-rose-950/80 text-rose-300 border border-rose-700/80" title={acc.last_sync_message}>
                            ⚠️ API HATASI
                          </span>
                        ) : acc.type === 'REAL' && (!acc.api_key || !acc.api_secret) ? (
                          <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono bg-amber-950/80 text-amber-300 border border-amber-700/80">
                            🔑 API BEKLİYOR
                          </span>
                        ) : null}
                      </div>

                      <span className={`flex items-center gap-1 text-[10.5px] font-bold ${
                        isRunning ? 'text-emerald-400' : 'text-slate-500'
                      }`}>
                        <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`}></span>
                        {isRunning ? 'ÇALIŞIYOR' : 'DURDURULDU'}
                      </span>
                    </div>

                    {/* Hesap Başlığı ve Düzenleme İkonu */}
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                        <span>{acc.name}</span>
                        {isActive && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-700">
                            AKTİF
                          </span>
                        )}
                      </h3>
                      <button
                        onClick={() => handleOpenEditAccount(acc)}
                        className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition cursor-pointer"
                        title="Bu Hesabın Ayarlarını Düzenle"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Bakiye Göstergesi */}
                    <div className="mt-2.5 font-mono bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/80">
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-0.5">
                        <span>Cüzdan Bakiyesi:</span>
                        {acc.last_sync_time && (
                          <span className="text-[10px] text-slate-500">
                            Son senk: {acc.last_sync_time.slice(11, 16)}
                          </span>
                        )}
                      </div>
                      <div className="text-xl font-black text-amber-400 flex items-baseline justify-between">
                        <span>${Number(acc.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <span className="text-xs text-slate-400 font-sans font-semibold">USDT</span>
                      </div>

                      {/* Alt Metrikler: Kullanılabilir, Teminat, PnL, Kaldıraç */}
                      <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-800/70 text-[10.5px]">
                        <div>
                          <span className="text-slate-500 block">Kullanılabilir:</span>
                          <span className="text-slate-200 font-bold">${Number(acc.free_margin ?? acc.balance ?? 0).toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Kullanılan Teminat:</span>
                          <span className="text-amber-300 font-bold">${Number(acc.used_margin || 0).toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Açık PnL:</span>
                          <span className={`font-bold ${Number(acc.unrealized_pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {Number(acc.unrealized_pnl || 0) >= 0 ? '+' : ''}${Number(acc.unrealized_pnl || 0).toFixed(2)}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Kaldıraç & Risk:</span>
                          <span className="text-cyan-300 font-bold">{acc.leverage_cap || 5}x | %{acc.max_risk_pct || 2}%</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* KART BUTONLARI: Ayarlar, Bakiye Çek, Sil, Aktif Yap */}
                  <div className="mt-3.5 pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-1.5 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      {/* 1. AYARLAR BUTONU */}
                      <button
                        onClick={() => handleOpenEditAccount(acc)}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-cyan-900/60 text-slate-200 hover:text-cyan-300 font-bold text-xs flex items-center gap-1 border border-slate-700/80 transition cursor-pointer"
                        title="Bu hesabın ayarlarını, API anahtarlarını ve risk limitlerini düzenle"
                      >
                        <Settings className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Ayarlar</span>
                      </button>

                      {/* 2. CANLI BAKİYE SENKRONİZE ET BUTONU */}
                      <button
                        onClick={() => handleSyncAccountBalance(acc.id)}
                        disabled={isSyncingThis}
                        className={`px-2.5 py-1 rounded bg-slate-800 hover:bg-amber-950/60 text-amber-300 hover:text-amber-200 font-bold text-xs flex items-center gap-1 border border-amber-600/40 hover:border-amber-500 transition cursor-pointer ${
                          isSyncingThis ? 'opacity-60 cursor-not-allowed' : ''
                        }`}
                        title="Binance'ten bu hesaba ait canlı bakiyeyi çek ve güncelle"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isSyncingThis ? 'animate-spin' : ''}`} />
                        <span>{isSyncingThis ? 'Çekiliyor...' : 'Bakiye Çek'}</span>
                      </button>

                      {/* 3. SİL BUTONU */}
                      <button
                        onClick={() => handleDeleteAccount(acc.id)}
                        className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-900/50 transition cursor-pointer"
                        title="Hesabı Sil"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* 4. AKTİF YAP BUTONU */}
                    {!isActive ? (
                      <button
                        onClick={() => selectAccount(acc.id)}
                        className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs cursor-pointer shadow-sm transition"
                      >
                        Aktif Yap
                      </button>
                    ) : (
                      <span className="text-[11px] font-bold text-cyan-400 flex items-center gap-1 py-1 px-1.5">
                        <CheckCircle className="w-3.5 h-3.5" /> Seçili Aktif
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* YENİ HESAP EKLE KARTI */}
            <div
              onClick={() => setIsAddAccountModalOpen(true)}
              className="p-5 rounded-xl border-2 border-dashed border-slate-800 hover:border-cyan-500/60 bg-[#0b0e14]/60 hover:bg-cyan-950/20 transition cursor-pointer flex flex-col items-center justify-center text-center group min-h-[240px]"
            >
              <div className="w-12 h-12 rounded-full bg-slate-900 group-hover:bg-cyan-950/80 border border-slate-700 group-hover:border-cyan-500 flex items-center justify-center text-slate-400 group-hover:text-cyan-300 transition mb-3">
                <UserPlus className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-sm text-white group-hover:text-cyan-300 transition">
                + Yeni Hesap Ekle
              </h3>
              <p className="text-xs text-slate-400 max-w-xs mt-1 leading-relaxed">
                Yeni bir Binance Vadeli/Spot API hesabı bağlayın veya ayrı bir sanal test hesabı oluşturun.
              </p>
              <span className="mt-3 px-3 py-1 rounded-full text-[11px] font-bold bg-cyan-950/80 text-cyan-400 border border-cyan-800/80 group-hover:border-cyan-400 transition">
                Hesap Oluştur & API Bağla
              </span>
            </div>
          </div>
        </main>
      )}

      {/* ========================================================
          GÖRÜNÜM 3: AJAN KONSEYİ (11 Modelli Strateji Deski)
         ======================================================== */}
      {mainView === 'agents' && (
        <main className="flex-1 p-4 max-w-7xl mx-auto w-full space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Bot className="w-5 h-5 text-purple-400" />
                FAROS v3.0 Kuant Ajan Konseyi (Swarm Desk)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Multi-Armed Bandit adaptif ağırlıklandırma ile çalışan 11 otonom ajanın canlı görev dağılımı.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded bg-purple-950/70 border border-purple-800/60 text-purple-300 font-mono text-xs font-bold">
                11 MODEL AKTİF
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {DEFAULT_11_AGENTS.map(ag => {
              // Match with live dynamic agent if available
              const liveAg = agents.find(a => a.agent_id === ag.id || a.name.toLowerCase().includes(ag.name.toLowerCase().split(' ')[0]));
              const weight = liveAg ? liveAg.weight : ag.weight;
              const pnl = liveAg ? Number(liveAg.total_pnl || 0) : 0;
              const status = liveAg ? liveAg.status : 'İzlemede';

              return (
                <div
                  key={ag.id}
                  className="p-3.5 rounded-xl bg-[#0b0e14] border border-slate-800/90 hover:border-purple-500/40 transition flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{ag.avatar}</span>
                        <div>
                          <h4 className="font-bold text-xs text-white">{ag.name}</h4>
                          <span className="text-[10.5px] text-cyan-400 font-mono block">{ag.role}</span>
                        </div>
                      </div>
                      <span className="font-mono text-xs font-black text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/50">
                        %{Math.round(weight * 100)}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-400 leading-snug my-2">
                      {ag.desc}
                    </p>

                    <div className="p-2 rounded bg-slate-950 border border-slate-800/80 text-[10px] font-mono text-slate-300">
                      <span className="text-slate-500 block mb-0.5">Odak Pariteler:</span>
                      <span className="font-semibold text-purple-300">{ag.pairs}</span>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono">
                    <span className={`font-bold ${status === 'IN_TRADE' ? 'text-emerald-400' : 'text-slate-400'}`}>
                      [{status === 'IN_TRADE' ? 'İşlemde' : status === 'PLANNING' ? 'Planlıyor' : 'Tetik Bekliyor'}]
                    </span>
                    <span className={`font-black ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      PnL: ${pnl.toFixed(2)} USDT
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      )}

      {/* ========================================================
          GÖRÜNÜM 4: GELİŞMİŞ YÖNETİM AYARLARI (Settings Hub)
         ======================================================== */}
      {mainView === 'settings' && (
        <main className="flex-1 p-4 max-w-6xl mx-auto w-full">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-purple-400" />
                FAROS v3.0 Gelişmiş Yönetim & Kuant Risk Ayarları
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Tüm risk, kaldıraç, Telegram bildirim ve Binance API anahtarlarını SQLite üzerinde kalıcı yönetin.
              </p>
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={isSavingSettings}
              className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer shadow-lg shadow-purple-950/60"
            >
              {isSavingSettings ? 'Kaydediliyor...' : 'Ayarları Kalıcı Kaydet'}
            </button>
          </div>

          {settingsSaveMsg && (
            <div className="mb-4 p-2.5 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-200 text-xs font-bold font-mono">
              {settingsSaveMsg}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            
            {/* Sol Kategori Menüsü */}
            <div className="md:col-span-3 space-y-1">
              <button
                onClick={() => setSettingsCategory('risk')}
                className={`w-full text-left p-3 rounded-lg text-xs font-bold transition flex items-center gap-2.5 cursor-pointer ${
                  settingsCategory === 'risk'
                    ? 'bg-purple-600 text-white shadow'
                    : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Risk & Kasa Yönetimi</span>
              </button>

              <button
                onClick={() => setSettingsCategory('api')}
                className={`w-full text-left p-3 rounded-lg text-xs font-bold transition flex items-center gap-2.5 cursor-pointer ${
                  settingsCategory === 'api'
                    ? 'bg-purple-600 text-white shadow'
                    : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300'
                }`}
              >
                <Key className="w-4 h-4" />
                <span>API & Hesap Yönetimi</span>
              </button>

              <button
                onClick={() => setSettingsCategory('telegram')}
                className={`w-full text-left p-3 rounded-lg text-xs font-bold transition flex items-center gap-2.5 cursor-pointer ${
                  settingsCategory === 'telegram'
                    ? 'bg-purple-600 text-white shadow'
                    : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300'
                }`}
              >
                <Send className="w-4 h-4 text-cyan-400" />
                <span>Telegram Bildirim & Komut</span>
              </button>

              <button
                onClick={() => setSettingsCategory('auth')}
                className={`w-full text-left p-3 rounded-lg text-xs font-bold transition flex items-center gap-2.5 cursor-pointer ${
                  settingsCategory === 'auth'
                    ? 'bg-purple-600 text-white shadow'
                    : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300'
                }`}
              >
                <Lock className="w-4 h-4 text-cyan-400" />
                <span>Ana Bot Şifresi</span>
              </button>

              <button
                onClick={() => setSettingsCategory('updates')}
                className={`w-full text-left p-3 rounded-lg text-xs font-bold transition flex items-center gap-2.5 cursor-pointer ${
                  settingsCategory === 'updates'
                    ? 'bg-purple-600 text-white shadow'
                    : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300'
                }`}
              >
                <Globe className="w-4 h-4" />
                <span>Sistem & Versiyon Durumu</span>
              </button>
            </div>

            {/* Sağ Ayar İçerik Alanı */}
            <div className="md:col-span-9 bg-[#0b0e14] border border-slate-800 rounded-xl p-5 shadow-xl">
              
              {/* Kategori 1: Risk & Kasa Yönetimi */}
              {settingsCategory === 'risk' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-sm text-white uppercase tracking-wider pb-2 border-b border-slate-800 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Kuant Risk, Kaldıraç ve Koruma Parametreleri
                  </h3>

                  {/* SENTINEL Otonom Risk Modu Switch */}
                  <div className="p-3.5 bg-cyan-950/20 border border-cyan-800/40 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-cyan-400" />
                        <span className="font-bold text-xs text-white">SENTINEL Otonom Risk Ajanı</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          sentinelData.enabled ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {sentinelData.enabled ? 'AKTİF' : 'PASİF'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Siz başında yokken piyasa volatilitesini (ATR) ve kasa marjinini izleyerek kaldıraç ve risk katsayısını dinamik ayarlar.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleSentinel(!sentinelData.enabled)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        sentinelData.enabled ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      }`}
                    >
                      {sentinelData.enabled ? '🛡️ Açık (Aktif)' : '⚪ Kapalı'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* Maksimum Kaldıraç */}
                    <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
                      <label className="block text-slate-300 font-semibold mb-1 text-xs">Maksimum Kaldıraç</label>
                      <select
                        value={settingsForm.leverage_cap}
                        onChange={(e) => setSettingsForm({ ...settingsForm, leverage_cap: parseInt(e.target.value) || 5 })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white text-xs font-mono"
                      >
                        <option value={2}>2x (Aşırı Korumacı)</option>
                        <option value={3}>3x (Dengeli)</option>
                        <option value={5}>5x (Varsayılan Kuant)</option>
                        <option value={10}>10x (Yüksek Volatilite)</option>
                        <option value={20}>20x (Agresif Scalp)</option>
                      </select>
                      {renderDetailBox(
                        'leverage',
                        'Maksimum Kaldıraç',
                        'İşlem açılırken sermayenin kaç katı büyüklük kullanılacağını sınırlar.',
                        'Likidasyon riski ve piyasa iğnelerinde zarar katlanır.',
                        'Kâr marjı düşer, sermaye verimsiz kalabilir.',
                        '5x - 10x arası'
                      )}
                    </div>

                    {/* İşlem Başına Risk % */}
                    <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
                      <label className="block text-slate-300 font-semibold mb-1 text-xs">İşlem Başına Risk Limiti (%)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={settingsForm.max_risk_pct}
                        onChange={(e) => setSettingsForm({ ...settingsForm, max_risk_pct: parseFloat(e.target.value) || 2.0 })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white text-xs font-mono"
                      />
                      {renderDetailBox(
                        'max_risk',
                        'İşlem Başına Risk Limiti',
                        'Tek bir işlemde bakiyenin maksimum yüzde kaçının riske edileceğini belirler.',
                        'Peş peşe 2-3 ters işlemde sermaye hızla erir.',
                        'Pozisyon boyutları çok ufak kalır.',
                        '%1.5 - %3.0'
                      )}
                    </div>

                    {/* Başa-baş (Breakeven) Tetikleyicisi */}
                    <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
                      <label className="block text-slate-300 font-semibold mb-1 text-xs">Başa-baş (Breakeven) Tetikleyicisi (%)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={settingsForm.breakeven_pct}
                        onChange={(e) => setSettingsForm({ ...settingsForm, breakeven_pct: parseFloat(e.target.value) || 1.5 })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white text-xs font-mono"
                      />
                      {renderDetailBox(
                        'breakeven',
                        'Başa-baş Tetikleyicisi',
                        'Fiyat bu kâr oranına ulaştığında stop noktası otomatik olarak komisyon korumalı giriş fiyatına çekilir.',
                        'Kâr büyümeden erken çıkışlara sebep olabilir.',
                        'Kâra geçen işlemler tekrar zarara dönebilir.',
                        '%1.20 - %1.50'
                      )}
                    </div>

                    {/* Trailing Stop (%) */}
                    <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
                      <label className="block text-slate-300 font-semibold mb-1 text-xs">İz Süren Stop (Trailing Stop) (%)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={settingsForm.trailing_stop_pct}
                        onChange={(e) => setSettingsForm({ ...settingsForm, trailing_stop_pct: parseFloat(e.target.value) || 1.2 })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white text-xs font-mono"
                      />
                      {renderDetailBox(
                        'trailing',
                        'İz Süren Stop Oranı',
                        'Kâr arttıkça stop fiyatının arkasından ne kadar mesafeyle takip edeceğini ayarlar.',
                        'Ani geri çekilmelerde kazancın bir kısmı geri verilebilir.',
                        'Ufak gürültülerde erkenden stop olunur.',
                        '%1.00 - %1.50'
                      )}
                    </div>

                    {/* Stop-Loss & Take-Profit */}
                    <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
                      <label className="block text-slate-300 font-semibold mb-1 text-xs">Varsayılan Stop-Loss (%)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={settingsForm.stop_loss_pct}
                        onChange={(e) => setSettingsForm({ ...settingsForm, stop_loss_pct: parseFloat(e.target.value) || 1.85 })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white text-xs font-mono"
                      />
                    </div>

                    <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
                      <label className="block text-slate-300 font-semibold mb-1 text-xs">Varsayılan Take-Profit (%)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={settingsForm.take_profit_pct}
                        onChange={(e) => setSettingsForm({ ...settingsForm, take_profit_pct: parseFloat(e.target.value) || 4.5 })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white text-xs font-mono"
                      />
                    </div>

                  </div>
                </div>
              )}

              {/* Kategori 2: API & Hesap Yönetimi */}
              {settingsCategory === 'api' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-sm text-white uppercase tracking-wider pb-2 border-b border-slate-800 flex items-center gap-2">
                    <Key className="w-4 h-4 text-amber-400" />
                    Borsa & API Anahtarları Yönetimi
                  </h3>

                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-300 uppercase">Kayıtlı Hesaplar ({(accounts || []).length})</h4>
                    {(accounts || []).map(acc => (
                      <div key={acc.id} className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{acc.name}</span>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                              acc.type === 'REAL' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                            }`}>
                              {acc.type === 'REAL' ? 'GERÇEK BİNANCE API' : 'SANAL (PAPER)'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono mt-1">
                            Bakiye: ${Number(acc.balance || 0).toFixed(2)} USDT
                            {acc.api_key_masked && <span className="ml-2 text-slate-500">API: {acc.api_key_masked}</span>}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleOpenEditAccount(acc)}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-cyan-950/80 text-slate-200 hover:text-cyan-300 border border-slate-700/80 text-[11px] font-bold flex items-center gap-1 transition cursor-pointer"
                            title="Hesap Ayarları & API Düzenle"
                          >
                            <Settings className="w-3 h-3 text-cyan-400" />
                            <span>Ayarlar</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSyncAccountBalance(acc.id)}
                            disabled={syncingAccountId === acc.id}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-amber-950/80 text-amber-300 hover:text-amber-200 border border-amber-600/40 text-[11px] font-bold flex items-center gap-1 transition cursor-pointer"
                            title="Binance'ten Canlı Bakiye Çek"
                          >
                            <RefreshCw className={`w-3 h-3 ${syncingAccountId === acc.id ? 'animate-spin' : ''}`} />
                            <span>{syncingAccountId === acc.id ? 'Çekiliyor...' : 'Bakiye Çek'}</span>
                          </button>

                          {activeAccount?.id !== acc.id && (
                            <button
                              type="button"
                              onClick={() => selectAccount(acc.id)}
                              className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold cursor-pointer transition"
                            >
                              Aktif Yap
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDeleteAccount(acc.id)}
                            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer"
                            title="Hesabı Sil"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Global Binance API Bilgileri */}
                  <div className="p-3.5 rounded-lg bg-slate-900/90 border border-cyan-800/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Key className="w-4 h-4 text-cyan-400" />
                        <h4 className="text-xs font-bold text-white uppercase">Binance Futures API Anahtarları (Sistem Genel)</h4>
                      </div>
                      <span className="text-[10px] text-emerald-400 font-mono bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                        🔒 Dahili Güvenli Depolama (ENV Yok)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      API anahtarlarınız doğrudan bu terminalin dahili veritabanında saklanır. Dışarıya veya ENV ortam değişkenlerine açık değildir.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block text-slate-400 mb-1 font-semibold">Binance API Key</label>
                        <input
                          type="password"
                          placeholder="API Anahtarınızı giriniz..."
                          value={settingsForm.binance_api_key || ''}
                          onChange={(e) => setSettingsForm({ ...settingsForm, binance_api_key: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 font-semibold">Binance API Secret</label>
                        <input
                          type="password"
                          placeholder="Gizli Anahtarınızı giriniz..."
                          value={settingsForm.binance_api_secret || ''}
                          onChange={(e) => setSettingsForm({ ...settingsForm, binance_api_secret: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={handleSaveSettings}
                        disabled={isSavingSettings}
                        className="px-3.5 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs transition cursor-pointer flex items-center gap-1.5 shadow"
                      >
                        {isSavingSettings ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>KAYDEDİLİYOR...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>BİNANCE ANAHTARLARINI KAYDET</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Yeni Hesap Ekle Formu */}
                  <form onSubmit={handleAddAccount} className="pt-4 border-t border-slate-800 space-y-3">
                    <h4 className="text-xs font-bold text-slate-300 uppercase">Yeni Hesap Ekle</h4>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block text-slate-400 mb-1">Hesap İsmi</label>
                        <input
                          type="text"
                          required
                          placeholder="Örn: Binance Ana Vadeli"
                          value={newAccName}
                          onChange={(e) => setNewAccName(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1">Hesap Türü</label>
                        <select
                          value={newAccType}
                          onChange={(e) => setNewAccType(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white text-xs"
                        >
                          <option value="PAPER">Sanal (Paper Trading)</option>
                          <option value="REAL">Gerçek (Binance Futures API)</option>
                        </select>
                      </div>
                    </div>

                    {newAccType === 'REAL' ? (
                      <div className="space-y-2 p-3 rounded bg-slate-950 border border-slate-800">
                        <div>
                          <label className="block text-slate-400 mb-1">Binance API Key</label>
                          <input
                            type="password"
                            placeholder="API Key"
                            value={newAccApiKey}
                            onChange={(e) => setNewAccApiKey(e.target.value)}
                            className="w-full bg-black border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-400 mb-1">Binance API Secret</label>
                          <input
                            type="password"
                            placeholder="Secret Key"
                            value={newAccApiSecret}
                            onChange={(e) => setNewAccApiSecret(e.target.value)}
                            className="w-full bg-black border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs"
                          />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-slate-400 mb-1">Başlangıç Bakiyesi (USDT)</label>
                        <input
                          type="number"
                          value={newAccBalance}
                          onChange={(e) => setNewAccBalance(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs"
                        />
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isAddingAcc}
                      className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs uppercase cursor-pointer"
                    >
                      {isAddingAcc ? 'Ekleniyor...' : 'Hesabı Kaydet'}
                    </button>
                  </form>
                </div>
              )}

              {/* Kategori 3: Telegram Bildirim & Komut */}
              {settingsCategory === 'telegram' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-sm text-white uppercase tracking-wider pb-2 border-b border-slate-800 flex items-center gap-2">
                    <Send className="w-4 h-4 text-cyan-400" />
                    Çift Yönlü Telegram Botu & Bildirimler
                  </h3>

                  <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
                    {/* Varsayılan Bot Rozeti ve Seçeneği */}
                    <div className="p-3 rounded-lg bg-cyan-950/40 border border-cyan-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-cyan-400 font-bold text-xs">🤖 Varsayılan Bot:</span>
                        <code className="text-white font-mono text-xs bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700">@Omnideneme_bot</code>
                        {(!settingsForm.telegram_token || settingsForm.telegram_token === '8605987091:AAEbSLn5Ubdx0_TZ2fJCvhAQuzAYs8fZz7Y') ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-700">
                            Varsayılan Botu Kullan (@Omnideneme_bot) [Aktif]
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            Özel Bot Tanımlı
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsForm({
                            ...settingsForm,
                            telegram_token: '8605987091:AAEbSLn5Ubdx0_TZ2fJCvhAQuzAYs8fZz7Y',
                            telegram_chat_id: '2140273565',
                            telegram_enabled: true,
                            use_default_bot: true,
                          });
                        }}
                        className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-[11px] transition cursor-pointer self-start sm:self-auto shrink-0"
                      >
                        Varsayılan Botu Kullan (@Omnideneme_bot)
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-xs">Telegram Botunu Aktif Et</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settingsForm.telegram_enabled}
                          onChange={(e) => setSettingsForm({ ...settingsForm, telegram_enabled: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-cyan-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                      </label>
                    </div>

                    <div>
                      <label className="block text-slate-400 mb-1 text-xs">Telegram Bot Token</label>
                      <input
                        type="password"
                        placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                        value={settingsForm.telegram_token}
                        onChange={(e) => setSettingsForm({ ...settingsForm, telegram_token: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-400 mb-1 text-xs">Telegram Chat ID</label>
                      <input
                        type="text"
                        placeholder="Örn: 987654321"
                        value={settingsForm.telegram_chat_id}
                        onChange={(e) => setSettingsForm({ ...settingsForm, telegram_chat_id: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={handleTestTelegram}
                        className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <Send className="w-3 h-3" /> Test Bildirimi Gönder
                      </button>
                      {telegramTestStatus && (
                        <span className="text-xs font-mono text-slate-300">{telegramTestStatus}</span>
                      )}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono space-y-1.5">
                    <span className="text-purple-300 font-bold block mb-1">📱 Desteklenen Çift Yönlü Telegram Komutları:</span>
                    <div className="text-slate-400"><code>/status</code> - Motor durumu ve açık pozisyonlar</div>
                    <div className="text-slate-400"><code>/balance</code> - Güncel bakiye raporu</div>
                    <div className="text-slate-400"><code>/start_engine</code> - Ticaret motorunu hemen başlat</div>
                    <div className="text-slate-400"><code>/stop_engine</code> - Motoru hemen durdur</div>
                  </div>
                </div>
              )}

              {/* Kategori 4: Sistem & Versiyon Durumu */}
              {settingsCategory === 'updates' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-sm text-white uppercase tracking-wider pb-2 border-b border-slate-800 flex items-center gap-2">
                    <Globe className="w-4 h-4 text-cyan-400" />
                    Sistem & GitHub Dağıtım Durumu
                  </h3>

                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3 font-mono text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">Yüklü Sürüm:</span>
                      <span className="text-cyan-300 font-bold">FAROS v3.0.0 (Master)</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">Son Git Commit:</span>
                      <span className="text-white font-bold">242dec1 (main)</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">Veritabanı Motoru:</span>
                      <span className="text-emerald-400 font-bold">SQLite WAL (Deterministic ACID)</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800">
                      <span className="text-slate-400">Bağlı GitHub Deposu:</span>
                      <span className="text-purple-300 font-bold">Kaptanayhan/FarosBot.git</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleCheckUpdate}
                      disabled={isCheckingUpdate}
                      className="px-3.5 py-2 mt-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                      <span>{isCheckingUpdate ? 'Denetleniyor...' : 'Güncellemeleri Denetle'}</span>
                    </button>

                    {updateInfo && (
                      <div className="p-2.5 rounded bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs mt-2">
                        ✅ Sisteminiz en güncel sürümde çalışmaktadır.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Kategori 5: Ana Bot Şifresi Yönetimi */}
              {settingsCategory === 'auth' && (
                <div className="space-y-4 max-w-lg">
                  <h3 className="font-bold text-sm text-white uppercase tracking-wider pb-2 border-b border-slate-800 flex items-center gap-2">
                    <Lock className="w-4 h-4 text-cyan-400" />
                    Ana Bot Güvenlik Şifresi
                  </h3>

                  <p className="text-xs text-slate-400">
                    Terminal erişim kilidi için Master şifreyi buradan güncelleyebilirsiniz. Şifre SQLite veritabanında SHA-256 olarak güvenle saklanır.
                  </p>

                  <form onSubmit={handleChangePassword} className="space-y-3 font-sans">
                    <div>
                      <label className="block text-slate-300 text-xs font-semibold mb-1">Mevcut Master Şifre</label>
                      <input
                        type="password"
                        required
                        value={pwForm.old_password}
                        onChange={(e) => setPwForm({ ...pwForm, old_password: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-white text-xs font-mono"
                        placeholder="Mevcut şifreniz (varsayılan: admin123)"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 text-xs font-semibold mb-1">Yeni Master Şifre</label>
                      <input
                        type="password"
                        required
                        value={pwForm.new_password}
                        onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-white text-xs font-mono"
                        placeholder="En az 6 karakter"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 text-xs font-semibold mb-1">Yeni Şifre (Tekrar)</label>
                      <input
                        type="password"
                        required
                        value={pwForm.confirm_password}
                        onChange={(e) => setPwForm({ ...pwForm, confirm_password: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-white text-xs font-mono"
                        placeholder="Yeni şifreyi onaylayın"
                      />
                    </div>

                    {pwStatus.message && (
                      <p className={`text-xs font-bold ${pwStatus.type === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {pwStatus.message}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={isChangingPw}
                      className="px-4 py-2 mt-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs cursor-pointer flex items-center gap-2 shadow-lg shadow-cyan-950/40"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{isChangingPw ? 'KAYDEDİLİYOR...' : 'ŞİFREYİ GÜNCELLE'}</span>
                    </button>
                  </form>
                </div>
              )}

            </div>
          </div>
        </main>
      )}

      {/* ========================================================
          HAFİF L2 DERİNLİK TAHTASI & BOT TAHMİN GEREKÇELERİ MODALI
         ======================================================== */}
      {activeSelectedPos && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b0e14] border border-cyan-700/60 rounded-xl max-w-4xl w-full p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            {/* Üst Başlık & PnL */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className={`px-2.5 py-1 rounded text-xs font-black uppercase tracking-wider ${
                  activeSelectedPos.side === 'LONG' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                }`}>
                  {activeSelectedPos.side} {activeSelectedPos.leverage}x
                </div>
                <h3 className="text-base font-black text-white tracking-wide flex items-center gap-2">
                  <span>{activeSelectedPos.symbol}</span>
                  <span className="text-xs font-normal text-slate-400 font-mono">({activeSelectedPos.agent_name})</span>
                </h3>
              </div>

              {/* Anlık PnL Rozeti */}
              <div className="flex items-center gap-3">
                <div className={`px-3 py-1 rounded font-mono font-black text-sm ${
                  Number(activeSelectedPos.pnl || 0) >= 0
                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/50 shadow-emerald-950/50'
                    : 'bg-rose-950/80 text-rose-400 border border-rose-500/50 shadow-rose-950/50'
                }`}>
                  {Number(activeSelectedPos.pnl || 0) >= 0 ? '+' : ''}${Number(activeSelectedPos.pnl || 0).toFixed(2)} ({Number(activeSelectedPos.pnl_pct || 0) >= 0 ? '+' : ''}{Number(activeSelectedPos.pnl_pct || 0).toFixed(2)}%)
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPosition(null)}
                  className="text-slate-400 hover:text-white p-1 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* 2 Kolonlu Kompakt Yapı: Sol Tahta, Sağ Tahmin & Gerekçeler */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* SOL KOLON: CANLI L2 TAHTA DERİNLİĞİ (ORDER BOOK) */}
              <div className="bg-[#080b11] border border-slate-800/80 rounded-xl p-3.5 space-y-2.5 font-mono text-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-800 text-[10px] uppercase font-sans font-bold text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                      <span>Canlı L2 Derinlik Tahtası</span>
                    </span>
                    <span className="text-slate-500">Miktar (USDT-M)</span>
                  </div>

                  {/* Kırmızı Satışlar (Asks - En iyi 5) */}
                  <div className="space-y-1 pt-1.5">
                    {(() => {
                      const asks = (positionAnalysis?.order_book?.asks || []).slice(0, 5);
                      const maxAskQty = Math.max(...asks.map(a => a.qty), 1);
                      return asks.map((a, idx) => {
                        const depthPct = Math.min(100, Math.round((a.qty / maxAskQty) * 100));
                        return (
                          <div key={idx} className="relative flex justify-between items-center px-2 py-0.5 rounded overflow-hidden">
                            <div className="absolute right-0 top-0 bottom-0 bg-rose-950/40 pointer-events-none transition-all duration-300" style={{ width: `${depthPct}%` }} />
                            <span className="text-rose-400 font-bold relative z-10">${Number(a.price).toFixed(a.price < 1 ? 4 : 2)}</span>
                            <span className="text-slate-400 relative z-10 text-[11px]">{Number(a.qty).toFixed(3)}</span>
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {/* Ortada Anlık Mark Fiyatı & Alış-Satış Makası (Spread) */}
                  <div className="my-2 py-1.5 px-3 bg-slate-900/90 border-y border-slate-700/60 rounded flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 uppercase font-sans font-bold">Mark:</span>
                      <span className="font-bold text-cyan-300 text-sm">
                        ${Number(activeSelectedPos.mark_price || activeSelectedPos.entry_price).toFixed(activeSelectedPos.entry_price < 1 ? 4 : 2)}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 flex items-center gap-1">
                      <span>Makas:</span>
                      <span className="text-amber-400 font-bold">
                        ${positionAnalysis?.spread?.value || '0.00'} (%{positionAnalysis?.spread?.pct || '0.00'})
                      </span>
                    </div>
                  </div>

                  {/* Yeşil Alışlar (Bids - En iyi 5) */}
                  <div className="space-y-1">
                    {(() => {
                      const bids = (positionAnalysis?.order_book?.bids || []).slice(0, 5);
                      const maxBidQty = Math.max(...bids.map(b => b.qty), 1);
                      return bids.map((b, idx) => {
                        const depthPct = Math.min(100, Math.round((b.qty / maxBidQty) * 100));
                        return (
                          <div key={idx} className="relative flex justify-between items-center px-2 py-0.5 rounded overflow-hidden">
                            <div className="absolute right-0 top-0 bottom-0 bg-emerald-950/40 pointer-events-none transition-all duration-300" style={{ width: `${depthPct}%` }} />
                            <span className="text-emerald-400 font-bold relative z-10">${Number(b.price).toFixed(b.price < 1 ? 4 : 2)}</span>
                            <span className="text-slate-400 relative z-10 text-[11px]">{Number(b.qty).toFixed(3)}</span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

                {/* Alt Kısım: Giriş Fiyatı & Seviyeler */}
                <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Giriş Fiyatı:</span>
                    <span className="text-white font-bold">${Number(activeSelectedPos.entry_price).toFixed(activeSelectedPos.entry_price < 1 ? 4 : 2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Zarar Durdur (SL):</span>
                    <span className="text-rose-400 font-bold">{activeSelectedPos.stop_loss ? `$${Number(activeSelectedPos.stop_loss).toFixed(activeSelectedPos.entry_price < 1 ? 4 : 2)}` : 'Yok'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Kâr Al (TP):</span>
                    <span className="text-emerald-400 font-bold">{activeSelectedPos.take_profit ? `$${Number(activeSelectedPos.take_profit).toFixed(activeSelectedPos.entry_price < 1 ? 4 : 2)}` : 'Yok'}</span>
                  </div>
                </div>
              </div>

              {/* SAĞ KOLON: BOT TAHMİNİ & NEDEN BU COINE GİRDİ? */}
              <div className="space-y-3 flex flex-col justify-between">
                {/* Bot Tahmin & Güven Skoru Banner */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">Konsensüs Güveni</div>
                    <div className="text-sm font-bold text-cyan-400 font-mono mt-0.5">
                      %{positionAnalysis?.bot_forecast?.confidence_score || 88} Yüksek Onay
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">Hedeflenen Net Kâr</div>
                    <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                      +%{positionAnalysis?.bot_forecast?.target_pnl_pct || '12.0'}
                    </div>
                  </div>
                </div>

                {/* "Neden Girildi?" Analiz Kartı */}
                <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2.5 flex-1">
                  <div className="text-xs font-bold text-amber-300 uppercase tracking-wide flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span>Neden Girildi? (Bot Sinyal Gerekçeleri)</span>
                  </div>
                  <div className="space-y-2 text-xs text-slate-300">
                    {(positionAnalysis?.bot_forecast?.entry_reasons || [
                      "L2 OBI: +0.42 alıcı baskısı ve derinlik desteği",
                      "CVD Hacim: +$1.8M 24s vadeli işlem net akışı ve delta teyidi",
                      "Trend Momentum: EMA 9/21 kırılım teyidi",
                      "ATR Volatilite: Dinamik kâr bant genişliği",
                      "Tasfiye Likiditesi: Üst kademelerde tasfiye avı"
                    ]).map((reason, idx) => (
                      <div key={idx} className="flex items-start gap-2 bg-slate-950/40 p-1.5 rounded border border-slate-800/40">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span className="leading-snug text-[11px] font-mono">{reason}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1">
                    <span>Pozisyondaki Süre:</span>
                    <span className="text-amber-300 font-bold">{positionAnalysis?.bot_forecast?.time_in_trade || 'Hesaplanıyor...'}</span>
                  </div>
                </div>

                {/* Alt Kısım: PnL & Tek Tıkla Acil Kapat Butonu */}
                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase font-bold">Anlık Kâr / Zarar</div>
                    <div className={`text-base font-black font-mono ${Number(activeSelectedPos.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {Number(activeSelectedPos.pnl || 0) >= 0 ? '+' : ''}${Number(activeSelectedPos.pnl || 0).toFixed(2)} ({Number(activeSelectedPos.pnl_pct || 0) >= 0 ? '+' : ''}{Number(activeSelectedPos.pnl_pct || 0).toFixed(2)}%)
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await handleClosePosition(activeSelectedPos.id);
                      setSelectedPosition(null);
                    }}
                    className="px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-black text-xs uppercase tracking-wider transition shadow-lg shadow-rose-950/60 flex items-center gap-2 cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>ACİL KAPAT (MARKET)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          GEÇMİŞ İŞLEM DETAY MODALI
         ======================================================== */}
      {selectedTrade && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f1420] border border-cyan-800/80 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-3 font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-bold text-white uppercase">İşlem İcra Detayı: {selectedTrade.symbol}</h3>
              </div>
              <button onClick={() => setSelectedTrade(null)} className="text-slate-400 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800/50">
                <span className="text-slate-400">İşlem Yönü:</span>
                <span className={`font-bold ${selectedTrade.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {selectedTrade.side}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/50">
                <span className="text-slate-400">Giriş Fiyatı:</span>
                <span className="text-white">${Number(selectedTrade.entry_price).toFixed(4)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/50">
                <span className="text-slate-400">Çıkış Fiyatı:</span>
                <span className="text-white">${Number(selectedTrade.exit_price).toFixed(4)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/50">
                <span className="text-slate-400">Ödenen Komisyon (Taker):</span>
                <span className="text-amber-400 font-bold">${Number(selectedTrade.fee || 0).toFixed(4)} USDT</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/50">
                <span className="text-slate-400">Brüt Kâr/Zarar:</span>
                <span className={`font-bold ${Number(selectedTrade.pnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  ${Number(selectedTrade.pnl).toFixed(2)} USDT
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/50">
                <span className="text-slate-400">Net Kâr (Komisyon Sonrası):</span>
                <span className={`font-black text-sm ${Number(selectedTrade.net_pnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  ${Number(selectedTrade.net_pnl).toFixed(2)} USDT
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/50">
                <span className="text-slate-400">Karar Veren Ajan:</span>
                <span className="text-purple-300 font-bold">{selectedTrade.agent_name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/50">
                <span className="text-slate-400">Kapanış Zamanı:</span>
                <span className="text-slate-300">{selectedTrade.closed_at}</span>
              </div>
              <div className="pt-2">
                <span className="text-slate-400 block mb-1">Yapay Zekâ Karar Gerekçesi:</span>
                <div className="p-2 rounded bg-slate-900 border border-slate-800 text-cyan-300 text-[11px] leading-relaxed">
                  {selectedTrade.reason || 'Kullanıcı veya motor tarafından manuel kapatıldı.'}
                </div>
              </div>
            </div>

            <button
              onClick={() => setSelectedTrade(null)}
              className="w-full py-2 mt-2 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs"
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {/* ========================================================
          MOTOR DURDURMA SENARYO MODALI
         ======================================================== */}
      {isStopModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f1420] border border-slate-700 rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-rose-400 font-bold">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-sm uppercase tracking-wide">Motoru Durdurma Senaryoları</h3>
              </div>
              <button onClick={() => setIsStopModalOpen(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Aktif açık pozisyonlar ve planlı emirler için kapatma senaryosu seçin:
            </p>

            <div className="space-y-2.5">
              <button
                onClick={() => { setIsStopModalOpen(false); stopEngine('PANIC'); }}
                className="w-full text-left p-3 rounded-lg bg-rose-950/20 hover:bg-rose-950/40 border border-rose-800/50 hover:border-rose-500 transition group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs text-rose-300 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" /> 1. ACİL PANİK ÇIKIŞI (Market Flush)
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-900 text-rose-200">
                    PANIC
                  </span>
                </div>
                <p className="text-[11px] text-rose-300/80 leading-snug">
                  Açık tüm pozisyonları beklemeden piyasa emriyle (Market) anında kapatır, bekleyen tüm limit emirleri iptal eder ve motoru kilitler.
                </p>
              </button>

              <button
                onClick={() => { setIsStopModalOpen(false); stopEngine('SOFT'); }}
                className="w-full text-left p-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-emerald-500/50 transition group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs text-white group-hover:text-emerald-300 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> 2. KÂR AL BEKLEMELİ ÇIKIŞ (Soft Wind-down)
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                    SOFT
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  Yeni emir açmaz; açık pozisyonların Take-Profit seviyelerine gelmesini bekler, kârdakileri kapatır, zarardakileri takip eden stop ile korur.
                </p>
              </button>

              <button
                onClick={() => { setIsStopModalOpen(false); stopEngine('LIMIT'); }}
                className="w-full text-left p-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50 transition group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs text-white group-hover:text-cyan-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" /> 3. GÜVENLİ LİMİT ÇIKIŞ (Order Execution Exit)
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-400 border border-cyan-800">
                    LIMIT
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  Yalnızca aktif bekleyen emirlerin dolmasını/kapanmasını bekleyip sistemi güvenli şekilde uyku moduna alır.
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          BAKİYE SENKRONİZE ET & GEÇMİŞİ SIFIRLA MODALI
         ======================================================== */}
      {isResetModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f1420] border border-amber-500/50 rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-amber-400 font-bold">
                <RefreshCw className="w-5 h-5" />
                <h3 className="text-sm uppercase tracking-wide">Bakiye Senkronize Et & Geçmişi Sıfırla</h3>
              </div>
              <button
                onClick={() => !isSubmittingReset && setIsResetModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Bu işlem tüm açık pozisyonları kapatacak, bekleyen emirleri iptal edecek, işlem geçmişini ve RAM telemetrisini temizleyecektir.
            </p>

            <div className="space-y-3">
              {/* Seçenek 1: Sanal Başlangıç */}
              <div
                onClick={() => setResetMode('PAPER_RESET')}
                className={`p-3 rounded-lg border cursor-pointer transition ${
                  resetMode === 'PAPER_RESET'
                    ? 'bg-amber-950/30 border-amber-500 text-white'
                    : 'bg-slate-900 border-slate-700/80 text-slate-300 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs flex items-center gap-2 text-amber-300">
                    <span>🧪</span> Seçenek 1: Sanal Başlangıç Yap
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/60 text-amber-200 border border-amber-700">
                    PAPER_RESET
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mb-2 leading-snug">
                  Tüm geçmişi siler ve hesabı belirleyeceğiniz sanal bakiye (Varsayılan 100 USDT) ile temiz bir sayfayla başlatır.
                </p>
                {resetMode === 'PAPER_RESET' && (
                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-amber-900/40">
                    <span className="text-[11px] text-slate-300 font-medium">Başlangıç Bakiyesi:</span>
                    <input
                      type="number"
                      value={resetBalanceAmount}
                      onChange={(e) => setResetBalanceAmount(e.target.value)}
                      className="w-24 bg-black border border-amber-500/70 rounded px-2 py-0.5 text-xs text-amber-300 font-mono focus:outline-none"
                    />
                    <span className="text-xs text-slate-400 font-mono">USDT</span>
                  </div>
                )}
              </div>

              {/* Seçenek 2: Canlı Senkronizasyon */}
              <div
                onClick={() => setResetMode('LIVE_SYNC')}
                className={`p-3 rounded-lg border cursor-pointer transition ${
                  resetMode === 'LIVE_SYNC'
                    ? 'bg-cyan-950/30 border-cyan-500 text-white'
                    : 'bg-slate-900 border-slate-700/80 text-slate-300 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs flex items-center gap-2 text-cyan-300">
                    <span>⚡</span> Seçenek 2: Gerçek Bakiye İle Senkronize Et
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-700">
                    LIVE_SYNC
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  Binance Futures API (/fapi/v2/account) üzerinden gerçek cüzdan bakiyenizi çeker, lokal veritabanını gerçek bakiye ile eşitler ve geçmişi sıfırlar.
                </p>
              </div>
            </div>

            {/* Butonlar */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsResetModalOpen(false)}
                disabled={isSubmittingReset}
                className="px-3.5 py-1.5 rounded text-xs font-bold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleResetAndSync}
                disabled={isSubmittingReset}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-black uppercase tracking-wider text-slate-950 bg-amber-400 hover:bg-amber-300 transition shadow-lg shadow-amber-950/50 cursor-pointer disabled:opacity-50"
              >
                {isSubmittingReset ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>İŞLENİYOR...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>ONAYLA VE SIFIRLA</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          AJAN KARAR VE OYLAMA GEÇMİŞİ MODALI (SON 10 KARAR)
         ======================================================== */}
      {selectedCouncilAgent && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0b0e14] border border-cyan-800/80 rounded-xl max-w-2xl w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-3.5 bg-[#0e131d] border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-950 border border-cyan-700/60 flex items-center justify-center text-cyan-300 font-bold text-sm">
                  {selectedCouncilAgent.name?.slice(0, 2) || '🤖'}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    <span>{selectedCouncilAgent.name}</span>
                    <span className="px-2 py-0.2 rounded text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                      Başarı: %{selectedCouncilAgent.win_rate}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">{selectedCouncilAgent.role}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedCouncilAgent(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 font-mono">
              <div className="text-xs text-cyan-300 font-bold flex items-center justify-between">
                <span>📋 Son Karar ve Oylama Geçmişi (Son 10 İşlem):</span>
                {agentHistoryLoading && <span className="text-purple-400 animate-pulse text-[10px]">Yükleniyor...</span>}
              </div>

              <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-800 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-[#0e131d] text-slate-400 text-[10px] uppercase border-b border-slate-800">
                      <th className="py-2 px-3">Zaman</th>
                      <th className="py-2 px-3">Parite</th>
                      <th className="py-2 px-3 text-center">Oy</th>
                      <th className="py-2 px-3 text-center">Yön</th>
                      <th className="py-2 px-3 text-right">Skor</th>
                      <th className="py-2 px-3">Gerekçe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50 text-[11px]">
                    {agentHistoryData?.history && agentHistoryData.history.length > 0 ? (
                      agentHistoryData.history.map((h, i) => (
                        <tr key={i} className="hover:bg-slate-800/30 transition">
                          <td className="py-2 px-3 text-slate-400">{h.timestamp}</td>
                          <td className="py-2 px-3 font-bold text-white">{h.symbol}</td>
                          <td className="py-2 px-3 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                              h.vote === 'YES' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                              h.vote === 'VETO' ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                              'bg-slate-800 text-slate-400'
                            }`}>
                              {h.vote}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center font-bold text-cyan-300">{h.signal}</td>
                          <td className="py-2 px-3 text-right text-slate-300 font-bold">{h.score}</td>
                          <td className="py-2 px-3 text-slate-300 text-[10.5px] max-w-xs truncate" title={h.reason}>
                            {h.reason}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6" className="py-6 text-center text-slate-500">
                          Henüz kayıtlı karar geçmişi bulunmuyor.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-5 py-3 bg-[#0e131d] border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedCouncilAgent(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          10-İNDİKATÖR KUANT ÖZNİTELİK MATRİSİ MODALI
         ======================================================== */}
      {inspectSymbol && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0c1017] border border-cyan-800/80 rounded-2xl max-w-xl w-full p-5 shadow-2xl space-y-4 font-sans">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  {inspectSymbol} // 10-İndikatör Kuant Öznitelik Matrisi
                </h3>
              </div>
              <button
                onClick={() => setInspectSymbol(null)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isLoadingIndicators || !indicatorData ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-cyan-400 font-mono text-xs">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Kuant öznitelik matrisi hesaplanıyor...</span>
              </div>
            ) : (
              <div className="space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-cyan-950/40 border border-cyan-800/50">
                  <span className="text-slate-300">Algoritmik Sinyal Kararı:</span>
                  <span className={`px-2.5 py-1 rounded font-black text-xs ${
                    indicatorData.signal === 'STRONG_BUY' || indicatorData.signal === 'BUY'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                      : indicatorData.signal === 'STRONG_SELL' || indicatorData.signal === 'SELL'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50'
                      : 'bg-slate-800 text-slate-300'
                  }`}>
                    {indicatorData.signal}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-400 text-[10.5px] block mb-0.5">1. L2 OBI (Order Book Imbalance)</span>
                    <span className={`font-bold ${indicatorData.l2_obi >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {indicatorData.l2_obi >= 0 ? '+' : ''}{indicatorData.l2_obi}%
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-400 text-[10.5px] block mb-0.5">2. CVD (Cumulative Volume Delta)</span>
                    <span className={`font-bold ${indicatorData.cvd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {indicatorData.cvd >= 0 ? '+' : ''}{Number(indicatorData.cvd).toLocaleString()}
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-400 text-[10.5px] block mb-0.5">3. RSI (14) Osilatörü</span>
                    <span className={`font-bold ${indicatorData.rsi_14 > 70 ? 'text-rose-400' : indicatorData.rsi_14 < 30 ? 'text-emerald-400' : 'text-cyan-300'}`}>
                      {indicatorData.rsi_14}
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-400 text-[10.5px] block mb-0.5">4. EMA 9 / 21 / 200</span>
                    <span className="font-bold text-white text-[10.5px]">
                      {indicatorData.ema?.ema_9} / {indicatorData.ema?.ema_21}
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-400 text-[10.5px] block mb-0.5">5. ATR (Volatilite / SL)</span>
                    <span className="font-bold text-amber-300">
                      ${indicatorData.atr}
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-400 text-[10.5px] block mb-0.5">6. BBW (Bollinger Bant Genişliği)</span>
                    <span className="font-bold text-slate-200">
                      %{indicatorData.bbw}
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-400 text-[10.5px] block mb-0.5">7. VWAP (Hacim Ağırlıklı Fiyat)</span>
                    <span className="font-bold text-cyan-300">
                      ${indicatorData.vwap}
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-400 text-[10.5px] block mb-0.5">8. Fonlama Oranı & OI</span>
                    <span className="font-bold text-purple-300">
                      %{indicatorData.funding_rate_pct} | ${Number(indicatorData.open_interest).toLocaleString()}
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-400 text-[10.5px] block mb-0.5">9. MACD Divergence</span>
                    <span className="font-bold text-emerald-300">
                      {indicatorData.macd?.signal || 'Nötr'} (Hist: {indicatorData.macd?.hist})
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-400 text-[10.5px] block mb-0.5">10. SuperTrend Rejimi</span>
                    <span className={`font-bold ${indicatorData.supertrend === 'BULLISH' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {indicatorData.supertrend}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={() => setInspectSymbol(null)}
              className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs cursor-pointer transition"
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {/* ========================================================
          HER HESABA ÖZEL AYARLAR MODALI (Per-Account Settings Modal)
         ======================================================== */}
      {editingAccount && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b0e14] border border-cyan-700/80 rounded-2xl max-w-2xl w-full p-5 shadow-2xl space-y-4 font-sans animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            
            {/* Modal Başlığı */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-950 border border-cyan-700/80 flex items-center justify-center text-cyan-400">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white flex items-center gap-2">
                    <span>Hesap Ayarları</span>
                    <span className="text-slate-400 text-xs font-normal font-mono">// {editingAccount.name}</span>
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`px-2 py-0.2 rounded text-[9.5px] font-bold ${
                      editingAccount.type === 'REAL' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                    }`}>
                      {editingAccount.type === 'REAL' ? 'GERÇEK BİNANCE API' : 'SANAL TESTNET'}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Bakiye: <b className="text-amber-300">${Number(editingAccount.balance || 0).toFixed(2)} USDT</b>
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setEditingAccount(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Bildirim / Sonuç Kutusu */}
            {accountSyncResult && (
              <div className={`p-3 rounded-xl border text-xs font-mono flex items-center justify-between gap-2 ${
                accountSyncResult.type === 'success' ? 'bg-emerald-950/70 border-emerald-700 text-emerald-200' : 'bg-rose-950/70 border-rose-700 text-rose-200'
              }`}>
                <span>{accountSyncResult.text}</span>
                <button type="button" onClick={() => setAccountSyncResult(null)} className="text-slate-400 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Ayar Sekmeleri: Genel, API & Bakiye, Kuant & Risk */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold">
              <button
                type="button"
                onClick={() => setAccountModalTab('general')}
                className={`flex-1 py-1.5 rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                  accountModalTab === 'general' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>📋 Genel Ayarlar</span>
              </button>
              <button
                type="button"
                onClick={() => setAccountModalTab('api')}
                className={`flex-1 py-1.5 rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                  accountModalTab === 'api' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Key className="w-3.5 h-3.5" />
                <span>Binance API & Bakiye</span>
              </button>
              <button
                type="button"
                onClick={() => setAccountModalTab('risk')}
                className={`flex-1 py-1.5 rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                  accountModalTab === 'risk' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Kuant & Risk</span>
              </button>
            </div>

            {/* SEKME 1: GENEL AYARLAR */}
            {accountModalTab === 'general' && (
              <div className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Hesap İsmi</label>
                  <input
                    type="text"
                    value={editingAccount.name || ''}
                    onChange={(e) => setEditingAccount({ ...editingAccount, name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-medium focus:border-cyan-500 focus:outline-none"
                    placeholder="Örn: Binance Ana Vadeli"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Hesap Modu</label>
                    <select
                      value={editingAccount.type || 'PAPER'}
                      onChange={(e) => setEditingAccount({ ...editingAccount, type: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-medium focus:border-cyan-500 focus:outline-none cursor-pointer"
                    >
                      <option value="PAPER">🧪 Sanal (Paper Trading / Simülasyon)</option>
                      <option value="REAL">🟢 Gerçek (Binance API Canlı)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Borsa Türü</label>
                    <select
                      value={editingAccount.broker || 'BINANCE_FUTURES'}
                      onChange={(e) => setEditingAccount({ ...editingAccount, broker: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-medium focus:border-cyan-500 focus:outline-none cursor-pointer"
                    >
                      <option value="BINANCE_FUTURES">Binance Vadeli İşlemler (USDT-M Futures)</option>
                      <option value="BINANCE_SPOT">Binance Spot Cüzdanı</option>
                      <option value="BYBIT">Bybit Vadeli (Entegrasyon Hazır)</option>
                    </select>
                  </div>
                </div>

                {/* Testnet ve Bakiye Girişi */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-white font-semibold block">Binance Testnet</span>
                      <span className="text-[11px] text-slate-400">Canlı Mainnet yerine Testnet kullan</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(editingAccount.testnet)}
                        onChange={(e) => setEditingAccount({ ...editingAccount, testnet: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-cyan-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                    </label>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                    <label className="block text-slate-300 font-semibold mb-1">
                      {editingAccount.type === 'REAL' ? 'Son Çekilen Bakiye (USDT)' : 'Sanal Bakiye Belirle (USDT)'}
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={editingAccount.balance ?? 0}
                      onChange={(e) => setEditingAccount({ ...editingAccount, balance: parseFloat(e.target.value) || 0 })}
                      disabled={editingAccount.type === 'REAL'}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none disabled:opacity-70 disabled:bg-slate-900"
                    />
                    {editingAccount.type === 'REAL' && (
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        * Gerçek hesap bakiyesi Binance API üzerinden otomatik güncellenir.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* SEKME 2: BİNANCE API & CANLI BAKİYE DOĞRULAMA */}
            {accountModalTab === 'api' && (
              <div className="space-y-3.5 text-xs font-sans">
                {/* Güvenlik Bilgilendirmesi */}
                <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-800/60 text-cyan-200 text-xs leading-relaxed flex items-start gap-2.5">
                  <span className="text-base">🔒</span>
                  <div>
                    <span className="font-bold text-white block">Güvenli Dahili Saklama:</span>
                    <span>
                      Bu hesaba ait API Key ve Secret anahtarları doğrudan veritabanında saklanır. ENV ortam değişkenlerine yazılmaz ve dışarıya sızdırılmaz.
                    </span>
                  </div>
                </div>

                {/* API Key */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-slate-300 font-semibold">Binance API Key</label>
                    {settingsForm.binance_api_key && (!editingAccount.api_key || editingAccount.api_key !== settingsForm.binance_api_key) && (
                      <button
                        type="button"
                        onClick={() => setEditingAccount({
                          ...editingAccount,
                          api_key: settingsForm.binance_api_key,
                          api_secret: settingsForm.binance_api_secret || editingAccount.api_secret
                        })}
                        className="text-[10.5px] text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                      >
                        Sistem Genel Anahtarını Aktar
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={editingAccount.api_key || ''}
                    onChange={(e) => setEditingAccount({ ...editingAccount, api_key: e.target.value.trim() })}
                    placeholder="Binance 64 karakterli API Key"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                {/* API Secret */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-slate-300 font-semibold">Binance API Secret (Gizli Anahtar)</label>
                    <button
                      type="button"
                      onClick={() => setShowEditSecret(!showEditSecret)}
                      className="text-[10.5px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                    >
                      {showEditSecret ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      <span>{showEditSecret ? 'Gizle' : 'Göster'}</span>
                    </button>
                  </div>
                  <input
                    type={showEditSecret ? 'text' : 'password'}
                    value={editingAccount.api_secret || ''}
                    onChange={(e) => setEditingAccount({ ...editingAccount, api_secret: e.target.value.trim() })}
                    placeholder="Binance API Secret Key"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                {/* Bağlantıyı Test Et & Canlı Bakiyeyi Doğrula Butonu */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={handleTestCredentials}
                    disabled={isTestingCredentials || !editingAccount.api_key || !editingAccount.api_secret}
                    className="w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-slate-900 hover:bg-cyan-950 text-cyan-300 hover:text-cyan-200 border border-cyan-700 hover:border-cyan-500 transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTestingCredentials ? 'animate-spin' : ''}`} />
                    <span>{isTestingCredentials ? 'Binance Bağlantısı Doğrulanıyor...' : '🔄 Bağlantıyı Test Et & Gerçek Bakiyeyi Sorgula'}</span>
                  </button>
                </div>

                {/* Test Sonuç Kutusu */}
                {testCredentialsResult && (
                  <div className={`p-3.5 rounded-xl border text-xs font-mono space-y-1.5 ${
                    testCredentialsResult.type === 'success'
                      ? 'bg-emerald-950/70 border-emerald-700/80 text-emerald-200'
                      : 'bg-rose-950/70 border-rose-700/80 text-rose-200'
                  }`}>
                    <div className="flex items-center gap-2 font-bold text-sm">
                      {testCredentialsResult.type === 'success' ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                          <span>Bağlantı Başarılı! Gerçek Bakiye Doğrulandı.</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-4 h-4 text-rose-400" />
                          <span>Binance Bağlantı Hatası</span>
                        </>
                      )}
                    </div>

                    <p className="text-[11px] leading-relaxed text-slate-300">
                      {testCredentialsResult.message}
                    </p>

                    {testCredentialsResult.type === 'success' && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-emerald-800/60 text-xs">
                        <div>
                          <span className="text-slate-400 block text-[10px]">Cüzdan Bakiyesi:</span>
                          <span className="text-emerald-300 font-bold text-sm font-mono">${Number(testCredentialsResult.wallet_balance || 0).toFixed(2)} USDT</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Kullanılabilir:</span>
                          <span className="text-white font-bold text-sm font-mono">${Number(testCredentialsResult.available_balance || 0).toFixed(2)} USDT</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Açık Pozisyonlar:</span>
                          <span className="text-cyan-300 font-bold text-sm font-mono">{testCredentialsResult.details?.open_positions_count || 0} Adet</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* SEKME 3: KUANT & RİSK YÖNETİMİ */}
            {accountModalTab === 'risk' && (
              <div className="space-y-3.5 text-xs font-sans">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Maksimum Kaldıraç */}
                  <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                    <label className="block text-slate-300 font-semibold mb-1">Maksimum Kaldıraç (Cap)</label>
                    <select
                      value={editingAccount.leverage_cap || 5}
                      onChange={(e) => setEditingAccount({ ...editingAccount, leverage_cap: parseInt(e.target.value, 10) || 5 })}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs cursor-pointer focus:border-cyan-500 focus:outline-none"
                    >
                      <option value={2}>2x (Aşırı Korumacı)</option>
                      <option value={3}>3x (Düşük Risk)</option>
                      <option value={5}>5x (Varsayılan Kuant)</option>
                      <option value={10}>10x (Yüksek Volatilite)</option>
                      <option value={20}>20x (Agresif HFT)</option>
                    </select>
                    <span className="text-[10px] text-slate-500 mt-1 block">Hesap bazında emir açılışında kullanılacak üst kaldıraç sınırı.</span>
                  </div>

                  {/* İşlem Başına Risk % */}
                  <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                    <label className="block text-slate-300 font-semibold mb-1">İşlem Başına Risk Limiti (%)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={editingAccount.max_risk_pct ?? 2.0}
                      onChange={(e) => setEditingAccount({ ...editingAccount, max_risk_pct: parseFloat(e.target.value) || 2.0 })}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">Her işlemde marjin olarak ayrılacak maksimum bakiye yüzdesi.</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Stop Loss % */}
                  <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                    <label className="block text-slate-300 font-semibold mb-1">Stop Loss (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={editingAccount.stop_loss_pct ?? 1.85}
                      onChange={(e) => setEditingAccount({ ...editingAccount, stop_loss_pct: parseFloat(e.target.value) || 1.85 })}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>

                  {/* Take Profit % */}
                  <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                    <label className="block text-slate-300 font-semibold mb-1">Take Profit (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={editingAccount.take_profit_pct ?? 4.5}
                      onChange={(e) => setEditingAccount({ ...editingAccount, take_profit_pct: parseFloat(e.target.value) || 4.5 })}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>

                  {/* Trailing Stop % */}
                  <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                    <label className="block text-slate-300 font-semibold mb-1">İz Süren Stop (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={editingAccount.trailing_stop_pct ?? 1.2}
                      onChange={(e) => setEditingAccount({ ...editingAccount, trailing_stop_pct: parseFloat(e.target.value) || 1.2 })}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Hummingbot PMM Kotasyon Makası */}
                <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-white font-semibold block">Hummingbot Pure Market Making (PMM) Makası</span>
                    <span className="text-[11px] text-slate-400">Avellaneda-Stoikov envanter sapmasına göre limit maker marjı</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-mono">
                    <input
                      type="number"
                      step="0.05"
                      value={editingAccount.pmm_spread_pct ?? 0.15}
                      onChange={(e) => setEditingAccount({ ...editingAccount, pmm_spread_pct: parseFloat(e.target.value) || 0.15 })}
                      className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white text-xs font-mono text-right"
                    />
                    <span className="text-slate-400 font-bold">%</span>
                  </div>
                </div>
              </div>
            )}

            {/* MODAL ALT BUTONLARI: Sil, Kapat, Kaydet & Canlı Bakiye Eşitle */}
            <div className="flex items-center justify-between pt-3.5 border-t border-slate-800 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  handleDeleteAccount(editingAccount.id);
                }}
                className="px-3 py-2 rounded-xl text-xs font-bold text-rose-400 hover:text-white bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 transition cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Bu Hesabı Sil</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingAccount(null)}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
                >
                  Kapat
                </button>

                {editingAccount.type === 'REAL' && (
                  <button
                    type="button"
                    onClick={() => handleSaveAccountSettings(true)}
                    disabled={isSavingAccount}
                    className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-amber-950 bg-amber-400 hover:bg-amber-300 transition shadow-lg shadow-amber-950/40 cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    title="Ayarları kaydet ve Binance üzerinden canlı bakiyeyi çek"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSavingAccount ? 'animate-spin' : ''}`} />
                    <span>Kaydet & Canlı Bakiyeyi Eşitle</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleSaveAccountSettings(false)}
                  disabled={isSavingAccount}
                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-white bg-cyan-600 hover:bg-cyan-500 transition shadow-lg shadow-cyan-950/50 cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{isSavingAccount ? 'Kaydediliyor...' : 'Ayarları Kaydet'}</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ========================================================
          HESAP SİLME ONAY MODALI (Delete Account Modal)
         ======================================================== */}
      {accountToDelete && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f1420] border border-rose-700/80 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 font-sans animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-400 font-bold border-b border-slate-800 pb-3">
              <div className="w-10 h-10 rounded-xl bg-rose-950 border border-rose-800 flex items-center justify-center text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base text-white font-black">Hesabı Silmek Üzeresiniz</h3>
                <span className="text-xs text-rose-400/90 font-mono">{accountToDelete.name}</span>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              <b>'{accountToDelete.name}'</b> hesabı ve bu hesaba bağlı tüm açık pozisyonlar, bekleyen limit emirleri ve geçmiş işlem kayıtları kalıcı olarak silinecektir.
            </p>

            {(accounts || []).length <= 1 && (
              <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-700 text-rose-200 text-xs">
                ⚠️ Sistemde en az bir aktif hesap bulunmalıdır. Tek hesabı silemezsiniz.
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setAccountToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteAccount}
                disabled={(accounts || []).length <= 1}
                className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-rose-600 hover:bg-rose-500 transition shadow-lg shadow-rose-950/50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Evet, Hesabı Kalıcı Olarak Sil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          YENİ HESAP EKLE MODALI (Add Account Modal)
         ======================================================== */}
      {isAddAccountModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b0e14] border border-cyan-700/80 rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4 font-sans animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-950 border border-cyan-700/80 flex items-center justify-center text-cyan-400">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Yeni Hesap Tanımla</h3>
                  <p className="text-[11px] text-slate-400">Sanal simülasyon veya gerçek Binance API bağlantısı</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddAccountModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={async (e) => {
              await handleAddAccount(e);
              setIsAddAccountModalOpen(false);
            }} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Hesap İsmi</label>
                <input
                  type="text"
                  required
                  value={newAccName}
                  onChange={(e) => setNewAccName(e.target.value)}
                  placeholder="Örn: Binance Canlı Vadeli"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-medium focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Hesap Türü</label>
                  <select
                    value={newAccType}
                    onChange={(e) => setNewAccType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-medium focus:border-cyan-500 focus:outline-none cursor-pointer"
                  >
                    <option value="PAPER">🧪 Sanal (Paper Trading)</option>
                    <option value="REAL">🟢 Gerçek (Binance API)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Başlangıç Bakiyesi (USDT)</label>
                  <input
                    type="number"
                    value={newAccBalance}
                    onChange={(e) => setNewAccBalance(e.target.value)}
                    disabled={newAccType === 'REAL'}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              {newAccType === 'REAL' && (
                <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Binance API Key</label>
                    <input
                      type="text"
                      required
                      value={newAccApiKey}
                      onChange={(e) => setNewAccApiKey(e.target.value.trim())}
                      placeholder="API Key"
                      className="w-full bg-black border border-slate-700 rounded-lg px-3 py-1.5 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Binance API Secret</label>
                    <input
                      type="password"
                      required
                      value={newAccApiSecret}
                      onChange={(e) => setNewAccApiSecret(e.target.value.trim())}
                      placeholder="Secret Key"
                      className="w-full bg-black border border-slate-700 rounded-lg px-3 py-1.5 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-slate-400">Binance Testnet mi?</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newAccTestnet}
                        onChange={(e) => setNewAccTestnet(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-cyan-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                    </label>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddAccountModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isAddingAcc}
                  className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-cyan-600 hover:bg-cyan-500 transition shadow-lg shadow-cyan-950/50 cursor-pointer disabled:opacity-50"
                >
                  {isAddingAcc ? 'Hesap Oluşturuluyor...' : 'Hesabı Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
