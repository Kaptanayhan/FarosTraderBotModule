"""
Test suite for Dynamic ATR Take-Profit / Stop-Loss and Auto 25% Spot Vault Sweeper
"""
import sys
import os
import sqlite3

# Ensure app path is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "app")))

from app.db import db, now_iso
from app.services.paper_broker import paper_broker
from app.services.vault_manager import vault_manager

def run_tests():
    print("=== STARTING PROFIT & VAULT TEST SUITE ===")
    
    # Setup test account
    test_acc_id = "test_acc_atr_vault"
    with db._get_conn() as conn:
        conn.execute("DELETE FROM positions WHERE account_id = ?", (test_acc_id,))
        conn.execute("DELETE FROM orders WHERE account_id = ?", (test_acc_id,))
        conn.execute("DELETE FROM vault_transactions WHERE account_id = ?", (test_acc_id,))
        conn.execute("DELETE FROM accounts WHERE id = ?", (test_acc_id,))
        conn.execute("""
            INSERT INTO accounts (id, name, balance, initial_balance, spot_vault_balance, vault_target, engine_state, created_at, updated_at)
            VALUES (?, 'ATR Vault Test Account', 100.0, 100.0, 0.0, 200.0, 'RUNNING', ?, ?)
        """, (test_acc_id, now_iso(), now_iso()))

    acc = db.get_account(test_acc_id)
    assert acc["balance"] == 100.0, f"Expected 100.0 initial balance, got {acc['balance']}"
    assert acc["initial_balance"] == 100.0
    assert acc["spot_vault_balance"] == 0.0
    print("[PASS] Step 1: Test account initialized with 100.0 USDT")

    # Step 2: Open position with dynamic ATR
    symbol = "BTCUSDT"
    entry_price = 60000.0
    atr = 400.0
    
    # Calculation:
    # LONG: SL = entry - 1.0 * atr = 60000 - 400 = 59600.0
    # LONG: TP = entry + 1.5 * atr = 60000 + 600 = 60600.0
    expected_sl = 59600.0
    expected_tp = 60600.0
    
    pos = paper_broker.open_position_direct(
        account_id=test_acc_id,
        symbol=symbol,
        side="LONG",
        entry_price=entry_price,
        size=0.1,
        leverage=10,
        atr=atr,
        stop_loss=expected_sl,
        take_profit=expected_tp
    )

    assert pos is not None, "Failed to create direct position"
    assert pos["stop_loss"] == expected_sl, f"Expected SL {expected_sl}, got {pos['stop_loss']}"
    assert pos["take_profit"] == expected_tp, f"Expected TP {expected_tp}, got {pos['take_profit']}"
    print(f"[PASS] Step 2: Dynamic ATR calculated - Entry: {entry_price}, ATR: {atr}, SL: {pos['stop_loss']}, TP: {pos['take_profit']}")

    # Step 3: Trigger TP with Best Bid = 60650.0 USDT
    simulated_best_bid = 60650.0
    simulated_best_ask = 60655.0
    res = paper_broker.check_position_tp_sl(
        pos_id=pos["id"],
        best_bid=simulated_best_bid,
        best_ask=simulated_best_ask,
        mark_price=simulated_best_bid
    )

    assert res is not None, f"Expected trigger response, got {res}"
    assert res["reason"] == "Take Profit Tetiklendi"
    assert res["exit_price"] == simulated_best_bid

    # Verify position is closed in db
    with db._get_conn() as conn:
        pos_row = conn.execute("SELECT * FROM positions WHERE id = ?", (pos["id"],)).fetchone()
        assert pos_row["status"] == "CLOSED", f"Position status should be CLOSED, got {pos_row['status']}"
        trade_row = conn.execute("SELECT * FROM trades WHERE account_id = ? ORDER BY closed_at DESC LIMIT 1", (test_acc_id,)).fetchone()
        assert trade_row["exit_price"] == simulated_best_bid, f"Expected exit_price {simulated_best_bid}, got {trade_row['exit_price']}"
        
    print(f"[PASS] Step 3: TP executed at Best Bid {simulated_best_bid} USDT. Position CLOSED. Realized PnL credited.")

    # Step 4: Simulate Balance @ 205.0 USDT and Trigger Vault Sweeper
    # Net profit: 205 - 100 = 105 USDT
    # 25% sweep: 105 * 0.25 = 26.25 USDT
    # Remaining balance: 205 - 26.25 = 178.75 USDT
    # Spot Vault balance: 26.25 USDT
    # Next hurdle: 200 + 100 = 300.0 USDT
    with db._get_conn() as conn:
        conn.execute("UPDATE accounts SET balance = 205.0 WHERE id = ?", (test_acc_id,))

    sweep_res = vault_manager.check_and_sweep_vault(test_acc_id)
    assert sweep_res is not None, "Sweep should have triggered!"
    assert sweep_res["swept"] is True
    assert sweep_res["net_profit"] == 105.0, f"Expected net profit 105.0, got {sweep_res['net_profit']}"
    assert sweep_res["transfer_amount"] == 26.25, f"Expected transfer 26.25, got {sweep_res['transfer_amount']}"
    assert sweep_res["new_balance"] == 178.75, f"Expected balance 178.75, got {sweep_res['new_balance']}"
    assert sweep_res["spot_vault_balance"] == 26.25, f"Expected vault 26.25, got {sweep_res['spot_vault_balance']}"
    assert sweep_res["next_target"] == 300.0, f"Expected next target 300.0, got {sweep_res['next_target']}"
    print(f"[PASS] Step 4: Vault Sweeper executed - Net Profit: {sweep_res['net_profit']} USDT, Transferred: {sweep_res['transfer_amount']} USDT, Remaining: {sweep_res['new_balance']} USDT, Vault: {sweep_res['spot_vault_balance']} USDT, Next Hurdle: {sweep_res['next_target']} USDT")

    # Step 5: Verify Vault Transactions Table
    txs = db.get_vault_transactions(test_acc_id)
    assert len(txs) == 1, f"Expected 1 transaction, got {len(txs)}"
    tx = txs[0]
    assert tx["transfer_amount"] == 26.25, f"Expected transfer_amount 26.25, got {tx['transfer_amount']}"
    assert tx["new_balance"] == 178.75, f"Expected new_balance 178.75, got {tx['new_balance']}"
    assert tx["spot_vault_balance"] == 26.25, f"Expected spot_vault_balance 26.25, got {tx['spot_vault_balance']}"
    assert tx["vault_target"] == 300.0, f"Expected vault_target 300.0, got {tx['vault_target']}"
    print("[PASS] Step 5: Vault transactions table audit successful.")

    # Cleanup
    with db._get_conn() as conn:
        conn.execute("DELETE FROM positions WHERE account_id = ?", (test_acc_id,))
        conn.execute("DELETE FROM orders WHERE account_id = ?", (test_acc_id,))
        conn.execute("DELETE FROM vault_transactions WHERE account_id = ?", (test_acc_id,))
        conn.execute("DELETE FROM accounts WHERE id = ?", (test_acc_id,))

    print("=== ALL TESTS PASSED SUCCESSFULLY (100% OK) ===")

if __name__ == "__main__":
    run_tests()
