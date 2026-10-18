"""Builds what the model sees: system prompt, retrieved sources, rolling summary and recent history."""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Agent, AIModel, Chat, Message, Project
from app.services import billing, llm
from app.services.rag import Source

log = logging.getLogger(__name__)

BASE_PROMPT = (
    "Ты — Nova, AI-ассистент платформы Nova AI. Отвечай на языке пользователя, по делу, "
    "используй Markdown (списки, заголовки, таблицы, блоки кода), когда это помогает. "
    "Не выдумывай факты; если чего-то не знаешь — так и скажи."
)

SOURCES_RULES = (
    "Ниже — фрагменты из базы знаний пользователя. Опирайся на них в первую очередь и ссылайся "
    "на источник в виде [1], [2]. Если ответа в фрагментах нет — скажи об этом и ответь из общих знаний."
)


def build_system(agent: Agent | None, project: Project | None, summary: str, sources: list[Source]) -> str:
    parts = [agent.system_prompt if agent else BASE_PROMPT]
    if project:
        brand = [f"Проект: {project.name}"]
        if project.description:
            brand.append(f"Описание: {project.description}")
        if project.tone:
            brand.append(f"Тон бренда: {project.tone}")
        if project.brand_context:
            brand.append(f"Память бренда:\n{project.brand_context[:4000]}")
        parts.append("<project>\n" + "\n".join(brand) + "\n</project>")
    if summary:
        parts.append(f"<conversation_summary>\nКраткое содержание более ранней части диалога:\n{summary}\n"
                     "</conversation_summary>")
    if sources:
        body = "\n\n".join(f"[{i}] ({s.filename})\n{s.content}" for i, s in enumerate(sources, 1))
        parts.append(f"{SOURCES_RULES}\n<sources>\n{body}\n</sources>")
    return "\n\n".join(parts)


def fit_history(messages: list[Message], budget: int) -> list[Message]:
    """Newest-first packing into the token budget; always keeps the latest message."""
    kept: list[Message] = []
    used = 0
    for message in reversed(messages):
        cost = llm.estimate_tokens(message.content) + 4
        if kept and used + cost > budget:
            break
        kept.append(message)
        used += cost
    return list(reversed(kept))


async def unsummarized(db: AsyncSession, chat: Chat) -> list[Message]:
    return list((await db.scalars(
        select(Message).where(Message.chat_id == chat.id, Message.id > chat.summary_upto_id).order_by(Message.id)
    )).all())


async def maybe_summarize(db: AsyncSession, chat: Chat, model: AIModel) -> None:
    """Fold the older half of a long conversation into chat.summary to keep prompts small.

    Uses the chat's own model; failures are non-fatal (the next turn simply retries).
    """
    history = await unsummarized(db, chat)
    if len(history) < settings.summary_trigger_messages:
        return
    old = history[: len(history) // 2]
    transcript = "\n".join(f"{m.role}: {m.content[:2000]}" for m in old)
    prompt = (
        "Обнови краткое содержание диалога. Сохрани факты, решения, имена, цифры, договорённости и "
        "открытые вопросы. Пиши сжато, маркированным списком, не более 250 слов.\n\n"
        f"Предыдущее содержание:\n{chat.summary or '—'}\n\nНовые сообщения:\n{transcript}"
    )
    try:
        text, usage = await llm.complete(model.provider, model.provider_model,
                                     "Ты сжимаешь историю диалога.", [{"role": "user", "content": prompt}],
                                     temperature=0.2, max_tokens=600)
    except llm.ProviderError:
        log.warning("summary failed for chat %s", chat.id)
        return
    billing.record_usage(db, chat.user_id, "summary", model, usage)  # platform cost, not billed
    chat.summary = text
    chat.summary_upto_id = old[-1].id
    await db.commit()
