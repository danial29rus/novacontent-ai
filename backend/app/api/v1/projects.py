from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser, RateLimited, owned
from app.api.v1.chats import resolve_model
from app.models import Chat, ContentPack, Generation, Project, ProjectPack
from app.schemas import GenerateIn, GenerationOut, PackOut, ProjectIn, ProjectOut, ProjectPackIn
from app.services import billing, context, llm, studio

router = APIRouter(tags=["projects"])


@router.get("/projects", response_model=list[ProjectOut])
async def list_projects(user: CurrentUser, db: DB) -> list[Project]:
    return list((await db.scalars(
        select(Project).where(Project.user_id == user.id).order_by(Project.updated_at.desc())
    )).all())


@router.post("/projects", response_model=ProjectOut, status_code=201)
async def create_project(body: ProjectIn, user: CurrentUser, db: DB) -> Project:
    project = Project(user_id=user.id, **body.model_dump())
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@router.get("/projects/{project_id}")
async def project_details(project_id: int, user: CurrentUser, db: DB) -> dict:
    project = await owned(db, Project, project_id, user)
    packs = (await db.scalars(
        select(ProjectPack).where(ProjectPack.project_id == project_id).order_by(ProjectPack.id.desc())
    )).all()
    chats = await db.scalar(select(func.count(Chat.id)).where(Chat.project_id == project_id))
    return {
        "project": ProjectOut.model_validate(project),
        "packs": [PackOut.model_validate(p) for p in packs],
        "chats_count": chats,
    }


@router.put("/projects/{project_id}", response_model=ProjectOut)
async def update_project(project_id: int, body: ProjectIn, user: CurrentUser, db: DB) -> Project:
    project = await owned(db, Project, project_id, user)
    for key, value in body.model_dump().items():
        setattr(project, key, value)
    await db.commit()
    await db.refresh(project)
    return project


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(project_id: int, user: CurrentUser, db: DB) -> None:
    await db.delete(await owned(db, Project, project_id, user))
    await db.commit()


@router.get("/packs", response_model=list[PackOut])
async def packs(db: DB) -> list[ContentPack]:
    return list((await db.scalars(select(ContentPack).where(ContentPack.is_active).order_by(ContentPack.id))).all())


@router.post("/projects/{project_id}/packs", response_model=PackOut, status_code=201)
async def add_pack(project_id: int, body: ProjectPackIn, user: CurrentUser, db: DB) -> ProjectPack:
    """Attach a ready-made pack (pack_id) or create a custom one (title + steps)."""
    await owned(db, Project, project_id, user)
    if body.pack_id is not None:
        source = await db.get(ContentPack, body.pack_id)
        if source is None or not source.is_active:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Пак не найден.")
        pack = ProjectPack(project_id=project_id, source_pack_id=source.id, title=source.title,
                           description=source.description, steps=source.steps)
    else:
        if not body.title or not body.steps:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Дайте паку название и добавьте хотя бы один шаг.")
        pack = ProjectPack(project_id=project_id, title=body.title, description=body.description,
                           steps=[s.model_dump() for s in body.steps])
    db.add(pack)
    await db.commit()
    return pack


@router.delete("/projects/{project_id}/packs/{pack_id}", status_code=204)
async def remove_pack(project_id: int, pack_id: int, user: CurrentUser, db: DB) -> None:
    await owned(db, Project, project_id, user)
    pack = await db.get(ProjectPack, pack_id)
    if pack is None or pack.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пак не найден.")
    await db.delete(pack)
    await db.commit()


@router.get("/studio/tools")
async def tools() -> list[dict]:
    return [{"id": key, "title": tool["title"]} for key, tool in studio.TOOLS.items()]


@router.post("/studio/generate", response_model=GenerationOut, dependencies=[RateLimited])
async def generate(body: GenerateIn, user: CurrentUser, db: DB) -> Generation:
    fields = {k[:40]: v.strip()[:8000] for k, v in body.input.items() if v and v.strip()}
    if len(" ".join(fields.values())) < 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Опишите задачу чуть подробнее.")
    project = await owned(db, Project, body.project_id, user) if body.project_id is not None else None
    try:
        await billing.ensure_can_spend(db, user.id)
    except billing.InsufficientBalance:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Искры закончились. Пополните баланс.") from None
    model = await resolve_model(db, body.model_id)
    system = context.build_system(None, project, "", []) + "\n\n" + studio.TOOLS[body.tool]["prompt"]
    try:
        output, usage = await llm.complete(model.provider, model.provider_model, system,
                                           [{"role": "user", "content": studio.render_input(fields)}])
    except llm.ProviderError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Модель временно недоступна. Искры не списаны."
        ) from None
    cost = billing.usage_cost(model, usage)
    generation = Generation(user_id=user.id, project_id=project.id if project else None, tool=body.tool,
                            input=fields, output=output, model_slug=model.slug, cost=cost)
    db.add(generation)
    await db.flush()
    await billing.apply(db, user.id, -cost, "usage", f"Студия · {studio.TOOLS[body.tool]['title']} · {model.title}",
                        {"generation_id": generation.id, "model": model.slug})
    billing.record_usage(db, user.id, "studio", model, usage, cost)
    await db.commit()
    await db.refresh(generation)
    return generation


@router.get("/library", response_model=list[GenerationOut])
async def library(user: CurrentUser, db: DB, project_id: int | None = None) -> list[Generation]:
    query = select(Generation).where(Generation.user_id == user.id)
    if project_id is not None:
        query = query.where(Generation.project_id == project_id)
    return list((await db.scalars(query.order_by(Generation.id.desc()).limit(100))).all())


@router.delete("/library/{generation_id}", status_code=204)
async def delete_generation(generation_id: int, user: CurrentUser, db: DB) -> None:
    await db.delete(await owned(db, Generation, generation_id, user))
    await db.commit()
