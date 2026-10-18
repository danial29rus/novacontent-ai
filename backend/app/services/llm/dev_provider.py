import asyncio
from collections.abc import AsyncIterator

from app.services.llm.base import StreamEvent, Usage, estimate_tokens


class DevProvider:
    """Answers locally when no provider key is configured, so the whole flow is testable offline."""

    name = "dev"

    async def stream(
        self,
        model: str,
        system: str,
        messages: list[dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> AsyncIterator[StreamEvent]:
        question = messages[-1]["content"] if messages else ""
        has_sources = "<sources>" in system
        answer = (
            f"**Dev-режим** · модель `{model}` не подключена (нет API-ключа на сервере).\n\n"
            f"Вы спросили: _{question[:300]}_\n\n"
            f"- сообщений в контексте: **{len(messages)}**\n"
            f"- найдены фрагменты из базы знаний: **{'да' if has_sources else 'нет'}**\n\n"
            "Добавьте `OPENAI_API_KEY` или `ANTHROPIC_API_KEY` в `.env`, чтобы получить настоящий ответ."
        )
        for word in answer.split(" "):
            await asyncio.sleep(0.015)
            yield word + " "
        prompt = system + "".join(m["content"] for m in messages)
        yield Usage(estimate_tokens(prompt), estimate_tokens(answer))
