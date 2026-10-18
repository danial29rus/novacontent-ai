import json
import re
from dataclasses import asdict

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, CurrentUser, RateLimited, owned
from app.api.v1.chats import resolve_model
from app.models import Agent, AIModel, Generation, Project
from app.schemas import AgentOut, GenerationOut
from app.services import billing, context, llm
from app.services.catalog import BY_SLUG, SERVICES, Service

router = APIRouter(prefix="/services", tags=["services"])


class RunIn(BaseModel):
    input: dict[str, str]
    project_id: int | None = None


@router.get("")
async def list_services() -> list[dict]:
    return [{k: v for k, v in asdict(s).items() if k not in ("prompt", "model", "max_tokens")} for s in SERVICES]


async def _service_model(db: AsyncSession, service: Service) -> AIModel:
    preferred = await db.scalar(select(AIModel).where(AIModel.slug == service.model, AIModel.is_active))
    return preferred or await resolve_model(db, None)


def _parse_agent(text: str, fields: dict[str, str]) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    try:
        data = json.loads(match.group(0)) if match else {}
    except json.JSONDecodeError:
        data = {}
    if not isinstance(data, dict) or not str(data.get("system_prompt", "")).strip():
        # Model didn't return usable JSON (or dev provider): build a solid prompt from the brief itself.
        data = {
            "name": "Мой агент",
            "description": fields.get("goal", "")[:200],
            "system_prompt": (
                f"Ты — AI-агент компании. Задача: {fields.get('goal', '')}\n"
                f"О бизнесе: {fields.get('business', '')}\nАудитория: {fields.get('audience', '')}\n"
                f"Тон общения: {fields.get('tone', 'дружелюбный')}\n"
                f"Ограничения: {fields.get('rules', 'не выдумывай факты')}\n"
                "Отвечай по делу, уточняй детали, если запрос неясен."
            ),
        }
    return {
        "name": str(data.get("name") or "Мой агент")[:80],
        "emoji": str(data.get("emoji") or "🤖")[:8],
        "description": str(data.get("description") or "")[:300],
        "system_prompt": str(data["system_prompt"])[:8000],
    }


@router.post("/{slug}/run", dependencies=[RateLimited])
async def run(slug: str, body: RunIn, user: CurrentUser, db: DB) -> dict:
    service = BY_SLUG.get(slug)
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Услуга не найдена.")
    fields = {k[:40]: v.strip()[:6000] for k, v in body.input.items() if isinstance(v, str) and v.strip()}
    missing = [f.label for f in service.fields if f.required and f.name not in fields]
    if missing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Заполните: {', '.join(missing)}.")
    if user.balance < service.price:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED,
                            f"Нужно {service.price} ✦, на балансе {user.balance} ✦.")
    project = await owned(db, Project, body.project_id, user) if body.project_id is not None else None

    model = await _service_model(db, service)
    labels = {f.name: f.label for f in service.fields}
    brief = "\n".join(f"{labels.get(k, k)}: {v}" for k, v in fields.items())
    system = context.build_system(None, project, "", []) + "\n\n" + service.prompt
    try:
        output, usage = await llm.complete(model.provider, model.provider_model, system,
                                       [{"role": "user", "content": brief}], max_tokens=service.max_tokens)
    except llm.ProviderError:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Модель временно недоступна. Искры не списаны.") from None

    agent = None
    if service.result == "agent":
        spec = _parse_agent(output, fields)
        agent = Agent(user_id=user.id, model_id=model.id, color="violet", **spec)
        db.add(agent)
        await db.flush()
        output = (f"## {spec['emoji']} {spec['name']}\n\n{spec['description']}\n\n"
                  f"### Инструкция агента\n\n{spec['system_prompt']}")

    generation = Generation(user_id=user.id, project_id=project.id if project else None, tool=service.slug,
                            input=fields, output=output, model_slug=model.slug, cost=service.price)
    db.add(generation)
    await db.flush()
    balance = await billing.apply(db, user.id, -service.price, "usage", f"Услуга · {service.title}",
                                  {"service": service.slug, "generation_id": generation.id})
    billing.record_usage(db, user.id, "service", model, usage, service.price)
    await db.commit()
    await db.refresh(generation)
    return {
        "generation": GenerationOut.model_validate(generation),
        "agent": AgentOut.model_validate(agent) if agent else None,
        "balance": balance,
    }
