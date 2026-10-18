from fastapi import APIRouter
from sqlalchemy import or_, select

from app.api.deps import DB, CurrentUser, owned
from app.models import Agent, KnowledgeBase
from app.schemas import AgentIn, AgentOut

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("", response_model=list[AgentOut])
async def list_agents(user: CurrentUser, db: DB) -> list[Agent]:
    """Built-in agents first, then the user's own."""
    return list((await db.scalars(
        select(Agent).where(or_(Agent.user_id.is_(None), Agent.user_id == user.id))
        .order_by(Agent.user_id.is_not(None), Agent.id)
    )).all())


@router.post("", response_model=AgentOut, status_code=201)
async def create_agent(body: AgentIn, user: CurrentUser, db: DB) -> Agent:
    if body.knowledge_base_id is not None:
        await owned(db, KnowledgeBase, body.knowledge_base_id, user)
    agent = Agent(user_id=user.id, **body.model_dump())
    db.add(agent)
    await db.commit()
    return agent


@router.put("/{agent_id}", response_model=AgentOut)
async def update_agent(agent_id: int, body: AgentIn, user: CurrentUser, db: DB) -> Agent:
    agent = await owned(db, Agent, agent_id, user)
    if body.knowledge_base_id is not None:
        await owned(db, KnowledgeBase, body.knowledge_base_id, user)
    for key, value in body.model_dump().items():
        setattr(agent, key, value)
    await db.commit()
    await db.refresh(agent)
    return agent


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(agent_id: int, user: CurrentUser, db: DB) -> None:
    await db.delete(await owned(db, Agent, agent_id, user))
    await db.commit()
