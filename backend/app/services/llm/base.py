from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol


@dataclass
class Usage:
    prompt_tokens: int
    completion_tokens: int


# A stream yields text deltas and ends with exactly one Usage.
StreamEvent = str | Usage


class ProviderError(RuntimeError):
    pass


class LLMProvider(Protocol):
    name: str

    def stream(
        self,
        model: str,
        system: str,
        messages: list[dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> AsyncIterator[StreamEvent]: ...


def estimate_tokens(text: str) -> int:
    # ~3.5 chars per token is close enough for Russian/English mixes and budget math.
    return max(1, int(len(text) / 3.5))


def merge_roles(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    """Collapse consecutive same-role turns; Anthropic requires strict alternation."""
    merged: list[dict[str, str]] = []
    for m in messages:
        if merged and merged[-1]["role"] == m["role"]:
            merged[-1] = {"role": m["role"], "content": merged[-1]["content"] + "\n\n" + m["content"]}
        else:
            merged.append(dict(m))
    while merged and merged[0]["role"] != "user":
        merged.pop(0)
    return merged
