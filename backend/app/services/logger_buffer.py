"""In-Memory Ring Buffer for High-Frequency Telemetry & System Logs.
Eliminates SQLite disk locking under heavy concurrent read/write loads.
"""
from collections import deque
import threading
from datetime import datetime
from typing import List, Dict, Any, Optional


class LoggerBuffer:
    def __init__(self, maxlen: int = 1000):
        self._buffer: deque = deque(maxlen=maxlen)
        self._lock = threading.Lock()

    def add_log(self, message: str, level: str = "INFO", source: str = "SYSTEM") -> Optional[Dict[str, Any]]:
        msg = str(message)
        lvl = level.upper()
        src = source.upper()

        # Noise filter: suppress micro scanning / candidate queue logs
        noise_keywords = [
            "Dinamik Konsey Taraması",
            "Toplu Hızlı Tarama Sinyali",
            "Non-blocking Hunter",
            "Binance Futures WebSocket",
            "ExchangeInfo önbelleklendi",
            "oylaması yapıldı",
            "radar taraması"
        ]
        if any(k.lower() in msg.lower() for k in noise_keywords) and lvl not in ("ERROR", "CRITICAL"):
            return None

        # Allow critical events & heartbeats:
        # 🟢 [İŞLEM AÇILDI] / POZİSYON AÇILDI
        # 🎯 [TP ALINDI] / Take Profit Tetiklendi
        # 🛑 [STOP OLUNDU] / Stop Loss Tetiklendi
        # 🏦 [SPOT KASA AKTARIMI] / KASA KORUMASI / VAULT
        # 🚨 [SENTINEL / RİSK UYARISI] / WARN / ERROR / TRADE / POSITION / BROKER
        # ⏱️ [SİSTEM AKTİF] Heartbeat
        is_essential = (
            lvl in ("WARN", "ERROR", "CRITICAL", "TRADE") or
            src in ("BROKER", "POSITION", "VAULT", "SENTINEL", "ORCHESTRATOR", "ACCOUNT") or
            any(w in msg for w in [
                "POZİSYON", "İŞLEM", "Take Profit", "Stop Loss", "KASA KORUMASI", 
                "Kasa", "SENTINEL", "Risk", "VETO", "TP", "SL", "SİSTEM AKTİF"
            ])
        )

        # If it's an ordinary low-priority info not related to core lifecycle, ignore
        if not is_essential and lvl == "INFO":
            return None

        entry = {
            "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
            "level": lvl,
            "source": src,
            "message": msg
        }
        with self._lock:
            self._buffer.append(entry)
        return entry

    def get_logs(self, limit: int = 100) -> List[Dict[str, Any]]:
        with self._lock:
            items = list(self._buffer)
        if limit and limit > 0:
            items = items[-limit:]
        return items

    def clear(self):
        with self._lock:
            self._buffer.clear()


logger_buffer = LoggerBuffer(maxlen=1000)
