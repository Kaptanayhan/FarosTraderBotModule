"""Single-user password auth. Compatible with legacy backend/auth_config.json (sha256(pw+salt))."""
import hashlib
import json
import secrets
import time
from pathlib import Path
from typing import Optional

AUTH_FILE = Path(__file__).resolve().parent.parent / "auth_config.json"
SALT = "omnitrader_quantum_salt_2026"
TOKEN_TTL = 7 * 24 * 3600


def _hash(pw: str) -> str:
    return hashlib.sha256((pw + SALT).encode()).hexdigest()


class Auth:
    def __init__(self):
        self.username = "Admin"
        self.password_hash = _hash("admin")
        self.tokens: dict = {}
        self._load()

    def _load(self):
        if AUTH_FILE.exists():
            try:
                d = json.loads(AUTH_FILE.read_text())
                self.username = d.get("username", self.username)
                self.password_hash = d.get("password_hash", self.password_hash)
                self.tokens = d.get("active_tokens", {}) or {}
            except Exception:
                pass

    def _save(self):
        now = time.time()
        self.tokens = {t: e for t, e in self.tokens.items() if e > now}
        AUTH_FILE.write_text(json.dumps(
            {"username": self.username, "password_hash": self.password_hash, "active_tokens": self.tokens},
            ensure_ascii=False, indent=2,
        ))
        try:
            AUTH_FILE.chmod(0o600)
        except Exception:
            pass

    def login(self, password: str) -> Optional[str]:
        if not secrets.compare_digest(_hash(password), self.password_hash):
            return None
        tok = secrets.token_hex(24)
        self.tokens[tok] = time.time() + TOKEN_TTL
        self._save()
        return tok

    def valid(self, token: Optional[str]) -> bool:
        if not token:
            return False
        exp = self.tokens.get(token)
        return bool(exp and exp > time.time())

    def logout(self, token: str):
        self.tokens.pop(token, None)
        self._save()

    def change_password(self, old: str, new: str) -> bool:
        if not secrets.compare_digest(_hash(old), self.password_hash) or len(new) < 6:
            return False
        self.password_hash = _hash(new)
        self.tokens = {}
        self._save()
        return True


auth = Auth()
