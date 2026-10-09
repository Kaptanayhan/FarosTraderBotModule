#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "⚡ =================================================== ⚡"
echo "   FAROS v3.0 - Binance Futures Dynamic Trading Cockpit "
echo "⚡ =================================================== ⚡"

if [ ! -d "backend/.venv" ]; then
    echo "📦 Python ortamı (backend/.venv) hazırlanıyor..."
    python3 -m venv backend/.venv
    source backend/.venv/bin/activate
    pip install -r backend/requirements.txt
else
    source backend/.venv/bin/activate
fi

echo "🚀 FAROS v3.0 başlatılıyor..."
echo "🌐 Kontrol Terminali: http://localhost:8000"

exec python3 -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
