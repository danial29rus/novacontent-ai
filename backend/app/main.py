import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.v1 import (
    admin,
    admin_growth,
    admin_users,
    agents,
    auth,
    billing,
    chats,
    growth,
    knowledge,
    projects,
    services,
    support,
)
from app.core.config import settings
from app.db.session import SessionLocal
from app.services import seed

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.is_production and (problems := settings.production_problems()):
        raise RuntimeError("Небезопасные настройки для production:\n- " + "\n- ".join(problems))
    if settings.is_production:
        for warning in settings.production_warnings():
            logging.getLogger("nova").warning(warning)
    async with SessionLocal() as db:
        await seed.run(db)
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.2.0",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/api/docs",
    openapi_url=None if settings.is_production else "/api/openapi.json",
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

api = APIRouter(prefix="/api/v1")
ROUTERS = (auth, billing, chats, agents, knowledge, projects, services, growth, support,
           admin, admin_users, admin_growth)
for module in ROUTERS:
    api.include_router(module.router)
app.include_router(api)


@app.get("/api/health", tags=["system"])
async def health() -> dict:
    async with SessionLocal() as db:
        await db.execute(text("SELECT 1"))
    return {"status": "ok"}
