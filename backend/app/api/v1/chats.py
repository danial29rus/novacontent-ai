import asyncio
import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, CurrentUser, RateLimited, owned
from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Agent, AIModel, Chat, KnowledgeBase, Message, Project
from app.schemas import ChatIn, ChatOut, ChatUpdate, MessageOut, SendIn
from app.services import billing, context, llm, rag

router = APIRouter(prefix="/chats", tags=["chats"])
log = logging.getLogger(__name__)
_background: set[asyncio.Task] = set()


async def resolve_model(db: AsyncSession, model_id: int | None) -> AIModel:
    model = await db.get(AIModel, model_id) if model_id else None
    if model is None or not model.is_active:
        model = await db.scalar(
            select(AIModel).where(AIModel.is_active).order_by(AIModel.is_default.desc(), AIModel.sort)
        )
    if model is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Нет доступных моделей.")
    return model


async def visible_agent(db: AsyncSession, agent_id: int | None, user_id: int) -> Agent | None:
    if agent_id is None:
        return None
    agent = await db.get(Agent, agent_id)
    if agent is None or agent.user_id not in (None, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Агент не найден.")
    return agent


@router.get("", response_model=list[ChatOut])
async def list_chats(user: CurrentUser, db: DB, project_id: int | None = None, q: str | None = None) -> list[Chat]:
    query = select(Chat).where(Chat.user_id == user.id)
    if project_id is not None:
        query = query.where(Chat.project_id == project_id)
    if q:
        query = query.where(Chat.title.ilike(f"%{q[:60]}%"))
    return list((await db.scalars(query.order_by(Chat.pinned.desc(), Chat.updated_at.desc()).limit(200))).all())


@router.post("", response_model=ChatOut, status_code=201)
async def create_chat(body: ChatIn, user: CurrentUser, db: DB) -> Chat:
    agent = await visible_agent(db, body.agent_id, user.id)
    if body.project_id is not None:
        await owned(db, Project, body.project_id, user)
    kb_id = body.knowledge_base_id or (agent.knowledge_base_id if agent else None)
    if kb_id is not None:
        await owned(db, KnowledgeBase, kb_id, user)
    model = await resolve_model(db, body.model_id or (agent.model_id if agent else None))
    chat = Chat(user_id=user.id, title=body.title or (agent.name if agent else "Новый чат"), model_id=model.id,
                agent_id=agent.id if agent else None, project_id=body.project_id, knowledge_base_id=kb_id)
    db.add(chat)
    await db.commit()
    return chat


@router.get("/{chat_id}", response_model=ChatOut)
async def get_chat(chat_id: int, user: CurrentUser, db: DB) -> Chat:
    return await owned(db, Chat, chat_id, user)


@router.patch("/{chat_id}", response_model=ChatOut)
async def update_chat(chat_id: int, body: ChatUpdate, user: CurrentUser, db: DB) -> Chat:
    chat = await owned(db, Chat, chat_id, user)
    data = body.model_dump(exclude_unset=True)
    if data.get("knowledge_base_id") is not None:
        await owned(db, KnowledgeBase, data["knowledge_base_id"], user)
    if data.get("model_id") is not None:
        data["model_id"] = (await resolve_model(db, data["model_id"])).id
    for key, value in data.items():
        setattr(chat, key, value)
    await db.commit()
    return chat


@router.delete("/{chat_id}", status_code=204)
async def delete_chat(chat_id: int, user: CurrentUser, db: DB) -> None:
    await owned(db, Chat, chat_id, user)
    await db.execute(delete(Chat).where(Chat.id == chat_id))
    await db.commit()


@router.get("/{chat_id}/messages", response_model=list[MessageOut])
async def messages(chat_id: int, user: CurrentUser, db: DB) -> list[Message]:
    await owned(db, Chat, chat_id, user)
    return list((await db.scalars(select(Message).where(Message.chat_id == chat_id).order_by(Message.id))).all())


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


@router.post("/{chat_id}/messages", dependencies=[RateLimited])
async def send(chat_id: int, body: SendIn, user: CurrentUser, db: DB) -> StreamingResponse:
    """Streams the answer as Server-Sent Events: meta → delta* → done | error."""
    chat = await owned(db, Chat, chat_id, user)
    try:
        await billing.ensure_can_spend(db, user.id)
    except billing.InsufficientBalance:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Искры закончились. Пополните баланс.") from None

    if body.model_id and body.model_id != chat.model_id:
        chat.model_id = (await resolve_model(db, body.model_id)).id
    model = await resolve_model(db, chat.model_id)
    agent = await db.get(Agent, chat.agent_id) if chat.agent_id else None
    project = await db.get(Project, chat.project_id) if chat.project_id else None

    user_message = Message(chat_id=chat.id, role="user", content=body.content.strip())
    db.add(user_message)
    if chat.title in ("Новый чат", agent.name if agent else None):
        chat.title = body.content.strip().replace("\n", " ")[:60]
    await db.commit()

    sources: list[rag.Source] = []
    if chat.knowledge_base_id:
        sources = await rag.search(db, chat.knowledge_base_id, body.content)

    system = context.build_system(agent, project, chat.summary, sources)
    budget = min(settings.context_budget_tokens, model.context_window // 2) - llm.estimate_tokens(system)
    history = context.fit_history(await context.unsummarized(db, chat), max(budget, 1000))
    prompt = [{"role": m.role, "content": m.content} for m in history]
    temperature = agent.temperature if agent else 0.7
    source_refs = [{"n": i, "document_id": s.document_id, "filename": s.filename, "score": s.score,
                    "excerpt": s.content[:280]} for i, s in enumerate(sources, 1)]
    ids = {"chat_id": chat.id, "user_id": user.id, "model_id": model.id}

    async def stream() -> AsyncIterator[str]:
        yield sse("meta", {"user_message_id": user_message.id, "model": model.slug, "title": chat.title,
                           "sources": source_refs, "context_messages": len(history)})
        text, usage, finished = "", None, None
        try:
            async for event in llm.get_provider(model.provider).stream(
                model.provider_model, system, prompt, temperature, max_tokens=4096
            ):
                if isinstance(event, llm.Usage):
                    usage = event
                else:
                    text += event
                    yield sse("delta", {"text": event})
        except llm.ProviderError:
            log.exception("provider error in chat %s", ids["chat_id"])
            yield sse("error", {"message": "Модель временно недоступна. Искры за ответ не списаны."})
            text = ""
        finally:
            # Persist (and bill) even if the client disconnected mid-stream.
            if text:
                finished = await asyncio.shield(_finish(ids, text, usage, source_refs))
        if finished:
            yield sse("done", finished)
            task = asyncio.create_task(_summarize(ids["chat_id"], ids["model_id"]))
            _background.add(task)
            task.add_done_callback(_background.discard)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def _finish(ids: dict, text: str, usage: llm.Usage | None, sources: list[dict]) -> dict:
    async with SessionLocal() as db:
        model = await db.get(AIModel, ids["model_id"])
        chat = await db.get(Chat, ids["chat_id"])
        usage = usage or llm.Usage(0, llm.estimate_tokens(text))
        cost = billing.usage_cost(model, usage)
        message = Message(chat_id=chat.id, role="assistant", content=text, model_slug=model.slug,
                          prompt_tokens=usage.prompt_tokens, completion_tokens=usage.completion_tokens,
                          cost=cost, sources=sources)
        db.add(message)
        await db.flush()
        balance = await billing.apply(
            db, ids["user_id"], -cost, "usage", f"Чат «{chat.title[:60]}» · {model.title}",
            {"chat_id": chat.id, "message_id": message.id, "model": model.slug,
             "prompt_tokens": usage.prompt_tokens, "completion_tokens": usage.completion_tokens},
        )
        billing.record_usage(db, ids["user_id"], "chat", model, usage, cost)
        chat.updated_at = func.now()
        await db.commit()
        await db.refresh(message)
        return {"message": MessageOut.model_validate(message).model_dump(mode="json"), "balance": balance}


async def _summarize(chat_id: int, model_id: int) -> None:
    async with SessionLocal() as db:
        chat, model = await db.get(Chat, chat_id), await db.get(AIModel, model_id)
        if chat and model:
            await context.maybe_summarize(db, chat, model)
