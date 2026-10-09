"""AegisQuant v3.0 - Sentinel Autonomous Risk Agent.
Monitors free margin, portfolio exposure, ATR volatility, and applies Kelly Criterion.
"""
from typing import Dict, Any, Optional
from app.db import db


class RiskSentinel:
    def __init__(self):
        self.default_risk_pct = 2.0
        self.max_leverage_cap = 20

    def is_enabled(self) -> bool:
        return db.get_setting("sentinel_auto_risk", "true").lower() == "true"

    def set_enabled(self, enabled: bool):
        db.set_setting("sentinel_auto_risk", "true" if enabled else "false")
        db.log(f"SENTINEL Otonom Risk Modu: {'AÇIK' if enabled else 'KAPALI'}", "INFO", "SENTINEL")

    def get_status(self, account_id: Optional[str] = None) -> Dict[str, Any]:
        acc_id = account_id or db.get_setting("active_account_id", "acc_alpha")
        acc = db.get_account(acc_id)
        balance = float(acc["balance"]) if acc else 10000.0
        positions = db.get_open_positions(acc_id)

        total_margin = sum(float(p.get("margin", 0.0)) for p in positions)
        total_unrealized_pnl = sum(float(p.get("pnl", 0.0)) for p in positions)
        exposure_pct = round((total_margin / balance * 100.0), 2) if balance > 0 else 0.0
        free_margin = max(0.0, balance - total_margin + total_unrealized_pnl)

        # Volatility / Market condition assessment
        chop_index = "NORMAL"
        recommended_leverage = 5
        recommended_risk_pct = 2.0

        if exposure_pct > 60.0:
            chop_index = "CRITICAL_EXPOSURE"
            recommended_leverage = 2
            recommended_risk_pct = 1.0
        elif exposure_pct > 35.0:
            chop_index = "ELEVATED"
            recommended_leverage = 3
            recommended_risk_pct = 1.5

        return {
            "enabled": self.is_enabled(),
            "account_id": acc_id,
            "balance": balance,
            "free_margin": round(free_margin, 2),
            "margin_used": round(total_margin, 2),
            "exposure_pct": exposure_pct,
            "open_positions_count": len(positions),
            "regime": chop_index,
            "dynamic_leverage": recommended_leverage,
            "dynamic_risk_pct": recommended_risk_pct,
            "status_text": "🛡️ KORUMA AKTİF" if self.is_enabled() else "⚠️ PASİF"
        }

    def calculate_position_parameters(
        self,
        account_id: str,
        symbol: str,
        price: float,
        atr: float = 0.0,
        win_rate: float = 50.0,
        user_leverage: Optional[int] = None
    ) -> Dict[str, Any]:
        """Calculates optimal position size and leverage using Kelly Criterion and ATR.
        Strictly respects user_leverage preference, reducing by max 50% only on extreme volatility (>5% ATR).
        """
        acc = db.get_account(account_id)
        balance = float(acc["balance"]) if acc else 10000.0
        
        # User preferred leverage from settings / param (default 20 if set or user chosen)
        if user_leverage is None or user_leverage <= 0:
            try:
                user_leverage = int(db.get_setting("leverage_cap", "20"))
            except Exception:
                user_leverage = 20

        if not self.is_enabled():
            return {
                "leverage": user_leverage,
                "margin": min(500.0, balance * 0.05),
                "stop_loss_pct": 1.5,
                "take_profit_pct": 3.0,
                "sentinel_adjusted": False
            }

        # Kelly Criterion estimation for position margin sizing
        p = max(0.2, min(0.8, win_rate / 100.0))
        b = 1.8
        q = 1.0 - p
        kelly_fraction = max(0.01, min(0.05, (p * b - q) / b))

        # ATR Volatility adaptation
        atr_pct = (atr / price * 100.0) if (price > 0 and atr > 0) else 1.2
        leverage = user_leverage

        if atr_pct > 5.0:
            # Extreme volatility (> 5% ATR): trim leverage by max 50%
            leverage = max(1, int(user_leverage * 0.5))
            sl_pct = min(4.0, atr_pct * 1.1)
            tp_pct = sl_pct * 2.0
            kelly_fraction *= 0.7
        elif atr_pct > 2.5:
            # Elevated volatility: trim leverage slightly (by 25%)
            leverage = max(1, int(user_leverage * 0.75))
            sl_pct = min(3.0, atr_pct * 1.0)
            tp_pct = sl_pct * 1.8
            kelly_fraction *= 0.85
        else:
            # Normal / low volatility: 100% full user leverage
            leverage = user_leverage
            sl_pct = 1.5
            tp_pct = 3.0

        margin = round(balance * kelly_fraction, 2)
        margin = max(10.0, min(margin, balance * 0.15))

        return {
            "leverage": leverage,
            "margin": margin,
            "stop_loss_pct": round(sl_pct, 2),
            "take_profit_pct": round(tp_pct, 2),
            "sentinel_adjusted": True
        }


sentinel = RiskSentinel()
risk_sentinel = sentinel
