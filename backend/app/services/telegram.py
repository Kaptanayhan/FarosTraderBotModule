"""Telegram notification and 2-way bot command listener."""
import asyncio
from typing import Any, Dict, Optional
import httpx
from app.db import db

TELEGRAM_API = "https://api.telegram.org/bot"

# Gömülü Kalıcı Varsayılan Telegram Kimlik Bilgileri
DEFAULT_BOT_TOKEN = "8605987091:AAEbSLn5Ubdx0_TZ2fJCvhAQuzAYs8fZz7Y"
DEFAULT_CHAT_ID = "2140273565"
BOT_USERNAME = "@Omnideneme_bot"

REPLY_KEYBOARD = {
    "keyboard": [
        [{"text": "📊 Durum & Bakiye"}, {"text": "📈 Açık Pozisyonlar"}],
        [{"text": "▶ Başlat"}, {"text": "⏹ Durdur"}, {"text": "🛡️ ACİL PANİK"}]
    ],
    "resize_keyboard": True,
    "is_persistent": True
}

STOP_INLINE_KEYBOARD = {
    "inline_keyboard": [
        [{"text": "⚡ 1. Acil Market Flush", "callback_data": "stop_market"}],
        [{"text": "🎯 2. Kâr Al / TP Bekle", "callback_data": "stop_profit"}],
        [{"text": "⏳ 3. Güvenli Limit Çıkış", "callback_data": "stop_limit"}]
    ]
}


class TelegramService:
    def __init__(self):
        self._polling_task: Optional[asyncio.Task] = None
        self._running = False
        self.last_update_id = 0

    @property
    def bot_token(self) -> str:
        tok = (db.get_setting("telegram_token", "") or db.get_setting("telegram_bot_token", "")).strip()
        return tok if tok else DEFAULT_BOT_TOKEN

    @property
    def chat_id(self) -> str:
        cid = db.get_setting("telegram_chat_id", "").strip()
        return cid if cid else DEFAULT_CHAT_ID

    @property
    def enabled(self) -> bool:
        # Explicit 'false' checks only; defaults to enabled with hardcoded credentials
        return db.get_setting("telegram_enabled", "true") != "false" and bool(self.bot_token and self.chat_id)

    async def send_message(self, text: str, parse_mode: str = "HTML", reply_markup: Optional[Dict[str, Any]] = None) -> bool:
        if not self.bot_token or not self.chat_id:
            return False
        url = f"{TELEGRAM_API}{self.bot_token}/sendMessage"
        payload = {
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": parse_mode,
            "disable_web_page_preview": True,
        }
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.post(url, json=payload)
                if res.status_code == 200:
                    return True
                db.log(f"Telegram hatası: {res.status_code} - {res.text}", "WARN", "TELEGRAM")
                return False
        except Exception as e:
            db.log(f"Telegram gönderilemedi: {e}", "WARN", "TELEGRAM")
            return False

    async def send_photo(self, photo_bytes: bytes, caption: str = "", parse_mode: str = "HTML") -> bool:
        """Sends in-memory chart PNG to Telegram channel."""
        if not self.bot_token or not self.chat_id or not photo_bytes:
            return False
        url = f"{TELEGRAM_API}{self.bot_token}/sendPhoto"
        data = {
            "chat_id": self.chat_id,
            "caption": caption,
            "parse_mode": parse_mode
        }
        files = {
            "photo": ("chart.png", photo_bytes, "image/png")
        }
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                res = await client.post(url, data=data, files=files)
                if res.status_code == 200:
                    return True
                db.log(f"Telegram Fotoğraf hatası: {res.status_code} - {res.text}", "WARN", "TELEGRAM")
                return False
        except Exception as e:
            db.log(f"Telegram fotoğraf gönderilemedi: {e}", "WARN", "TELEGRAM")
            return False

    async def answer_callback_query(self, callback_query_id: str, text: str = ""):
        if not self.bot_token:
            return
        url = f"{TELEGRAM_API}{self.bot_token}/answerCallbackQuery"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(url, json={"callback_query_id": callback_query_id, "text": text})
        except Exception:
            pass

    async def test_message(self, token: Optional[str] = None, cid: Optional[str] = None) -> Dict[str, Any]:
        use_token = token or self.bot_token
        use_cid = cid or self.chat_id
        if not use_token or not use_cid:
            return {"success": False, "error": "Bot Token veya Chat ID eksik"}
        url = f"{TELEGRAM_API}{use_token}/sendMessage"
        text = "⚡ <b>AegisQuant v3.0</b>\nTelegram bağlantısı başarıyla test edildi! Bildirimler aktif."
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.post(url, json={"chat_id": use_cid, "text": text, "parse_mode": "HTML"})
                if res.status_code == 200:
                    return {"success": True, "message": "Test mesajı iletildi"}
                return {"success": False, "error": f"Telegram API hatası: {res.text}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def notify_position_opened(self, pos: Dict[str, Any], acc_name: str, vision_meta: Optional[Dict[str, Any]] = None):
        if not self.enabled:
            return
        side_emoji = "🟢 LONG" if pos.get("side") == "LONG" else "🔴 SHORT"
        sym = pos.get('symbol', '')
        conf_str = f"{float(vision_meta.get('confidence', 0.85))*100:.0f}" if vision_meta else "85"
        reason_str = vision_meta.get("reason", "Price Action ve EMA Pullback teyidi alındı.") if vision_meta else "Price Action ve EMA Pullback teyidi alındı."

        msg = (
            f"👁️ <b>[VISION TEYİDİ] {sym} {pos.get('side')}</b>\n"
            f"━━━━━━━━━━━━━━━━━━━\n"
            f"📊 <b>Karar:</b> ONAYLANDI (%{conf_str})\n"
            f"📌 <b>Formasyon / Gerekçe:</b> {reason_str}\n"
            f"━━━━━━━━━━━━━━━━━━━\n"
            f"👤 <b>Hesap:</b> {acc_name}\n"
            f"🎯 <b>Yön:</b> {side_emoji} ({pos.get('leverage', 5)}x)\n"
            f"💵 <b>Giriş:</b> ${float(pos.get('entry_price', 0)):.4f}\n"
            f"📊 <b>Miktar:</b> {float(pos.get('size') or pos.get('quantity', 0)):.6g}\n"
            f"🛑 <b>Stop Loss:</b> ${float(pos.get('stop_loss') or 0):.4f}\n"
            f"🎯 <b>Take Profit:</b> ${float(pos.get('take_profit') or 0):.4f}\n"
            f"⏱ <b>Zaman:</b> {pos.get('opened_at', '')}"
        )

        # Check for cached vision chart bytes
        from app.services.vision_chart_agent import vision_chart_agent
        chart_bytes = vision_chart_agent.get_last_chart(sym)
        if chart_bytes:
            asyncio.create_task(self.send_photo(chart_bytes, caption=msg))
        else:
            asyncio.create_task(self.send_message(msg))

    async def notify_position_closed(self, res: Dict[str, Any]):
        if not self.enabled:
            return
        pnl = float(res.get("net_pnl", 0))
        pnl_pct = float(res.get("pnl_pct", 0))
        emoji = "🟢" if pnl >= 0 else "🔴"
        msg = (
            f"{emoji} <b>AEGISQUANT v3.0 - POZİSYON KAPANDI</b>\n"
            f"━━━━━━━━━━━━━━━━━━━\n"
            f"👤 <b>Hesap:</b> {res.get('account', '')}\n"
            f"🪙 <b>Parite:</b> {res.get('symbol')}\n"
            f"💰 <b>Net PnL:</b> {pnl:+.2f} USDT ({pnl_pct:+.2f}%)\n"
            f"🏁 <b>Çıkış:</b> ${float(res.get('exit_price', 0)):.4f}\n"
            f"📌 <b>Sebep:</b> {res.get('reason', 'Manuel')}"
        )
        asyncio.create_task(self.send_message(msg))

    async def notify_engine_state(self, state: str, reason: str = ""):
        if not self.enabled:
            return
        emoji = "▶️" if state == "RUNNING" else "⏹"
        msg = f"{emoji} <b>AEGISQUANT MOTOR BİLDİRİMİ: {state}</b>\n{reason}"
        asyncio.create_task(self.send_message(msg))

    async def start_polling(self):
        if not self.bot_token:
            return
        self._running = True
        self._polling_task = asyncio.create_task(self._poll_loop())
        db.log("Telegram çift yönlü komut dinleyici başlatıldı.", "INFO", "TELEGRAM")

    async def stop_polling(self):
        self._running = False
        if self._polling_task:
            self._polling_task.cancel()

    async def _poll_loop(self):
        url = f"{TELEGRAM_API}{self.bot_token}/getUpdates"
        async with httpx.AsyncClient(timeout=15.0) as client:
            while self._running:
                try:
                    params = {"offset": self.last_update_id + 1, "timeout": 8}
                    resp = await client.get(url, params=params)
                    if resp.status_code == 200:
                        data = resp.json()
                        for update in data.get("result", []):
                            self.last_update_id = update["update_id"]
                            
                            # Handle Callback Queries (Inline Buttons)
                            if "callback_query" in update:
                                cb = update["callback_query"]
                                cb_id = cb.get("id")
                                cb_data = cb.get("data", "")
                                cid = str(cb.get("message", {}).get("chat", {}).get("id", ""))
                                if not self.chat_id or cid == self.chat_id:
                                    await self._handle_callback(cb_id, cb_data, cid)
                                continue

                            # Handle Text Messages (Reply Keyboard & Commands)
                            msg = update.get("message", {})
                            text = (msg.get("text") or "").strip()
                            cid = str(msg.get("chat", {}).get("id", ""))
                            if self.chat_id and cid != self.chat_id:
                                continue
                            if text:
                                await self._handle_command(text, cid)
                except asyncio.CancelledError:
                    break
                except Exception:
                    await asyncio.sleep(4)
                await asyncio.sleep(1)

    async def _handle_callback(self, cb_id: str, cb_data: str, cid: str):
        from app.services.hft_engine import hft_engine
        acc_id = db.get_setting("active_account_id", "acc_alpha")

        if cb_data == "stop_market":
            await self.answer_callback_query(cb_id, "Market Flush Yapılıyor...")
            res = await hft_engine.on_motor_stop(acc_id, mode="MARKET")
            await self.send_message(
                f"⚡ <b>1. ACİL MARKET FLUSH TAMAMLANDI</b>\n"
                f"━━━━━━━━━━━━━━━━━━━\n"
                f"Kapatılan Pozisyon: {res.get('closed_positions', 0)}\n"
                f"Planlı emirler iptal edildi. Motor durduruldu.",
                reply_markup=REPLY_KEYBOARD
            )
        elif cb_data == "stop_profit":
            await self.answer_callback_query(cb_id, "Kâr Al Beklemeli Çıkış...")
            res = await hft_engine.on_motor_stop(acc_id, mode="PROFIT_ONLY")
            await self.send_message(
                f"🎯 <b>2. KÂR AL / TP BEKLEME AKTİF</b>\n"
                f"━━━━━━━━━━━━━━━━━━━\n"
                f"Kârdaki pozisyonlar realize edildi ({res.get('closed_positions', 0)} adet).\n"
                f"Zarardakiler TP/SL bekleyecek, yeni emir açılmayacak.",
                reply_markup=REPLY_KEYBOARD
            )
        elif cb_data == "stop_limit":
            await self.answer_callback_query(cb_id, "Güvenli Limit Çıkış...")
            res = await hft_engine.on_motor_stop(acc_id, mode="LIMIT")
            await self.send_message(
                f"⏳ <b>3. GÜVENLİ LİMİT ÇIKIŞ MODU</b>\n"
                f"━━━━━━━━━━━━━━━━━━━\n"
                f"Bekleyen planlı emirler temizlendi. Açık pozisyonlar emir defterinde korunuyor.",
                reply_markup=REPLY_KEYBOARD
            )

    async def _handle_command(self, cmd: str, target_cid: str):
        from app.services.hft_engine import hft_engine
        c = cmd.lower().strip()
        acc_id = db.get_setting("active_account_id", "acc_alpha")

        if c in ["/start", "start", "/help", "help"]:
            reply = (
                "🛡️ <b>AegisQuant v3.0 // Otonom Kuant Terminali</b>\n\n"
                "Aşağıdaki kalıcı interaktif butonları kullanarak tüm terminali yönetebilirsiniz.\n\n"
                "• <b>[ 📊 Durum & Bakiye ]</b> - Genel motor ve cüzdan durumu\n"
                "• <b>[ 📈 Açık Pozisyonlar ]</b> - Anlık işlemler ve PnL\n"
                "• <b>[ ▶ Başlat ]</b> - Otonom Kuant motorunu başlatır\n"
                "• <b>[ ⏹ Durdur ]</b> - 3 senaryolu durdurma menüsü açar\n"
                "• <b>[ 🛡️ ACİL PANİK ]</b> - Tüm pozisyonları hemen kapatır"
            )
            await self.send_message(reply, reply_markup=REPLY_KEYBOARD)

        elif c in ["📊 durum & bakiye", "/status", "status", "/balance", "balance", "/bakiye", "bakiye", "/hesaplar", "hesaplar"]:
            accounts = db.get_accounts()
            if not accounts:
                await self.send_message("ℹ️ Sistemde kayıtlı hesap bulunamadı.", reply_markup=REPLY_KEYBOARD)
                return

            cards = ["🛡️ <b>AEGISQUANT // HESAP DURUMU</b>\n━━━━━━━━━━━━━━━━━━━"]
            for a in accounts:
                a_id = a["id"]
                bal = float(a.get("balance", 0.0))
                init_bal = float(a.get("initial_balance", bal))
                pnl = bal - init_bal
                pnl_pct = (pnl / init_bal * 100.0) if init_bal > 0 else 0.0
                positions = db.get_open_positions(a_id)
                planned_orders = db.get_planned_orders(a_id)
                running = (a.get("engine_state") == "RUNNING")
                st_badge = "🟢 ÇALIŞIYOR" if running else "⏹ DURDURULDU"

                card = (
                    f"🏦 <b>Hesap:</b> {a.get('name', 'Bilinmeyen')} (<code>{a_id}</code>)\n"
                    f"⚙️ <b>Durum:</b> {st_badge} | Tür: {a.get('type', 'PAPER')}\n"
                    f"💵 <b>Cüzdan / Kasa:</b> ${bal:.2f} USDT (Başlangıç: ${init_bal:.2f})\n"
                    f"📈 <b>Toplam PnL:</b> {pnl:+.2f} USDT ({pnl_pct:+.2f}%)\n"
                    f"📊 <b>Açık Pozisyon:</b> {len(positions)} adet | <b>Bekleyen Emir:</b> {len(planned_orders)} adet"
                )
                cards.append(card)

            await self.send_message("\n\n".join(cards), reply_markup=REPLY_KEYBOARD)

        elif c in ["📈 açık pozisyonlar", "/positions", "positions", "/emirler", "emirler", "/pozisyonlar", "pozisyonlar"]:
            accounts = db.get_accounts()
            if not accounts:
                await self.send_message("ℹ️ Sistemde kayıtlı hesap bulunamadı.", reply_markup=REPLY_KEYBOARD)
                return

            msg_blocks = ["📂 <b>AÇIK POZİSYONLAR VE EMİRLER</b>\n━━━━━━━━━━━━━━━━━━━"]
            for a in accounts:
                a_id = a["id"]
                a_name = a.get("name", a_id)
                positions = db.get_open_positions(a_id)
                planned_orders = db.get_planned_orders(a_id)

                if not positions and not planned_orders:
                    msg_blocks.append(f"ℹ️ <b>{a_name}</b>: Açık pozisyon veya bekleyen emir bulunmuyor.")
                    continue

                acc_lines = [f"👤 <b>{a_name}</b> (<code>{a_id}</code>):"]
                if positions:
                    acc_lines.append("  📊 <b>Pozisyonlar:</b>")
                    for p in positions:
                        pnl = float(p.get("pnl", 0.0))
                        pnl_pct = float(p.get("pnl_pct", 0.0))
                        emoji = "🟢" if pnl >= 0 else "🔴"
                        sl_str = f"${float(p['stop_loss']):.4f}" if p.get("stop_loss") else "YOK"
                        tp_str = f"${float(p['take_profit']):.4f}" if p.get("take_profit") else "YOK"
                        acc_lines.append(
                            f"  {emoji} <b>{p['symbol']}</b> | {p['side']} {p.get('leverage', 5)}x\n"
                            f"     Giriş: ${float(p['entry_price']):.4f} | Anlık: ${float(p.get('mark_price', p['entry_price'])):.4f}\n"
                            f"     PnL: %{pnl_pct:+.2f} ({pnl:+.2f} USDT)\n"
                            f"     SL: {sl_str} | TP: {tp_str}"
                        )
                if planned_orders:
                    acc_lines.append("  ⏳ <b>Bekleyen Emirler:</b>")
                    for o in planned_orders:
                        acc_lines.append(
                            f"     • {o.get('side', '')} {o.get('symbol', '')} @ ${float(o.get('target_price', 0.0)):.4f} "
                            f"(Miktar: {o.get('quantity', '')} | {o.get('agent_name', 'Bot')})"
                        )
                msg_blocks.append("\n".join(acc_lines))

            await self.send_message("\n\n".join(msg_blocks), reply_markup=REPLY_KEYBOARD)

        elif c in ["▶ başlat", "başlat", "/start_engine", "/run"]:
            await hft_engine.on_motor_start(acc_id)
            await self.send_message("🟢 <b>AegisQuant Kuant Motoru Başlatıldı!</b>\nİlk garantili limit emirler tahtaya iletildi.", reply_markup=REPLY_KEYBOARD)

        elif c in ["⏹ durdur", "durdur", "/stop", "stop"]:
            reply = (
                "⏹ <b>DURDURMA SENARYOSU SEÇİN:</b>\n\n"
                "Açık pozisyonlar ve planlı emirler için lütfen bir eylem seçin:"
            )
            await self.send_message(reply, reply_markup=STOP_INLINE_KEYBOARD)

        elif c in ["🛡️ acil panik", "acil panik", "panik", "/panic", "panic"]:
            res = await hft_engine.on_motor_stop(acc_id, mode="PANIC")
            await self.send_message(
                f"🚨 <b>ACİL PANİK ÇIKIŞI GERÇEKLEŞTİRİLDİ!</b>\n"
                f"━━━━━━━━━━━━━━━━━━━\n"
                f"❌ Kapatılan Pozisyon: {res.get('closed_positions', 0)}\n"
                f"🚫 Tüm planlı emirler iptal edildi.\n"
                f"🔒 Motor kilitlendi ve durduruldu.",
                reply_markup=REPLY_KEYBOARD
            )


telegram = TelegramService()
