"""Idempotent reference data. Runs on startup; existing rows are never overwritten."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.models import Agent, AIModel, ContentPack, TopupPackage, User
from app.services import billing
from app.services.growth import new_ref_code

# Only OpenAI GPT 5.x–6.x (no Astra). Prices: ✦ per 1M tokens; cost_*: provider $ per 1M.
MODELS = [
    dict(slug="gpt-6-luna", provider="openai", provider_model="gpt-6-luna", title="GPT-6 Luna",
         description="Быстрая и экономная модель OpenAI для повседневных задач.", badge="Быстрая",
         context_window=400_000, input_price=40, output_price=200, cost_input_usd=0.10, cost_output_usd=0.50,
         is_default=True, sort=10),
    dict(slug="gpt-5.6-terra", provider="openai", provider_model="gpt-5.6-terra", title="GPT-5.6 Terra",
         description="Сильная модель OpenAI: длинные тексты, стратегия, анализ и код.", badge="Умная",
         context_window=400_000, input_price=750, output_price=4500, cost_input_usd=2, cost_output_usd=12, sort=20),
]

# 1 ✦ ≈ 1 ₽; bigger packages get a bigger bonus.
PACKAGES = [
    dict(slug="start", title="Старт", tokens=500, price_kopeks=50_000),
    dict(slug="basic", title="Базовый", tokens=1_000, price_kopeks=100_000, bonus_percent=10),
    dict(slug="pro", title="Про", tokens=2_500, price_kopeks=250_000, bonus_percent=15, highlight=True),
    dict(slug="creator", title="Креатор", tokens=5_000, price_kopeks=500_000, bonus_percent=20),
    dict(slug="studio", title="Студия", tokens=10_000, price_kopeks=1_000_000, bonus_percent=25),
    dict(slug="business", title="Бизнес", tokens=25_000, price_kopeks=2_500_000, bonus_percent=30),
]

PACKS = [
    dict(slug="week", emoji="🗓️", title="Контент на неделю",
         description="Темы, черновики и финальные публикации на 7 дней.",
         steps=[{"title": "Контент-план на неделю", "tool": "plan"}, {"title": "Первый пост", "tool": "post"},
                {"title": "Идеи для сторис", "tool": "ideas"}]),
    dict(slug="launch", emoji="🚀", title="Запуск продукта",
         description="Упакуйте запуск: идея, прогрев, анонс и видео.",
         steps=[{"title": "Карта прогрева", "tool": "plan"}, {"title": "Анонс", "tool": "post"},
                {"title": "Сценарий тизера", "tool": "script"}]),
    dict(slug="telegram", emoji="✈️", title="Серия для Telegram",
         description="Рубрики и серия публикаций с человеческим голосом бренда.",
         steps=[{"title": "Рубрикатор", "tool": "ideas"}, {"title": "Пост-знакомство", "tool": "post"},
                {"title": "Усилить тон", "tool": "rewrite"}]),
    dict(slug="reels", emoji="🎬", title="Reels-машина",
         description="Пять коротких видео: хуки, сценарии и подписи.",
         steps=[{"title": "Идеи роликов", "tool": "ideas"}, {"title": "Сценарий", "tool": "script"},
                {"title": "Подпись к ролику", "tool": "post"}]),
]

AGENTS = [
    dict(name="Копирайтер", emoji="✍️", color="violet",
         description="Пишет посты, рассылки и лендинги живым языком.",
         system_prompt="Ты сильный копирайтер. Пиши живо, конкретно, без канцелярита и клише. "
                       "Перед длинным текстом уточняй аудиторию и цель, если они неясны."),
    dict(name="Маркетолог", emoji="📈", color="cyan",
         description="Позиционирование, воронки, гипотезы и анализ конкурентов.",
         system_prompt="Ты опытный маркетолог-стратег. Мысли через аудиторию, оффер и метрики. "
                       "Предлагай проверяемые гипотезы и не обещай гарантированных результатов."),
    dict(name="Разработчик", emoji="🧑‍💻", color="emerald",
         description="Код, ревью, архитектура и отладка.",
         system_prompt="Ты senior-разработчик. Отвечай точно, давай рабочий код в блоках с указанием языка, "
                       "объясняй компромиссы коротко."),
    dict(name="Аналитик документов", emoji="📚", color="amber",
         description="Отвечает строго по вашей базе знаний со ссылками на источники.",
         system_prompt="Ты аналитик. Отвечай строго по предоставленным фрагментам базы знаний и ставь ссылки "
                       "[n]. Если информации нет — прямо скажи об этом.", temperature=0.2),
]


async def run(db: AsyncSession) -> None:
    for spec in MODELS:
        if not await db.scalar(select(AIModel.id).where(AIModel.slug == spec["slug"])):
            db.add(AIModel(**spec))
    for spec in PACKAGES:
        if not await db.scalar(select(TopupPackage.id).where(TopupPackage.slug == spec["slug"])):
            db.add(TopupPackage(**spec))
    for spec in PACKS:
        if not await db.scalar(select(ContentPack.id).where(ContentPack.slug == spec["slug"])):
            db.add(ContentPack(**spec))
    for spec in AGENTS:
        if not await db.scalar(select(Agent.id).where(Agent.user_id.is_(None), Agent.name == spec["name"])):
            db.add(Agent(**spec))

    if settings.admin_email and settings.admin_password:
        email = settings.admin_email.strip().lower()
        if not await db.scalar(select(User.id).where(User.email == email)):
            admin = User(email=email, name="Администратор", role="admin", ref_code=new_ref_code(),
                         password_hash=hash_password(settings.admin_password))
            db.add(admin)
            await db.flush()
            await billing.apply(db, admin.id, settings.welcome_tokens, "welcome", "Стартовый баланс")
    await db.commit()
