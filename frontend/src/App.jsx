import React from 'react';
import { AccountProvider } from './context/AccountContext';
import UnifiedQuantCockpit from './pages/UnifiedQuantCockpit';

export default function App() {
  return (
    <AccountProvider>
      <UnifiedQuantCockpit />
    </AccountProvider>
  );
}
