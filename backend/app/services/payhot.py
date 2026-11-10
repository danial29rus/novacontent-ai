"""PayHot API v2 client (https://docs.pay.hot): create payments, read status, SBP links, webhook signatures."""
import hashlib
import hmac
import re
import time
import uuid
from dataclasses import dataclass

import httpx

from app.core.config import settings

# PayHot payment statuses mapped to ours. Anything else (processing, authorized, ...) stays pending.
STATUS_MAP = {
    "succeeded": "succeeded",
    "partially_refunded": "succeeded",
    "refunded": "succeeded",  # refunds are handled by hand; the top-up itself did happen
    "failed": "failed",
    "cancelled": "canceled",
}


class PayHotError(Exception):
    def __init__(self, message: str, status: int | None = None, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


@dataclass
class CreatedPayment:
    id: str
    checkout_url: str
    status: str


@dataclass
class SbpLink:
    status: str  # pending | available | expired
    url: str | None
    expires_at: str | None


class PayHotClient:
    BASE_URL = "https://app.pay.hot"
    TIMEOUT = 20
    # DDoS-Guard in front of PayHot answers the default python-httpx User-Agent with a 403 HTML page.
    USER_AGENT = "NovaAI-Backend/1.0"

    def __init__(self, api_key: str | None, sandbox: bool = False, base_url: str | None = None):
        self.api_key = api_key or ""
        # Test keys only work on sandbox routes, so a phk_test_ key switches sandbox on by itself.
        self.sandbox = sandbox or self.api_key.startswith("phk_test_")
        self.base_url = (base_url or self.BASE_URL).rstrip("/")

    async def create_payment(self, order_id: str, amount_kopeks: int, method: str) -> CreatedPayment:
        """order_id (our uuid4) is the merchant_order_reference; the idempotency key is a fresh uuid4."""
        data = await self._request("POST", "/payments", idempotency_key=str(uuid.uuid4()), json={
            "merchant_order_reference": order_id,
            "amount_minor": str(amount_kopeks),
            "currency": "RUB",
            "payment_method": method,
        })
        url = (data.get("checkout") or {}).get("url")
        if not url:
            raise PayHotError("PayHot не вернул ссылку на оплату")
        return CreatedPayment(id=data["payment"]["id"], checkout_url=url, status=data["payment"]["status"])

    async def get_status(self, payment_id: str) -> str:
        data = await self._request("GET", f"/payments/{payment_id}")
        return data["payment"]["status"]

    async def get_sbp_link(self, payment_id: str) -> SbpLink:
        """Direct bank link for the QR. Raises PayHotError with status 409 when PayHot has none."""
        data = (await self._request("GET", f"/payments/{payment_id}/direct-sbp-action"))["direct_sbp"]
        action = data.get("next_action") or {}
        return SbpLink(status=data.get("status"), url=action.get("url"), expires_at=action.get("expires_at"))

    async def _request(self, method: str, path: str, idempotency_key: str | None = None, **kwargs) -> dict:
        prefix = "/sandbox" if self.sandbox else ""
        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json",
                   "User-Agent": self.USER_AGENT}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        try:
            async with httpx.AsyncClient(timeout=self.TIMEOUT) as client:
                response = await client.request(method, f"{self.base_url}/api/v2{prefix}{path}",
                                                headers=headers, **kwargs)
        except httpx.HTTPError as error:
            raise PayHotError(f"PayHot недоступен: {error}") from error
        if response.status_code >= 400:
            raise self._error(response)
        return response.json()

    @staticmethod
    def _error(response: httpx.Response) -> PayHotError:
        try:
            err = response.json().get("error") or {}
        except ValueError:
            blocked = "ddos-guard" in response.headers.get("server", "").lower()
            err = {"code": "blocked_by_ddos_guard" if blocked else None, "message": response.text[:120]}
        code = err.get("code")
        return PayHotError(f"PayHot {response.status_code}: {code} {err.get('message', '')}".strip(),
                           response.status_code, code)


def client() -> PayHotClient:
    return PayHotClient(settings.payhot_api_key, settings.payhot_sandbox, settings.payhot_base_url)


# --- Webhooks ------------------------------------------------------------------------------------

_SIGNATURE = re.compile(r"^t=([0-9]{1,12}),v2=([a-f0-9]{64})$")
SIGNATURE_TOLERANCE_SECONDS = 300


def verify_signature(header: str | None, body: bytes, secret: str | None = None, now: float | None = None) -> bool:
    """PayHot-Signature: t=<unix>,v2=<hex HMAC-SHA256 of "<t>.<raw body>" keyed by the signing secret>."""
    secret = secret or settings.payhot_webhook_secret
    if not header or not secret:
        return False
    match = _SIGNATURE.match(header.strip())
    if not match:
        return False
    timestamp, signature = match.groups()
    if abs((now or time.time()) - int(timestamp)) > SIGNATURE_TOLERANCE_SECONDS:
        return False
    expected = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
