"""AegisQuant Spot Vault Manager (%25 Profit Sweeper).
Locks and transfers 25% of net profits to a protected spot vault whenever account balance doubles (2x).
"""
import asyncio
from typing import Dict, Any, Optional
from app.db import db


class VaultManager:
    def check_and_sweep_vault(self, account_id: str) -> Optional[Dict[str, Any]]:
        acc = db.get_account(account_id)
        if not acc:
            return None

        balance = float(acc.get("balance", 0.0))
        initial_balance = float(acc.get("initial_balance", 10000.0))
        if initial_balance <= 0:
            initial_balance = 10000.0

        spot_vault_balance = float(acc.get("spot_vault_balance") or 0.0)
        vault_target = float(acc.get("vault_target") or 0.0)
        if vault_target <= 0:
            vault_target = initial_balance * 2.0

        # Trigger rule: balance has doubled relative to the hurdle
        if balance >= vault_target and balance > initial_balance:
            net_profit = balance - initial_balance
            sweep_amount = round(net_profit * 0.25, 2)
            if sweep_amount <= 0:
                return None

            new_balance = round(balance - sweep_amount, 2)
            new_vault = round(spot_vault_balance + sweep_amount, 2)
            next_target = round(vault_target + initial_balance, 2)

            db.update_account_vault(account_id, new_balance, new_vault, next_target)

            import uuid
            tx_id = f"vtx_{uuid.uuid4().hex[:10]}"
            db.record_vault_transaction({
                "id": tx_id,
                "account_id": account_id,
                "transfer_amount": sweep_amount,
                "old_balance": balance,
                "new_balance": new_balance,
                "spot_vault_balance": new_vault,
                "vault_target": next_target,
            })

            log_msg = (
                f"🛡️ [KASA KORUMASI]: Kasa 2 katına ulaştı ({balance:.2f} >= {vault_target:.2f} USDT). "
                f"Kârın %25'i ({sweep_amount:.2f} USDT) güvenli Spot Kasaya aktarıldı!"
            )
            db.log(log_msg, "WARN", "VAULT")

            # Async Telegram notification
            try:
                loop = asyncio.get_running_loop()
                from app.services.telegram import telegram
                tg_msg = (
                    f"🛡️ <b>[KASA KORUMASI TETİKLENDİ]</b>\n"
                    f"━━━━━━━━━━━━━━━━━━━\n"
                    f"👤 <b>Hesap:</b> {acc['name']}\n"
                    f"🚀 <b>Kasa 2 Katına Ulaştı!</b>\n"
                    f"💰 <b>Eski Vadeli Bakiye:</b> ${balance:.2f} USDT\n"
                    f"🏦 <b>Spot Kasaya Aktarılan (%25):</b> <code>+${sweep_amount:.2f} USDT</code>\n"
                    f"💵 <b>Yeni Vadeli Bakiye:</b> ${new_balance:.2f} USDT\n"
                    f"🔒 <b>Toplam Spot Kasa:</b> ${new_vault:.2f} USDT\n"
                    f"🎯 <b>Bir Sonraki Hedef:</b> ${next_target:.2f} USDT"
                )
                loop.create_task(telegram.send_message(tg_msg))
            except RuntimeError:
                pass
            except Exception as e:
                db.log(f"Telegram kasa bildirimi hatası: {e}", "WARN", "VAULT")

            return {
                "swept": True,
                "account_id": account_id,
                "net_profit": round(net_profit, 2),
                "transfer_amount": sweep_amount,
                "swept_amount": sweep_amount,
                "new_balance": new_balance,
                "spot_vault_balance": new_vault,
                "next_target": next_target
            }

        return None


vault_manager = VaultManager()
