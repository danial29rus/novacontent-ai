from collections.abc import AsyncIterator

from anthropic import AnthropicError, AsyncAnthropic

from app.services.llm.base import ProviderError, StreamEvent, Usage, merge_roles


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str) -> None:
        self.client = AsyncAnthropic(api_key=api_key, timeout=90)

    async def stream(
        self,
        model: str,
        system: str,
        messages: list[dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> AsyncIterator[StreamEvent]:
        try:
            async with self.client.messages.stream(
                model=model,
                system=system,
                messages=merge_roles(messages),
                temperature=temperature,
                max_tokens=max_tokens,
            ) as stream:
                async for text in stream.text_stream:
                    yield text
                final = await stream.get_final_message()
        except AnthropicError as error:
            raise ProviderError(str(error)) from error
        yield Usage(final.usage.input_tokens, final.usage.output_tokens)
