import io
import logging
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Chunk, Document, KnowledgeBase, UsageEvent
from app.services.embeddings import embed

log = logging.getLogger(__name__)

TEXT_TYPES = {".txt", ".md", ".markdown", ".csv", ".json", ".html", ".xml", ".yml", ".yaml"}
SUPPORTED = TEXT_TYPES | {".pdf"}
CHUNK_CHARS = 1200
OVERLAP_CHARS = 200


@dataclass
class Source:
    document_id: int
    filename: str
    content: str
    score: float


def _embedding_cost(tokens: int) -> float:
    return tokens * settings.embedding_cost_usd / 1_000_000 if settings.openai_api_key else 0.0


def extract_text(filename: str, data: bytes) -> str:
    suffix = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    if suffix in TEXT_TYPES:
        return data.decode("utf-8", errors="ignore")
    raise ValueError("unsupported")


def chunk_text(text: str) -> list[str]:
    """Paragraph-aware chunks of ~CHUNK_CHARS with a tail overlap for continuity."""
    text = re.sub(r"[ \t]+", " ", text).strip()
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        while len(para) > CHUNK_CHARS:  # split giant paragraphs on sentence-ish boundaries
            cut = para.rfind(". ", 0, CHUNK_CHARS)
            cut = cut + 1 if cut > CHUNK_CHARS // 2 else CHUNK_CHARS
            pieces, para = para[:cut], para[cut:].strip()
            if current:
                chunks.append(current)
                current = ""
            chunks.append(pieces)
        if len(current) + len(para) + 2 > CHUNK_CHARS and current:
            chunks.append(current)
            current = current[-OVERLAP_CHARS:] + "\n\n" + para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        chunks.append(current)
    return chunks


async def ingest(document_id: int, text: str) -> None:
    """Runs as a background task with its own DB session."""
    async with SessionLocal() as db:
        document = await db.get(Document, document_id)
        if document is None:
            return
        try:
            pieces = chunk_text(text)
            if not pieces:
                raise ValueError("В файле не найден текст.")
            vectors = await embed(pieces)
            db.add_all(
                Chunk(document_id=document.id, knowledge_base_id=document.knowledge_base_id,
                      position=i, content=piece, embedding=vector)
                for i, (piece, vector) in enumerate(zip(pieces, vectors, strict=True))
            )
            kb = await db.get(KnowledgeBase, document.knowledge_base_id)
            tokens = sum(len(p) for p in pieces) * 2 // 7  # ~3.5 chars per token
            db.add(UsageEvent(user_id=kb.user_id if kb else None, kind="embedding",
                              model_slug=settings.embedding_model, prompt_tokens=tokens,
                              cost_usd=_embedding_cost(tokens)))
            document.chunks_count = len(pieces)
            document.status = "ready"
        except Exception as error:  # surface any failure on the document, never crash the worker
            log.exception("ingest failed for document %s", document_id)
            document.status = "failed"
            document.error = str(error)[:300] if isinstance(error, ValueError) else "Не удалось обработать файл."
        await db.commit()


async def search(db: AsyncSession, knowledge_base_id: int, query: str, k: int | None = None) -> list[Source]:
    [vector] = await embed([query])
    distance = Chunk.embedding.cosine_distance(vector)
    rows = (await db.execute(
        select(Chunk.document_id, Document.filename, Chunk.content, distance.label("distance"))
        .join(Document, Document.id == Chunk.document_id)
        .where(Chunk.knowledge_base_id == knowledge_base_id)
        .order_by(distance)
        .limit(k or settings.rag_top_k)
    )).all()
    # Drop near-orthogonal hits so unrelated questions don't get padded with noise.
    return [Source(r.document_id, r.filename, r.content, round(1 - r.distance, 3))
            for r in rows if r.distance < 0.92]
