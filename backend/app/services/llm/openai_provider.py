from collections.abc import AsyncIterator

from openai import AsyncOpenAI, OpenAIError

from app.services.llm.base import ProviderError, StreamEvent, Usage, estimate_tokens


def _is_reasoning(model: str) -> bool:
    # Reasoning models reject a custom temperature.
    return model.startswith(("o1", "o3", "o4", "gpt-5", "gpt-6"))


class OpenAIProvider:
    name = "openai"

    def __init__(self, api_key: str, base_url: str | None = None) -> None:
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=90)

    async def stream(
        self,
        model: str,
        system: str,
        messages: list[dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> AsyncIterator[StreamEvent]:
        params: dict = {
            "model": model,
            "messages": [{"role": "system", "content": system}, *messages],
            "max_completion_tokens": max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if not _is_reasoning(model):
            params["temperature"] = temperature
        usage: Usage | None = None
        text = ""
        try:
            stream = await self.client.chat.completions.create(**params)
            async for chunk in stream:
                if chunk.usage:
                    usage = Usage(chunk.usage.prompt_tokens, chunk.usage.completion_tokens)
                if chunk.choices and chunk.choices[0].delta.content:
                    delta = chunk.choices[0].delta.content
                    text += delta
                    yield delta
        except OpenAIError as error:
            raise ProviderError(str(error)) from error
        yield usage or Usage(
            estimate_tokens(system + "".join(m["content"] for m in messages)), estimate_tokens(text)
        )
