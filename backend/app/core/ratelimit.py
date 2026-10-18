import time
from collections import defaultdict
from threading import Lock

from redis.asyncio import Redis

from app.core.config import settings

_redis: Redis | None = Redis.from_url(settings.redis_url) if settings.redis_url else None
_local: dict[str, list[float]] = defaultdict(list)
_lock = Lock()


async def allow(identity: str, limit: int | None = None, window: int = 60) -> bool:
    """Fixed-window limiter in Redis; falls back to process memory if Redis is unreachable."""
    limit = limit or settings.rate_limit_per_minute
    if _redis is not None:
        key = f"rl:{identity}:{int(time.time()) // window}"
        try:
            count = await _redis.incr(key)
            if count == 1:
                await _redis.expire(key, window)
            return count <= limit
        except Exception:
            pass
    now = time.time()
    with _lock:
        events = [t for t in _local[identity] if now - t < window]
        allowed = len(events) < limit
        if allowed:
            events.append(now)
        _local[identity] = events
    return allowed
