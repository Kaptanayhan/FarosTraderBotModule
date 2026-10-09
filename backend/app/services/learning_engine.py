"""FAROS Learning Engine - Multi-Armed Bandit / Dynamic Agent Weighting System.
Tracks wins, losses, consecutive losses, and adjusts agent margin authority dynamically.
"""
from typing import Dict, Any, List, Optional
import time
from app.db import db


class LearningEngine:
    def __init__(self):
        self.min_weight = 0.10
        self.max_weight = 0.70
        self._cooldowns: Dict[str, float] = {}

    def is_agent_in_cooldown(self, agent_id: str) -> bool:
        exp = self._cooldowns.get(agent_id, 0.0)
        return time.time() < exp

    def get_cooldown_remaining(self, agent_id: str) -> int:
        exp = self._cooldowns.get(agent_id, 0.0)
        rem = exp - time.time()
        return max(0, int(rem))

    def get_agents(self) -> List[Dict[str, Any]]:
        agents = db.get_agent_metrics()
        now = time.time()
        for a in agents:
            ag_id = a.get("agent_id", "")
            exp = self._cooldowns.get(ag_id, 0.0)
            if now < exp:
                a["status"] = "[DİNLENMEDE]"
                a["in_cooldown"] = True
                a["cooldown_remaining"] = int(exp - now)
            else:
                a["in_cooldown"] = False
                a["cooldown_remaining"] = 0
                if a.get("status") == "[DİNLENMEDE]":
                    a["status"] = "AKTİF"
        return agents

    def get_agent_by_name(self, agent_name: str) -> Optional[Dict[str, Any]]:
        agents = self.get_agents()
        for a in agents:
            if a["name"].lower() in agent_name.lower() or agent_name.lower() in a["name"].lower():
                return a
            if a["agent_id"].lower() in agent_name.lower() or agent_name.lower() in a["agent_id"].lower():
                return a
        return agents[0] if agents else None

    def get_margin_multiplier(self, agent_name: str) -> float:
        """Returns margin multiplier for the agent (boosted if winning, halved if 2+ consecutive losses)."""
        ag = self.get_agent_by_name(agent_name)
        if not ag:
            return 1.0
        consec_losses = int(ag.get("consecutive_losses", 0))
        weight = float(ag.get("weight", 0.33))

        # Base multiplier derived from weight: weight 0.33 -> 1.0x, weight 0.50 -> 1.5x
        multiplier = max(0.5, weight / 0.33)

        # Rule: 2 or more consecutive losses cut margin authority by 50%
        if consec_losses >= 2:
            multiplier *= 0.5
            db.log(
                f"[{ag['name']}] DİKKAT: Peş peşe {consec_losses} zarar nedeniyle marjin yetkisi %50 kısıtlandı (Çarpan: {multiplier:.2f}x).",
                "WARN", "LEARNING"
            )

        return round(multiplier, 2)

    def record_trade_outcome(self, agent_name: str, net_pnl: float):
        """Called whenever a trade finishes to update win/loss record and adaptively re-weight agents."""
        ag = self.get_agent_by_name(agent_name)
        if not ag:
            return

        agent_id = ag["agent_id"]
        win_count = int(ag["win_count"])
        loss_count = int(ag["loss_count"])
        consec_losses = int(ag["consecutive_losses"])
        current_weight = float(ag["weight"])
        total_pnl = float(ag["total_pnl"]) + net_pnl

        is_win = net_pnl > 0
        if is_win:
            win_count += 1
            consec_losses = 0
            self._cooldowns.pop(agent_id, None)
            # Boost weight
            new_weight = min(self.max_weight, current_weight + 0.05)
            db.log(
                f"[Öğrenme Motoru] {ag['name']} BAŞARILI İŞLEM (+${net_pnl:.2f}). Ağırlığı artırıldı: %{new_weight*100:.1f}",
                "INFO", "LEARNING"
            )
        else:
            loss_count += 1
            consec_losses += 1
            # Penalize weight
            new_weight = max(self.min_weight, current_weight - 0.05)
            db.log(
                f"[Öğrenme Motoru] {ag['name']} ZARAR ({net_pnl:+.2f}). Peş peşe zarar: {consec_losses}. Ağırlığı düşürüldü: %{new_weight*100:.1f}",
                "WARN", "LEARNING"
            )
            if consec_losses >= 2:
                self._cooldowns[agent_id] = time.time() + 45 * 60
                db.log(
                    f"[Öğrenme Motoru] {ag['name']} 2 ardışık zarar nedeniyle 45 dakika dinlenmeye alındı [DİNLENMEDE].",
                    "WARN", "COOLDOWN"
                )

        status_val = "[DİNLENMEDE]" if self.is_agent_in_cooldown(agent_id) else ag.get("status", "AKTİF")

        # Update specific agent metric
        db.update_agent_metric(
            agent_id,
            win_count=win_count,
            loss_count=loss_count,
            consecutive_losses=consec_losses,
            weight=new_weight,
            total_pnl=total_pnl,
            status=status_val
        )

        # Re-normalize all agent weights so their sum is exactly 1.0
        self._normalize_weights()

    def _normalize_weights(self):
        agents = db.get_agent_metrics()
        if not agents:
            return
        total = sum(float(a["weight"]) for a in agents)
        if total <= 0:
            return
        for a in agents:
            normalized = max(self.min_weight, min(self.max_weight, float(a["weight"]) / total))
            db.update_agent_metric(a["agent_id"], weight=round(normalized, 3))

    def update_agent_status(self, agent_id: str, status: str, symbol: str = ""):
        kwargs = {"status": status}
        if symbol:
            kwargs["last_target_symbol"] = symbol
        db.update_agent_metric(agent_id, **kwargs)


learning_engine = LearningEngine()
