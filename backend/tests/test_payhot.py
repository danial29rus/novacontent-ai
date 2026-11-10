import hashlib
import hmac
import time

from app.core.config import settings
from app.services import billing, payhot

SECRET = "whsec_test_secret"


def sign(body: bytes, t: int) -> str:
    return f"t={t},v2=" + hmac.new(SECRET.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()


def test_signature_valid(monkeypatch):
    monkeypatch.setattr(settings, "payhot_webhook_secret", SECRET)
    body, t = b'{"event_type":"payment.succeeded"}', int(time.time())
    assert payhot.verify_signature(sign(body, t), body)


def test_signature_rejects_tampering_and_old(monkeypatch):
    monkeypatch.setattr(settings, "payhot_webhook_secret", SECRET)
    body, t = b'{"a":1}', int(time.time())
    assert not payhot.verify_signature(sign(body, t), b'{"a":2}')
    assert not payhot.verify_signature(sign(body, t - 600), body)
    assert not payhot.verify_signature(None, body)
    assert not payhot.verify_signature("garbage", body)


def test_payhot_enabled_only_with_keys(monkeypatch):
    monkeypatch.setattr(settings, "payment_provider", "payhot")
    monkeypatch.setattr(settings, "payhot_api_key", None)
    monkeypatch.setattr(settings, "payhot_webhook_secret", SECRET)
    assert billing.payments_enabled() is False
    monkeypatch.setattr(settings, "payhot_api_key", "phk_v2_x")
    monkeypatch.setattr(settings, "environment", "production")
    assert billing.payments_enabled() is True


def test_test_key_enables_sandbox():
    assert payhot.PayHotClient("phk_test_v2_abc").sandbox
    assert not payhot.PayHotClient("phk_v2_abc").sandbox
    assert payhot.PayHotClient("phk_v2_abc", sandbox=True).sandbox


def test_external_api_token(monkeypatch):
    import pytest
    from fastapi import HTTPException

    from app.api.v1.external import require_token

    monkeypatch.setattr(settings, "payments_api_tokens", ["secret-token-1"])
    require_token("Bearer secret-token-1")
    for bad in (None, "", "Bearer wrong", "secret-token-2"):
        with pytest.raises(HTTPException):
            require_token(bad)
    monkeypatch.setattr(settings, "payments_api_tokens", [])
    with pytest.raises(HTTPException):
        require_token("Bearer secret-token-1")
