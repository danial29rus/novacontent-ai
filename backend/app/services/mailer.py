"""Outgoing mail over SMTP (Timeweb: smtp.timeweb.ru:465, SSL). No-op with a log line when SMTP isn't set."""

import asyncio
import html
import logging
import smtplib
import ssl
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from app.core.config import settings

log = logging.getLogger(__name__)

TIMEOUT = 10  # seconds; a blocked SMTP port must not hang anything for long
# Last delivery outcome, shown in the admin panel ("Почта" status).
last_result: dict = {"ok": None, "at": None, "error": None, "to": None}
_background: set[asyncio.Task] = set()


def _layout(title: str, body_html: str, button: tuple[str, str] | None = None) -> str:
    button_style = ("background:#8b5cf6;color:#fff;padding:12px 22px;border-radius:12px;"
                    "text-decoration:none;font-weight:600")
    cta = (f'<p style="margin:28px 0"><a href="{html.escape(button[1])}" style="{button_style}">'
           f"{html.escape(button[0])}</a></p>" if button else "")
    body_style = "margin:0;background:#0c0c16;font-family:Arial,sans-serif;color:#e4e4e7"
    return f"""<!doctype html><html><body style="{body_style}">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
  <p style="font-size:20px;font-weight:800;color:#fff">✦ nova<span style="color:#a78bfa">ai</span></p>
  <div style="background:#161625;border:1px solid #2c2c4a;border-radius:18px;padding:28px">
    <h1 style="margin:0 0 16px;font-size:20px;color:#fff">{html.escape(title)}</h1>
    <div style="font-size:15px;line-height:1.6">{body_html}</div>{cta}
  </div>
  <p style="font-size:12px;color:#71717a;margin-top:20px">Nova AI · {html.escape(settings.public_url)} ·
  <a href="mailto:{settings.support_email}" style="color:#a78bfa">{settings.support_email}</a></p>
</div></body></html>"""


def _send_sync(message: EmailMessage) -> None:
    context = ssl.create_default_context()
    if settings.smtp_security == "ssl":
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=context, timeout=TIMEOUT) as smtp:
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=TIMEOUT) as smtp:
            smtp.starttls(context=context)
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(message)


async def send(to: str, subject: str, title: str, body_html: str, *, text: str,
               button: tuple[str, str] | None = None, reply_to: str | None = None) -> bool:
    """Returns True if handed to SMTP. Never raises: mail problems must not break the request."""
    if not settings.mail_enabled:
        log.info("mail disabled, would send %r to %s", subject, to)
        return False
    sender = settings.smtp_from or settings.smtp_user
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr(("Nova AI", sender))
    message["To"] = to
    message["Message-ID"] = make_msgid(domain=sender.split("@")[-1])
    if reply_to:
        message["Reply-To"] = reply_to
    message.set_content(text)
    message.add_alternative(_layout(title, body_html, button), subtype="html")
    try:
        await asyncio.to_thread(_send_sync, message)
    except (smtplib.SMTPException, OSError) as error:
        log.exception("failed to send %r to %s", subject, to)
        last_result.update(ok=False, at=datetime.now(UTC).isoformat(), to=to, error=_explain(error))
        return False
    last_result.update(ok=True, at=datetime.now(UTC).isoformat(), to=to, error=None)
    return True


def send_later(*args, **kwargs) -> None:
    """Fire-and-forget: the HTTP response doesn't wait for SMTP."""
    task = asyncio.create_task(send(*args, **kwargs))
    _background.add(task)
    task.add_done_callback(_background.discard)


def _explain(error: Exception) -> str:
    text = f"{type(error).__name__}: {error}"
    if isinstance(error, smtplib.SMTPAuthenticationError):
        return "Неверный логин или пароль ящика (SMTP_USER / SMTP_PASSWORD). " + text
    if not isinstance(error, smtplib.SMTPException):  # socket-level: timeout, refused, DNS
        return (f"Нет соединения с {settings.smtp_host}:{settings.smtp_port}. Возможно, исходящий порт закрыт "
                "у хостинга — попробуйте SMTP_PORT=587 и SMTP_SECURITY=starttls или напишите в поддержку Timeweb. "
                + text)
    return text


def paragraph(text: str) -> str:
    return "".join(f"<p>{html.escape(p).replace(chr(10), '<br>')}</p>" for p in text.split("\n\n"))
