"""Payment worker: every 30 s asks PayHot about pending payments and credits or closes them.

Runs as its own container (`python -m app.worker`), so there is exactly one poller however many
API processes run. Crediting is idempotent (row lock in billing.apply_provider_status), so it is
safe alongside the webhook and the QR dialog polling the same payment.
"""
import asyncio
import logging
import signal
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Payment
from app.services import billing

INTERVAL_SECONDS = 30
BATCH = 50
# PayHot links live ~20 min; after this a still-pending payment is closed on our side.
ABANDON_AFTER = timedelta(hours=24)
# Small pause between PayHot calls so DDoS-Guard doesn't treat the burst as an attack.
PAUSE_BETWEEN_CALLS = 0.5

log = logging.getLogger("nova.worker")


async def poll_once() -> dict:
    stats = {"checked": 0, "succeeded": 0, "failed": 0, "abandoned": 0, "errors": 0}
    async with SessionLocal() as db:
        pending = (await db.scalars(select(Payment).where(
            Payment.provider == "payhot", Payment.status == "pending", Payment.provider_payment_id.is_not(None),
        ).order_by(Payment.id).limit(BATCH))).all()
        for payment in pending:
            payment = await billing.refresh_payment(db, payment)
            stats["checked"] += 1
            if payment.status == "succeeded":
                stats["succeeded"] += 1
                log.info("payment %s succeeded: +%s sparks to user %s", payment.id, payment.tokens, payment.user_id)
            elif payment.status in ("failed", "canceled"):
                stats["failed"] += 1
                log.info("payment %s closed: %s (PayHot: %s)", payment.id, payment.status, payment.provider_status)
            elif payment.error:
                stats["errors"] += 1
            if payment.status == "pending" and datetime.now(UTC) - payment.created_at > ABANDON_AFTER:
                payment.status = "canceled"
                payment.error = "Не оплачен за 24 часа, закрыт автоматически"
                await db.commit()
                stats["abandoned"] += 1
                log.info("payment %s abandoned after 24h", payment.id)
            await asyncio.sleep(PAUSE_BETWEEN_CALLS)
    return stats


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    if settings.payment_provider != "payhot":
        log.info("PAYMENT_PROVIDER=%s: nothing to poll, worker idles", settings.payment_provider)
        await stop.wait()
        return

    log.info("payment worker started, polling every %ss", INTERVAL_SECONDS)
    while not stop.is_set():
        try:
            stats = await poll_once()
            if stats["checked"]:
                log.info("poll: %s", stats)
        except Exception:
            log.exception("poll failed")  # keep running; the next tick tries again
        try:
            await asyncio.wait_for(stop.wait(), timeout=INTERVAL_SECONDS)
        except TimeoutError:
            pass
    log.info("payment worker stopped")


if __name__ == "__main__":
    asyncio.run(main())
