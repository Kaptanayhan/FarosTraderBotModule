import React, { createContext, useContext, useState, useEffect } from 'react';

const API_BASE = window.location.origin.includes(':5173') ? 'http://localhost:8000' : '';

const AccountContext = createContext();

export function AccountProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [engineState, setEngineState] = useState('STOPPED'); // RUNNING | STOPPING | STOPPED
  const [stopMode, setStopMode] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const fetchAccounts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts`);
      if (res.ok) {
        const data = await res.json();
        const rawAccounts = data.accounts || [];
        // A-Z Alphabetical sort
        const sorted = rawAccounts.sort((a, b) => a.name.localeCompare(b.name));
        setAccounts(sorted);

        const savedId = localStorage.getItem('faros_active_account_id');
        let matched = sorted.find(a => a.id === savedId);
        if (!matched && sorted.length > 0) {
          matched = sorted[0];
          localStorage.setItem('faros_active_account_id', matched.id);
        }

        if (matched) {
          setActiveAccount(matched);
          setEngineState(matched.engine_state || 'STOPPED');
          setStopMode(matched.stop_mode || '');
        }
      }
    } catch (err) {
      console.warn('Accounts fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const selectAccount = async (accId) => {
    localStorage.setItem('faros_active_account_id', accId);
    const target = accounts.find(a => a.id === accId);
    if (target) {
      setActiveAccount(target);
      setEngineState(target.engine_state || 'STOPPED');
      setStopMode(target.stop_mode || '');
      try {
        await fetch(`${API_BASE}/api/accounts/active`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: accId })
        });
      } catch (err) {
        console.error('Select active account error:', err);
      }
    }
  };

  const updateAccountBalance = async (accId, newBal) => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${accId}/balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: parseFloat(newBal) })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.account) {
          setActiveAccount(data.account);
          setAccounts(prev => prev.map(a => a.id === data.account.id ? data.account : a));
        }
        return true;
      }
    } catch (err) {
      console.error('Update balance error:', err);
    }
    return false;
  };

  const startEngine = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/engine/start`, { method: 'POST' });
      if (res.ok) {
        setEngineState('RUNNING');
        setStatusMessage('Motor aktif edildi! 2 paritede garantili ilk emirler planlandı.');
        fetchAccounts();
        setTimeout(() => setStatusMessage(''), 5000);
        return true;
      }
    } catch (err) {
      console.error('Start engine error:', err);
    }
    return false;
  };

  const stopEngine = async (mode = 'MARKET') => {
    setEngineState('STOPPING');
    setStopMode(mode);
    try {
      const res = await fetch(`${API_BASE}/api/engine/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });
      if (res.ok) {
        const data = await res.json();
        setEngineState(data.engine_state || 'STOPPED');
        setStatusMessage(data.message || 'İşlem tamamlandı, bot durduruldu, açık emir yok.');
        fetchAccounts();
        setTimeout(() => setStatusMessage(''), 7000);
        return true;
      }
    } catch (err) {
      console.error('Stop engine error:', err);
    }
    return false;
  };

  const syncAccountBalance = async (accId) => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${accId}/sync-balance`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage(`✅ ${data.message || 'Binance bakiyesi başarıyla çekildi!'}`);
        fetchAccounts();
        setTimeout(() => setStatusMessage(''), 5000);
        return { success: true, balance: data.balance, details: data.details };
      } else {
        const errorMsg = data.detail || data.error || 'Bakiye çekilemedi';
        setStatusMessage(`❌ Binance Hatası: ${errorMsg}`);
        setTimeout(() => setStatusMessage(''), 7000);
        return { success: false, error: errorMsg };
      }
    } catch (err) {
      console.error('Sync balance error:', err);
      setStatusMessage(`❌ Bağlantı hatası: ${err.message}`);
      return { success: false, error: err.message };
    }
  };

  const editAccount = async (accId, updatedData) => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${accId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedData)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage('✅ Hesap ayarları başarıyla kaydedildi.');
        fetchAccounts();
        setTimeout(() => setStatusMessage(''), 4000);
        return { success: true, account: data.account };
      } else {
        const msg = data.detail || 'Hesap güncellenemedi';
        return { success: false, error: msg };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  const deleteAccount = async (accId) => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts/${accId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage('Hesap silindi.');
        fetchAccounts();
        setTimeout(() => setStatusMessage(''), 4000);
        return true;
      }
    } catch (err) {
      console.error('Delete account error:', err);
    }
    return false;
  };

  const addAccount = async (accountData) => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountData)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage('Yeni hesap eklendi.');
        fetchAccounts();
        if (data.account) selectAccount(data.account.id);
        setTimeout(() => setStatusMessage(''), 4000);
        return { success: true, account: data.account };
      } else {
        return { success: false, error: data.detail || 'Hesap eklenemedi' };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  const testAccountCredentials = async (credentials) => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts/test-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });
      const data = await res.json();
      return data;
    } catch (err) {
      return { success: false, detail: err.message };
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  return (
    <AccountContext.Provider
      value={{
        accounts,
        activeAccount,
        isLoading,
        engineState,
        stopMode,
        statusMessage,
        setStatusMessage,
        setAccounts,
        setActiveAccount,
        setEngineState,
        setStopMode,
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
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  return useContext(AccountContext);
}
