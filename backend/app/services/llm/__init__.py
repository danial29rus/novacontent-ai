from functools import cache

from app.core.config import settings
from app.services.llm.base import LLMProvider, ProviderError, Usage, estimate_tokens
from app.services.llm.dev_provider import DevProvider


@cache
def get_provider(name: str) -> LLMProvider:
    if name == "openai" and settings.openai_api_key:
        from app.services.llm.openai_provider import OpenAIProvider

        return OpenAIProvider(settings.openai_api_key, settings.openai_base_url or None)
    if name == "anthropic" and settings.anthropic_api_key:
        from app.services.llm.anthropic_provider import AnthropicProvider

        return AnthropicProvider(settings.anthropic_api_key)
    if settings.is_production:
        return DisabledProvider(name)
    return DevProvider()


class DisabledProvider:
    """Production without a key: fail cleanly (no charge) instead of serving placeholder answers."""

    def __init__(self, name: str) -> None:
        self.name = name

    async def stream(self, *args, **kwargs):
        raise ProviderError(f"provider {self.name} is not configured")
        yield  # pragma: no cover - makes this an async generator


async def complete(provider: str, model: str, system: str, messages: list[dict[str, str]],
                   temperature: float = 0.7, max_tokens: int = 2048) -> tuple[str, Usage]:
    """Non-streaming helper built on the stream interface."""
    text, usage = "", Usage(0, 0)
    async for event in get_provider(provider).stream(model, system, messages, temperature, max_tokens):
        if isinstance(event, Usage):
            usage = event
        else:
            text += event
    return text.strip(), usage


__all__ = ["ProviderError", "Usage", "complete", "estimate_tokens", "get_provider"]
