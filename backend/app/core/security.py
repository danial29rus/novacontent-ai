import base64
import hashlib
import hmac
import secrets

# Same format as the legacy MVP, so existing password hashes stay valid.
_ROUNDS = 310_000


def hash_password(value: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", value.encode(), salt, _ROUNDS)
    return f"pbkdf2_sha256${_ROUNDS}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(value: str, stored: str) -> bool:
    try:
        _, rounds, raw_salt, raw_digest = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", value.encode(), base64.b64decode(raw_salt), int(rounds))
        return hmac.compare_digest(digest, base64.b64decode(raw_digest))
    except (ValueError, TypeError):
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
