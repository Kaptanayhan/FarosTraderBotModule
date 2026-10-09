"""Capital Tier Manager - Dynamic Tiered Capital Allocation.
Handles automated engine mode switching based on live total equity:
- Tier 1: Turbo Scalp (< 1000 USDT)
    * Fast micro profits: TP +%2.0, SL %1.1, Breakeven at +%1.0, Max holding 45 mins.
- Tier 2: Hybrid Sniper (>= 1000 USDT)
    * 50/50 dual allocation:
      - Slot 1 (Micro Flow): 50% margin, TP +%2.0
      - Slot 2 (Big Hunt): 50% margin, TP +%8.0+, Trailing Stop kicks in at +%3.0
"""
from typing import Dict, Any, Optional
from app.db import db


class CapitalTierManager:
    def __init__(self):
        self.tier_threshold: float = 1000.0

    def get_tier_parameters(self, total_equity: float, slot_index: int = 0) -> Dict[str, Any]:
        """Returns dynamic trading parameters tailored to the current capital tier.
        Args:
            total_equity: Total wallet balance + unrealized PnL.
            slot_index: 0 for Slot 1 (Micro Flow), 1 for Slot 2 (Big Hunt) in Hybrid mode.
        """
        eq = max(0.0, float(total_equity))

        if eq < self.tier_threshold:
            # TIER-1: TURBO SCALP (< 1000 USDT)
            return {
                "mode": "TURBO_SCALP",
                "tier_name": "Tier-1 (Turbo Scalp)",
                "target_tp_pct": 2.00,        # +%2.0 hızlı net kâr
                "stop_loss_pct": 1.10,        # %1.1 korumalı sert stop
                "breakeven_trigger_pct": 1.00,# +%1.0'da başabaş
                "trailing_trigger_pct": 2.50, # +%2.5'te trailing kâr kilidi
                "max_holding_seconds": 2700,  # 45 dakika (2700s)
                "margin_allocation_pct": 0.15 # tek işlemde %15 marjin
            }
        else:
            # TIER-2: 50/50 HYBRID SNIPER (>= 1000 USDT)
            if slot_index % 2 == 1:
                # Slot 2 (Büyük Av - Trend Runner)
                return {
                    "mode": "HYBRID_SNIPER",
                    "slot_type": "BIG_HUNT",
                    "tier_name": "Tier-2 (Hybrid Sniper - Büyük Av)",
                    "target_tp_pct": 8.50,        # +%8.50 büyük hedef
                    "stop_loss_pct": 1.85,        # 1.85x ATR uyumlu geniş stop
                    "breakeven_trigger_pct": 2.50,# +%2.5'te breakeven
                    "trailing_trigger_pct": 3.00, # +%3.0'dan sonra Trailing Stop ile kâr sür
                    "max_holding_seconds": 14400, # 4 saat (14400s)
                    "margin_allocation_pct": 0.50 # %50 sermaye dilimi
                }
            else:
                # Slot 1 (Mikro Akış - Hızlı Scalp)
                return {
                    "mode": "HYBRID_SNIPER",
                    "slot_type": "MICRO_FLOW",
                    "tier_name": "Tier-2 (Hybrid Sniper - Mikro Akış)",
                    "target_tp_pct": 2.00,        # +%2.0 hızlı kâr
                    "stop_loss_pct": 1.10,        # %1.1 korumalı stop
                    "breakeven_trigger_pct": 1.00,# +%1.0'da breakeven
                    "trailing_trigger_pct": 2.50, # +%2.5'te trailing
                    "max_holding_seconds": 2700,  # 45 dakika
                    "margin_allocation_pct": 0.50 # %50 sermaye dilimi
                }


capital_tier_manager = CapitalTierManager()
