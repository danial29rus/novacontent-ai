import hashlib
import math
import re

from app.core.config import settings

_WORD = re.compile(r"\w+", re.UNICODE)


def _hashed_embedding(text: str) -> list[float]:
    """Offline fallback: hashed bag of words + character trigrams.

    Good enough for keyword-ish retrieval in development; swap for a real model in production.
    """
    dim = settings.embedding_dim
    vec = [0.0] * dim
    words = [w.lower() for w in _WORD.findall(text)]
    features = words + [w[i:i + 3] for w in words if len(w) > 3 for i in range(len(w) - 2)]
    for feature in features:
        h = int.from_bytes(hashlib.blake2b(feature.encode(), digest_size=8).digest(), "big")
        vec[h % dim] += 1.0 if (h >> 32) & 1 else -1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


async def embed(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    if settings.openai_api_key:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url or None)
        result: list[list[float]] = []
        for start in range(0, len(texts), 96):
            response = await client.embeddings.create(
                model=settings.embedding_model,
                input=texts[start:start + 96],
                dimensions=settings.embedding_dim,
            )
            result.extend(item.embedding for item in response.data)
        return result
    return [_hashed_embedding(t) for t in texts]
