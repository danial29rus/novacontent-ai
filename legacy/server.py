#!/usr/bin/env python3
"""Nova Content AI MVP backend.

It intentionally owns the AI-provider boundary: the browser only talks to this
server and never receives provider credentials. It is dependency-free so the
prototype can be started with Python 3.11+; replace SQLite and the in-memory
rate limiter before a multi-instance production deployment.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from typing import Any

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("NOVA_DB_PATH", ROOT / "nova.db"))
PORT = int(os.environ.get("PORT", "4173"))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
MAX_INPUT = 8_000
RATE_WINDOW = 60
RATE_LIMIT = 12
SESSION_DAYS = 14
_rate_buckets: dict[str, list[float]] = {}
_rate_lock = Lock()

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user'
   CHECK(role IN ('user','admin')), status TEXT NOT NULL DEFAULT 'active'
   CHECK(status IN ('active','blocked')), accepted_terms_at TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
 id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, price_kopeks INTEGER NOT NULL,
 duration_days INTEGER NOT NULL, generation_limit INTEGER NOT NULL, features TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS subscriptions (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), plan_id INTEGER NOT NULL REFERENCES plans(id),
 status TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_ledger (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), amount INTEGER NOT NULL,
 reason TEXT NOT NULL, generation_id INTEGER, comment TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generations (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), tool TEXT NOT NULL,
 input_json TEXT NOT NULL, output_text TEXT, status TEXT NOT NULL, cost INTEGER NOT NULL DEFAULT 0,
 provider TEXT, error_code TEXT, created_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS projects (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', brand_context TEXT NOT NULL DEFAULT '',
 tone TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS content_packs (
 id INTEGER PRIMARY KEY, slug TEXT UNIQUE, owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL, description TEXT NOT NULL, steps_json TEXT NOT NULL,
 is_public INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_packs (
 id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 source_pack_id INTEGER REFERENCES content_packs(id), title TEXT NOT NULL, description TEXT NOT NULL,
 steps_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_tickets (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), subject TEXT NOT NULL,
 message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
 id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
 details TEXT NOT NULL, created_at TEXT NOT NULL
);
"""

PLANS = (
    ("start", "Старт", 0, 30, 30, "Пост-студия, Редактор тона"),
    ("pro", "Про", 0, 30, 150, "Все MVP-инструменты, Контент-план"),
    ("team", "Команда", 0, 30, 500, "Рабочие пространства, экспорт, поддержка"),
)

PACKS = (
    ("week", "Контент на неделю", "Соберите темы, черновики и финальные публикации на 7 дней.", [
        {"title": "Контент-план на неделю", "tool": "plan", "cost": 3}, {"title": "Первый пост", "tool": "post", "cost": 1}, {"title": "Редактор тона", "tool": "rewrite", "cost": 1}]),
    ("launch", "Запуск продукта", "Упакуйте запуск: идея, прогрев и призыв к действию.", [
        {"title": "Карта запуска", "tool": "plan", "cost": 3}, {"title": "Анонс", "tool": "post", "cost": 1}, {"title": "Ответы на вопросы", "tool": "chat", "cost": 1}]),
    ("telegram", "Серия для Telegram", "Готовая серия публикаций с человеческим голосом бренда.", [
        {"title": "Рубрики", "tool": "plan", "cost": 3}, {"title": "Пост-знакомство", "tool": "post", "cost": 1}, {"title": "Усилить тон", "tool": "rewrite", "cost": 1}]),
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def initialize() -> None:
    con = db()
    try:
        con.executescript(SCHEMA)
        for plan in PLANS:
            con.execute("""INSERT INTO plans(slug,name,price_kopeks,duration_days,generation_limit,features)
                VALUES(?,?,?,?,?,?) ON CONFLICT(slug) DO NOTHING""", plan)
        for slug, title, description, steps in PACKS:
            con.execute("""INSERT INTO content_packs(slug,title,description,steps_json,is_public,created_at)
                VALUES(?,?,?,?,1,?) ON CONFLICT(slug) DO NOTHING""", (slug, title, description, json.dumps(steps, ensure_ascii=False), now()))
        columns = {row[1] for row in con.execute("PRAGMA table_info(generations)")}
        if "project_id" not in columns:
            con.execute("ALTER TABLE generations ADD COLUMN project_id INTEGER REFERENCES projects(id)")
        if "model_tier" not in columns:
            con.execute("ALTER TABLE generations ADD COLUMN model_tier TEXT NOT NULL DEFAULT 'swift'")
        admin_email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
        admin_password = os.environ.get("ADMIN_PASSWORD", "")
        if admin_email and admin_password:
            existing = con.execute("SELECT id FROM users WHERE email=?", (admin_email,)).fetchone()
            if not existing:
                con.execute("""INSERT INTO users(email,name,password_hash,role,accepted_terms_at,created_at)
                    VALUES(?,?,?,?,?,?)""", (admin_email, "Администратор", password_hash(admin_password), "admin", now(), now()))
        con.commit()
    finally:
        con.close()


def password_hash(value: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", value.encode(), salt, 310_000)
    return "pbkdf2_sha256$310000$%s$%s" % (base64.b64encode(salt).decode(), base64.b64encode(digest).decode())


def password_ok(value: str, stored: str) -> bool:
    try:
        _, rounds, raw_salt, raw_digest = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", value.encode(), base64.b64decode(raw_salt), int(rounds))
        return hmac.compare_digest(digest, base64.b64decode(raw_digest))
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def safe_text(value: Any, limit: int = MAX_INPUT) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def has_sensitive_data(text: str) -> bool:
    # A guardrail, not a substitute for data-loss-prevention in production.
    compact = re.sub(r"[ -]", "", text)
    return bool(re.search(r"\b(?:\d[ -]*?){13,19}\b", text) or re.search(r"\b\d{10}\b", compact))


def rate_allowed(identity: str) -> bool:
    current = time.time()
    with _rate_lock:
        events = [t for t in _rate_buckets.get(identity, []) if current - t < RATE_WINDOW]
        if len(events) >= RATE_LIMIT:
            _rate_buckets[identity] = events
            return False
        events.append(current)
        _rate_buckets[identity] = events
    return True


def fallback_content(tool: str, data: dict[str, str]) -> str:
    topic = data.get("topic") or data.get("message") or data.get("text") or "ваша идея"
    tone = data.get("tone") or "спокойный и человеческий"
    if tool == "post":
        return f"Заголовок\n{topic}\n\nПост\nНачните с живой детали: {topic}. Покажите, почему это важно именно вашей аудитории, и оставьте место для собственного голоса.\n\nCTA\nКакая часть этой идеи откликается вам сильнее всего?\n\nВарианты заголовка\n— {topic}: с чего начать\n— Один честный взгляд на тему\n— Идея, которую стоит обсудить"
    if tool == "plan":
        period = data.get("period") or "7 дней"
        return f"Контент-план на {period}\n1. Знакомство с темой «{topic}» — пост, задача: вызвать интерес.\n2. Частый вопрос аудитории — карточки, задача: снять сомнения.\n3. Процесс изнутри — короткое видео, задача: показать доверие.\n4. Практический совет — пост, задача: сохранить.\n5. Личная история — заметка, задача: начать диалог.\n\nТон: {tone}. Перед публикацией добавьте факты и опыт бренда."
    if tool == "rewrite":
        return f"Обновлённая версия\n{topic}\n\nСделайте мысль короче, добавьте конкретную деталь и завершите ясным следующим шагом для читателя.\n\nЧто изменено\n— тон приведён к: {tone};\n— сокращены повторы;\n— усилен призыв к действию."
    return f"Ответ AI-ассистента\n{topic}\n\nЯ помогу превратить это в понятный материал. Уточните площадку, аудиторию и желаемый результат — тогда черновик станет точнее."


def system_prompt(tool: str) -> str:
    prompts = {
        "post": "Ты редактор контента. Ответь по-русски: заголовок, пост, CTA, 3 варианта заголовка. Не выдумывай факты.",
        "plan": "Ты контент-стратег. Ответь по-русски структурированным планом публикаций. Не обещай результаты и не выдумывай факты.",
        "rewrite": "Ты редактор. Перепиши текст по-русски в нужном тоне и коротко перечисли изменения. Сохрани смысл.",
        "chat": "Ты помощник Nova Content AI для работы с контентом. Отвечай по-русски, кратко, безопасно и без выдуманных фактов.",
    }
    return prompts.get(tool, prompts["chat"])


def call_provider(tool: str, data: dict[str, str], model_tier: str = "swift") -> tuple[str, str]:
    """Call an OpenAI-compatible endpoint. Multiple comma-separated secrets are failover keys."""
    keys = [k.strip() for k in os.environ.get("AI_API_KEYS", "").split(",") if k.strip()]
    endpoint = os.environ.get("AI_API_URL", "").strip()
    model = os.environ.get(f"AI_MODEL_{model_tier.upper()}", os.environ.get("AI_MODEL", "")).strip()
    if not (keys and endpoint and model):
        return fallback_content(tool, data), "development-template"
    user_prompt = json.dumps(data, ensure_ascii=False)
    body = json.dumps({"model": model, "messages": [
        {"role": "system", "content": system_prompt(tool)}, {"role": "user", "content": user_prompt}
    ], "temperature": 0.7}, ensure_ascii=False).encode()
    last_error: Exception | None = None
    for key in keys:
        request = urllib.request.Request(endpoint, body, method="POST", headers={
            "Content-Type": "application/json", "Authorization": f"Bearer {key}"
        })
        try:
            with urllib.request.urlopen(request, timeout=35) as response:
                payload = json.loads(response.read().decode())
            answer = payload["choices"][0]["message"]["content"].strip()
            if answer:
                return answer[:20_000], "configured-provider"
        except (urllib.error.URLError, urllib.error.HTTPError, KeyError, ValueError) as error:
            last_error = error
    raise RuntimeError("AI provider unavailable") from last_error


class NovaHandler(SimpleHTTPRequestHandler):
    directory = str(ROOT / "dist")

    def log_message(self, format: str, *args: Any) -> None:
        # Do not log request bodies or authorization values.
        print("[nova] " + format % args)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; img-src 'self' data:")
        super().end_headers()

    def do_GET(self) -> None:
        if self.path.startswith("/api/"):
            return self.api_get()
        if self.path.startswith("/docs/"):
            return self.docs()
        return super().do_GET()

    def do_POST(self) -> None:
        if not self.path.startswith("/api/"):
            return self.reply({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_INPUT + 4_000:
            return self.reply({"error": "Некорректный размер запроса."}, HTTPStatus.BAD_REQUEST)
        try:
            body = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return self.reply({"error": "Ожидается JSON."}, HTTPStatus.BAD_REQUEST)
        if not isinstance(body, dict):
            return self.reply({"error": "Некорректный запрос."}, HTTPStatus.BAD_REQUEST)
        return self.api_post(body)

    def json_body(self) -> dict[str, Any]:
        return {}

    def reply(self, data: dict[str, Any], status: HTTPStatus = HTTPStatus.OK, cookie: str | None = None) -> None:
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def current_user(self) -> sqlite3.Row | None:
        cookie = SimpleCookie(self.headers.get("Cookie"))
        token = cookie.get("nova_session")
        if not token:
            return None
        con = db()
        try:
            return con.execute("""SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
                WHERE s.token_hash=? AND s.expires_at>?""", (token_hash(token.value), now())).fetchone()
        finally:
            con.close()

    def require_user(self, admin: bool = False) -> sqlite3.Row | None:
        user = self.current_user()
        if not user or user["status"] != "active" or (admin and user["role"] != "admin"):
            self.reply({"error": "Нужен доступ к аккаунту."}, HTTPStatus.UNAUTHORIZED)
            return None
        return user

    def public_user(self, user: sqlite3.Row) -> dict[str, Any]:
        con = db()
        try:
            credits = con.execute("SELECT COALESCE(SUM(amount),0) AS total FROM credit_ledger WHERE user_id=?", (user["id"],)).fetchone()["total"]
            subscription = con.execute("""SELECT p.name, s.ends_at FROM subscriptions s JOIN plans p ON p.id=s.plan_id
                WHERE s.user_id=? AND s.status='active' ORDER BY s.id DESC LIMIT 1""", (user["id"],)).fetchone()
        finally:
            con.close()
        return {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"],
                "credits": credits, "plan": dict(subscription) if subscription else None}

    def make_session(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).isoformat()
        con = db()
        try:
            con.execute("DELETE FROM sessions WHERE expires_at < ?", (now(),))
            con.execute("INSERT INTO sessions(user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?)", (user_id, token_hash(token), expires, now()))
            con.commit()
        finally:
            con.close()
        secure = "; Secure" if COOKIE_SECURE else ""
        return f"nova_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_DAYS * 86400}{secure}"

    def api_get(self) -> None:
        if self.path == "/api/me":
            user = self.current_user()
            return self.reply({"user": self.public_user(user) if user and user["status"] == "active" else None})
        user = self.require_user()
        if not user:
            return
        con = db()
        try:
            if self.path == "/api/materials":
                rows = con.execute("SELECT id,tool,output_text,status,created_at FROM generations WHERE user_id=? ORDER BY id DESC LIMIT 50", (user["id"],)).fetchall()
                return self.reply({"materials": [dict(r) for r in rows]})
            if self.path == "/api/projects":
                rows = con.execute("""SELECT p.*, COUNT(pp.id) AS packs_count FROM projects p
                    LEFT JOIN project_packs pp ON pp.project_id=p.id WHERE p.user_id=?
                    GROUP BY p.id ORDER BY p.updated_at DESC""", (user["id"],)).fetchall()
                return self.reply({"projects": [dict(r) for r in rows]})
            if self.path == "/api/packs":
                rows = con.execute("SELECT id,slug,title,description,steps_json FROM content_packs WHERE is_public=1 AND active=1 ORDER BY id").fetchall()
                return self.reply({"packs": [{**dict(r), "steps": json.loads(r["steps_json"])} for r in rows]})
            if self.path == "/api/plans":
                rows = con.execute("SELECT slug,name,price_kopeks,duration_days,generation_limit,features FROM plans WHERE active=1", ()).fetchall()
                return self.reply({"plans": [dict(r) for r in rows]})
            if self.path == "/api/admin/overview" and user["role"] == "admin":
                return self.admin_overview(con)
            match = re.fullmatch(r"/api/projects/(\d+)", self.path)
            if match:
                return self.project_details(con, user, int(match.group(1)))
        finally:
            con.close()
        self.reply({"error": "Не найдено."}, HTTPStatus.NOT_FOUND)

    def api_post(self, body: dict[str, Any]) -> None:
        ip = self.client_address[0]
        if not rate_allowed(ip):
            return self.reply({"error": "Слишком много попыток. Повторите через минуту."}, HTTPStatus.TOO_MANY_REQUESTS)
        if self.path == "/api/auth/register":
            return self.register(body)
        if self.path == "/api/auth/login":
            return self.login(body)
        if self.path == "/api/auth/logout":
            user = self.current_user()
            if user:
                con = db(); con.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(SimpleCookie(self.headers.get("Cookie")).get("nova_session").value),)); con.commit(); con.close()
            return self.reply({"ok": True}, cookie="nova_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
        user = self.require_user()
        if not user:
            return
        if self.path == "/api/generate":
            return self.generate(user, body)
        if self.path == "/api/projects":
            return self.create_project(user, body)
        if self.path == "/api/project-packs":
            return self.attach_pack(user, body)
        if self.path == "/api/project-packs/custom":
            return self.create_custom_pack(user, body)
        if self.path == "/api/support":
            return self.support(user, body)
        if self.path == "/api/admin/credits" and user["role"] == "admin":
            return self.admin_credits(user, body)
        self.reply({"error": "Не найдено."}, HTTPStatus.NOT_FOUND)

    def register(self, body: dict[str, Any]) -> None:
        email, name, password = safe_text(body.get("email"), 254).lower(), safe_text(body.get("name"), 80), safe_text(body.get("password"), 128)
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(name) < 2 or len(password) < 10 or not body.get("terms"):
            return self.reply({"error": "Укажите имя, корректный email, пароль от 10 символов и примите условия."}, HTTPStatus.BAD_REQUEST)
        con = db()
        try:
            created = now()
            cursor = con.execute("INSERT INTO users(email,name,password_hash,accepted_terms_at,created_at) VALUES(?,?,?,?,?)", (email, name, password_hash(password), created, created))
            user_id = cursor.lastrowid
            plan = con.execute("SELECT id FROM plans WHERE slug='start'").fetchone()["id"]
            ends = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
            con.execute("INSERT INTO subscriptions(user_id,plan_id,status,starts_at,ends_at) VALUES(?,?,?,?,?)", (user_id, plan, "active", created, ends))
            con.execute("INSERT INTO credit_ledger(user_id,amount,reason,comment,created_at) VALUES(?,?,?,?,?)", (user_id, 10, "trial", "Стартовый лимит", created))
            con.commit()
        except sqlite3.IntegrityError:
            return self.reply({"error": "Этот email уже зарегистрирован."}, HTTPStatus.CONFLICT)
        finally:
            con.close()
        user = db(); row = user.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone(); user.close()
        self.reply({"user": self.public_user(row)}, HTTPStatus.CREATED, self.make_session(user_id))

    def login(self, body: dict[str, Any]) -> None:
        email, password = safe_text(body.get("email"), 254).lower(), safe_text(body.get("password"), 128)
        con = db()
        try:
            user = con.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        finally:
            con.close()
        if not user or not password_ok(password, user["password_hash"]) or user["status"] != "active":
            return self.reply({"error": "Неверный email, пароль или аккаунт недоступен."}, HTTPStatus.UNAUTHORIZED)
        self.reply({"user": self.public_user(user)}, cookie=self.make_session(user["id"]))

    def project_details(self, con: sqlite3.Connection, user: sqlite3.Row, project_id: int) -> None:
        project = con.execute("SELECT * FROM projects WHERE id=? AND user_id=?", (project_id, user["id"])).fetchone()
        if not project:
            return self.reply({"error": "Проект не найден."}, HTTPStatus.NOT_FOUND)
        packs = con.execute("SELECT id,title,description,steps_json,status,created_at FROM project_packs WHERE project_id=? ORDER BY id DESC", (project_id,)).fetchall()
        materials = con.execute("SELECT id,tool,output_text,status,model_tier,created_at FROM generations WHERE project_id=? AND user_id=? AND status='completed' ORDER BY id DESC LIMIT 12", (project_id, user["id"])).fetchall()
        self.reply({"project": dict(project), "packs": [{**dict(row), "steps": json.loads(row["steps_json"])} for row in packs], "materials": [dict(row) for row in materials]})

    def create_project(self, user: sqlite3.Row, body: dict[str, Any]) -> None:
        name = safe_text(body.get("name"), 80)
        description, context, tone = safe_text(body.get("description"), 280), safe_text(body.get("brand_context"), 3_000), safe_text(body.get("tone"), 80)
        if len(name) < 2:
            return self.reply({"error": "Назовите проект (минимум 2 символа)."}, HTTPStatus.BAD_REQUEST)
        con = db()
        try:
            created = now()
            cursor = con.execute("""INSERT INTO projects(user_id,name,description,brand_context,tone,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?)""", (user["id"], name, description, context, tone, created, created))
            con.commit()
            project_id = cursor.lastrowid
        finally:
            con.close()
        self.reply({"project": {"id": project_id, "name": name, "description": description, "brand_context": context, "tone": tone}}, HTTPStatus.CREATED)

    def project_owned(self, con: sqlite3.Connection, user_id: int, project_id: Any) -> sqlite3.Row | None:
        try:
            return con.execute("SELECT * FROM projects WHERE id=? AND user_id=?", (int(project_id), user_id)).fetchone()
        except (TypeError, ValueError):
            return None

    def attach_pack(self, user: sqlite3.Row, body: dict[str, Any]) -> None:
        con = db()
        try:
            project = self.project_owned(con, user["id"], body.get("project_id"))
            try:
                pack_id = int(body.get("pack_id"))
            except (TypeError, ValueError):
                pack_id = 0
            pack = con.execute("SELECT * FROM content_packs WHERE id=? AND is_public=1 AND active=1", (pack_id,)).fetchone()
            if not project or not pack:
                return self.reply({"error": "Проект или готовый пак не найден."}, HTTPStatus.NOT_FOUND)
            cursor = con.execute("""INSERT INTO project_packs(project_id,source_pack_id,title,description,steps_json,created_at)
                VALUES(?,?,?,?,?,?)""", (project["id"], pack["id"], pack["title"], pack["description"], pack["steps_json"], now()))
            con.execute("UPDATE projects SET updated_at=? WHERE id=?", (now(), project["id"]))
            con.commit()
        finally:
            con.close()
        self.reply({"project_pack_id": cursor.lastrowid}, HTTPStatus.CREATED)

    def create_custom_pack(self, user: sqlite3.Row, body: dict[str, Any]) -> None:
        title = safe_text(body.get("title"), 80)
        description = safe_text(body.get("description"), 280)
        raw_steps = body.get("steps")
        if not isinstance(raw_steps, list):
            raw_steps = []
        steps: list[dict[str, Any]] = []
        for raw in raw_steps[:8]:
            if not isinstance(raw, dict):
                continue
            tool = safe_text(raw.get("tool"), 20)
            step_title = safe_text(raw.get("title"), 80)
            if tool in {"post", "plan", "rewrite", "chat"} and step_title:
                steps.append({"title": step_title, "tool": tool, "cost": {"post": 1, "rewrite": 1, "chat": 1, "plan": 3}[tool]})
        if len(title) < 2 or not steps:
            return self.reply({"error": "Дайте паку название и добавьте хотя бы один рабочий шаг."}, HTTPStatus.BAD_REQUEST)
        con = db()
        try:
            project = self.project_owned(con, user["id"], body.get("project_id"))
            if not project:
                return self.reply({"error": "Проект не найден."}, HTTPStatus.NOT_FOUND)
            cursor = con.execute("""INSERT INTO project_packs(project_id,title,description,steps_json,created_at)
                VALUES(?,?,?,?,?)""", (project["id"], title, description, json.dumps(steps, ensure_ascii=False), now()))
            con.execute("UPDATE projects SET updated_at=? WHERE id=?", (now(), project["id"]))
            con.commit()
        finally:
            con.close()
        self.reply({"project_pack_id": cursor.lastrowid}, HTTPStatus.CREATED)

    def generate(self, user: sqlite3.Row, body: dict[str, Any]) -> None:
        tool = safe_text(body.get("tool"), 20)
        if tool not in {"post", "plan", "rewrite", "chat"}:
            return self.reply({"error": "Этот инструмент пока недоступен."}, HTTPStatus.BAD_REQUEST)
        fields = {k: safe_text(v) for k, v in body.get("input", {}).items() if isinstance(k, str)} if isinstance(body.get("input"), dict) else {}
        content = " ".join(fields.values())
        if len(content) < 3:
            return self.reply({"error": "Опишите задачу чуть подробнее."}, HTTPStatus.BAD_REQUEST)
        if has_sensitive_data(content):
            return self.reply({"error": "Не отправляйте платёжные, паспортные и другие чувствительные данные."}, HTTPStatus.BAD_REQUEST)
        model_tier = safe_text(body.get("model_tier"), 20) or "swift"
        costs = {"swift": 1, "studio": 3, "deep": 6}
        if model_tier not in costs:
            return self.reply({"error": "Выберите доступный уровень генерации."}, HTTPStatus.BAD_REQUEST)
        cost = costs[model_tier]
        con = db()
        try:
            project = self.project_owned(con, user["id"], body.get("project_id")) if body.get("project_id") is not None else None
            if body.get("project_id") is not None and not project:
                return self.reply({"error": "Выберите свой проект для генерации."}, HTTPStatus.BAD_REQUEST)
            if project:
                fields["project_context"] = project["brand_context"][:3_000]
                fields["project_tone"] = project["tone"]
            credits = con.execute("SELECT COALESCE(SUM(amount),0) AS total FROM credit_ledger WHERE user_id=?", (user["id"],)).fetchone()["total"]
            if credits < cost:
                return self.reply({"error": "Лимит действий закончился."}, HTTPStatus.PAYMENT_REQUIRED)
            cursor = con.execute("""INSERT INTO generations(user_id,project_id,tool,input_json,status,model_tier,created_at)
                VALUES(?,?,?,?,?,?,?)""", (user["id"], project["id"] if project else None, tool, json.dumps(fields, ensure_ascii=False), "processing", model_tier, now()))
            generation_id = cursor.lastrowid
            con.commit()
            try:
                output, provider = call_provider(tool, fields, model_tier)
            except RuntimeError:
                con.execute("UPDATE generations SET status='failed',error_code=?,completed_at=? WHERE id=?", ("provider_unavailable", now(), generation_id)); con.commit()
                return self.reply({"error": "AI временно недоступен. Лимит не списан."}, HTTPStatus.SERVICE_UNAVAILABLE)
            completed = now()
            con.execute("UPDATE generations SET output_text=?,status='completed',cost=?,provider=?,completed_at=? WHERE id=?", (output, cost, provider, completed, generation_id))
            con.execute("INSERT INTO credit_ledger(user_id,amount,reason,generation_id,comment,created_at) VALUES(?,?,?,?,?,?)", (user["id"], -cost, "generation", generation_id, f"{tool}:{model_tier}", completed))
            con.commit()
            credits -= cost
        finally:
            con.close()
        self.reply({"generation": {"id": generation_id, "tool": tool, "output": output, "cost": cost, "credits": credits, "notice": "Проверьте AI-результат человеком перед публикацией."}})

    def support(self, user: sqlite3.Row, body: dict[str, Any]) -> None:
        subject, message = safe_text(body.get("subject"), 120), safe_text(body.get("message"), 3_000)
        if len(subject) < 3 or len(message) < 5:
            return self.reply({"error": "Укажите тему и сообщение."}, HTTPStatus.BAD_REQUEST)
        con = db(); con.execute("INSERT INTO support_tickets(user_id,subject,message,created_at) VALUES(?,?,?,?)", (user["id"], subject, message, now())); con.commit(); con.close()
        self.reply({"ok": True})

    def admin_overview(self, con: sqlite3.Connection) -> None:
        data = {"users": con.execute("SELECT COUNT(*) c FROM users").fetchone()["c"],
                "generations": con.execute("SELECT COUNT(*) c FROM generations WHERE status='completed'").fetchone()["c"],
                "errors": con.execute("SELECT COUNT(*) c FROM generations WHERE status='failed'").fetchone()["c"],
                "tickets": con.execute("SELECT COUNT(*) c FROM support_tickets WHERE status='open'").fetchone()["c"]}
        self.reply({"overview": data})

    def admin_credits(self, actor: sqlite3.Row, body: dict[str, Any]) -> None:
        try:
            user_id, amount = int(body.get("user_id")), int(body.get("amount"))
        except (TypeError, ValueError):
            return self.reply({"error": "Некорректные данные."}, HTTPStatus.BAD_REQUEST)
        comment = safe_text(body.get("comment"), 300)
        if not comment or amount == 0 or abs(amount) > 10_000:
            return self.reply({"error": "Нужны ненулевой лимит и комментарий."}, HTTPStatus.BAD_REQUEST)
        con = db()
        try:
            if not con.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone():
                return self.reply({"error": "Пользователь не найден."}, HTTPStatus.NOT_FOUND)
            con.execute("INSERT INTO credit_ledger(user_id,amount,reason,comment,created_at) VALUES(?,?,?,?,?)", (user_id, amount, "admin_adjustment", comment, now()))
            con.execute("INSERT INTO audit_events(actor_id,action,details,created_at) VALUES(?,?,?,?)", (actor["id"], "credit_adjustment", json.dumps({"user_id":user_id,"amount":amount}), now()))
            con.commit()
        finally:
            con.close()
        self.reply({"ok": True})

    def docs(self) -> None:
        slug = self.path.split("?", 1)[0].rstrip("/").split("/")[-1]
        titles = {"privacy": "Политика обработки персональных данных", "terms": "Пользовательское соглашение", "digital-service": "Условия цифровой услуги", "refunds": "Отмена и возврат"}
        if slug not in titles:
            self.send_error(HTTPStatus.NOT_FOUND); return
        html = f"""<!doctype html><html lang=\"ru\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{titles[slug]} — Nova Content AI</title><style>body{{max-width:780px;margin:50px auto;padding:0 22px;background:#090b13;color:#e9eaf2;font:16px/1.7 Arial}}a{{color:#a992ff}}h1{{line-height:1.15}}.note{{padding:15px;border:1px solid #4d456e;background:#171525;border-radius:10px}}</style><a href=\"/\">← Nova Content AI</a><h1>{titles[slug]}</h1><p class=\"note\">Черновая страница MVP. Перед запуском оплаты и публичного доступа текст должен быть заполнен фактическими реквизитами, сроками хранения и согласован с юристом и платёжной системой.</p><h2>Что реализовано сейчас</h2><p>Сервис создаёт текстовые черновики в личном кабинете. Платежи, загрузка файлов и передача API-ключей пользователям не предусмотрены. AI-результаты требуют проверки человеком перед публикацией.</p><h2>Контакт</h2><p>support@example.com — замените на рабочий адрес до публикации.</p></html>"""
        raw = html.encode(); self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)


if __name__ == "__main__":
    initialize()
    print(f"Nova Content AI: http://localhost:{PORT}")
    ThreadingHTTPServer(("", PORT), NovaHandler).serve_forever()
