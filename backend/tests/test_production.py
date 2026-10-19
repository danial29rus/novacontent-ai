import pytest

from app.core.config import Settings, settings
from app.services import billing, llm, mailer


def prod(**overrides) -> Settings:
    base = dict(environment="production", cookie_secure=True, public_url="https://24nova-ai.ru",
                admin_email="admin@24nova-ai.ru", admin_password="a-long-unique-password",
                database_url="postgresql+asyncpg://nova:s3cret@db:5432/nova")
    return Settings(_env_file=None, **{**base, **overrides})


def test_safe_production_settings_have_no_problems():
    assert prod().production_problems() == []


@pytest.mark.parametrize("override", [
    {"cookie_secure": False}, {"public_url": "http://24nova-ai.ru"}, {"admin_password": "change-me-please"},
    {"database_url": "postgresql+asyncpg://nova:nova@db:5432/nova"},
])
def test_unsafe_production_settings_are_reported(override):
    assert prod(**override).production_problems()


def test_missing_integrations_are_warnings_not_blockers():
    settings_ = prod(payment_provider="yookassa", yookassa_shop_id=None, openai_api_key=None, smtp_host=None)
    assert settings_.production_problems() == []
    assert len(settings_.production_warnings()) == 3


def test_mock_payments_are_disabled_in_production(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "payment_provider", "mock")
    assert billing.payments_enabled() is False
    monkeypatch.setattr(settings, "environment", "development")
    assert billing.payments_enabled() is True


async def test_production_without_key_fails_instead_of_dev_answers(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "openai_api_key", None)
    llm.get_provider.cache_clear()
    try:
        with pytest.raises(llm.ProviderError):
            await llm.complete("openai", "gpt-6-luna", "sys", [{"role": "user", "content": "hi"}])
    finally:
        llm.get_provider.cache_clear()


async def test_mail_is_noop_without_smtp(monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", None)
    assert await mailer.send("a@b.ru", "s", "t", "<p>x</p>", text="x") is False


async def test_mail_message_is_built_for_timeweb_smtp(monkeypatch):
    sent = []
    for key, value in {"smtp_host": "smtp.timeweb.ru", "smtp_user": "support@24nova-ai.ru",
                       "smtp_password": "x", "smtp_from": None}.items():
        monkeypatch.setattr(settings, key, value)
    monkeypatch.setattr(mailer, "_send_sync", sent.append)
    ok = await mailer.send("user@example.com", "Тема", "Заголовок", mailer.paragraph("Привет <b>"),
                           text="Привет", button=("Открыть", "https://24nova-ai.ru/x"), reply_to="a@b.ru")
    message = sent[0]
    assert ok and message["From"].endswith("<support@24nova-ai.ru>") and message["Reply-To"] == "a@b.ru"
    html_part = message.get_body(("html",)).get_content()
    assert "Привет &lt;b&gt;" in html_part and "https://24nova-ai.ru/x" in html_part


async def test_send_later_does_not_wait_for_smtp(monkeypatch):
    import asyncio
    import time

    for key, value in {"smtp_host": "smtp.timeweb.ru", "smtp_user": "s@x.ru", "smtp_password": "x"}.items():
        monkeypatch.setattr(settings, key, value)
    monkeypatch.setattr(mailer, "_send_sync", lambda message: time.sleep(0.5))  # a slow SMTP server
    started = time.perf_counter()
    mailer.send_later("u@x.ru", "s", "t", "<p>x</p>", text="x")
    assert time.perf_counter() - started < 0.05
    await asyncio.sleep(0.6)  # let the background send finish
    assert mailer.last_result["ok"] is True
