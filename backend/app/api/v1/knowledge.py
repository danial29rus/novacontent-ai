from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser, RateLimited, owned
from app.core.config import settings
from app.models import Document, KnowledgeBase
from app.schemas import DocumentOut, KnowledgeBaseIn, KnowledgeBaseOut, SearchHit
from app.services import rag

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.get("", response_model=list[KnowledgeBaseOut])
async def list_bases(user: CurrentUser, db: DB) -> list[KnowledgeBaseOut]:
    count = select(func.count(Document.id)).where(Document.knowledge_base_id == KnowledgeBase.id).scalar_subquery()
    rows = (await db.execute(
        select(KnowledgeBase, count.label("n")).where(KnowledgeBase.user_id == user.id)
        .order_by(KnowledgeBase.id.desc())
    )).all()
    return [KnowledgeBaseOut.model_validate(kb).model_copy(update={"documents_count": n}) for kb, n in rows]


@router.post("", response_model=KnowledgeBaseOut, status_code=201)
async def create_base(body: KnowledgeBaseIn, user: CurrentUser, db: DB) -> KnowledgeBase:
    kb = KnowledgeBase(user_id=user.id, **body.model_dump())
    db.add(kb)
    await db.commit()
    return kb


@router.delete("/{kb_id}", status_code=204)
async def delete_base(kb_id: int, user: CurrentUser, db: DB) -> None:
    await db.delete(await owned(db, KnowledgeBase, kb_id, user))
    await db.commit()


@router.get("/{kb_id}/documents", response_model=list[DocumentOut])
async def documents(kb_id: int, user: CurrentUser, db: DB) -> list[Document]:
    await owned(db, KnowledgeBase, kb_id, user)
    return list((await db.scalars(
        select(Document).where(Document.knowledge_base_id == kb_id).order_by(Document.id.desc())
    )).all())


@router.post("/{kb_id}/documents", response_model=DocumentOut, status_code=202, dependencies=[RateLimited])
async def upload(kb_id: int, file: UploadFile, tasks: BackgroundTasks, user: CurrentUser, db: DB) -> Document:
    await owned(db, KnowledgeBase, kb_id, user)
    data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Файл больше {settings.max_upload_mb} МБ.")
    filename = (file.filename or "document.txt")[:200]
    try:
        text = rag.extract_text(filename, data)
    except ValueError:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            "Поддерживаются PDF, TXT, MD, CSV, JSON, HTML.") from None
    except Exception:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Не удалось прочитать файл.") from None
    document = Document(knowledge_base_id=kb_id, filename=filename, size_bytes=len(data))
    db.add(document)
    await db.commit()
    tasks.add_task(rag.ingest, document.id, text)
    return document


class TextIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    text: str = Field(min_length=20, max_length=500_000)


@router.post("/{kb_id}/text", response_model=DocumentOut, status_code=202)
async def add_text(kb_id: int, body: TextIn, tasks: BackgroundTasks, user: CurrentUser, db: DB) -> Document:
    """Paste notes directly, without a file."""
    await owned(db, KnowledgeBase, kb_id, user)
    document = Document(knowledge_base_id=kb_id, filename=f"{body.title}.txt", size_bytes=len(body.text.encode()))
    db.add(document)
    await db.commit()
    tasks.add_task(rag.ingest, document.id, body.text)
    return document


@router.delete("/{kb_id}/documents/{doc_id}", status_code=204)
async def delete_document(kb_id: int, doc_id: int, user: CurrentUser, db: DB) -> None:
    await owned(db, KnowledgeBase, kb_id, user)
    document = await db.get(Document, doc_id)
    if document is None or document.knowledge_base_id != kb_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Документ не найден.")
    await db.delete(document)
    await db.commit()


@router.get("/{kb_id}/search", response_model=list[SearchHit])
async def search(kb_id: int, q: str, user: CurrentUser, db: DB) -> list[SearchHit]:
    await owned(db, KnowledgeBase, kb_id, user)
    return [SearchHit(**vars(s)) for s in await rag.search(db, kb_id, q[:2000])]
