import math
from types import SimpleNamespace

from app.services import billing, context, rag
from app.services.embeddings import _hashed_embedding
from app.services.llm import Usage
from app.services.llm.base import merge_roles


def test_chunk_text_respects_size_and_keeps_all_text():
    text = "\n\n".join(f"Абзац {i}. " + "слово " * 60 for i in range(20))
    chunks = rag.chunk_text(text)
    assert len(chunks) > 1
    assert all(len(c) <= rag.CHUNK_CHARS + rag.OVERLAP_CHARS + 2 for c in chunks)
    assert all(f"Абзац {i}." in "".join(chunks) for i in range(20))


def test_chunk_text_splits_giant_paragraph():
    chunks = rag.chunk_text("Предложение. " * 500)
    assert len(chunks) >= 4


def test_fit_history_keeps_newest_within_budget():
    messages = [SimpleNamespace(content="x" * 350, role="user") for _ in range(10)]  # ~100 tokens each
    kept = context.fit_history(messages, budget=320)
    assert kept == messages[-3:]


def test_fit_history_always_keeps_last_message():
    huge = SimpleNamespace(content="x" * 100_000, role="user")
    assert context.fit_history([huge], budget=10) == [huge]


def test_usage_cost_is_per_million_and_has_minimum():
    model = SimpleNamespace(input_price=150, output_price=600, cost_input_usd=0.4, cost_output_usd=1.6)
    assert billing.usage_cost(model, Usage(1_000_000, 500_000)) == 450
    assert billing.usage_cost(model, Usage(10, 5)) == 1
    assert billing.provider_cost_usd(model, Usage(1_000_000, 1_000_000)) == 2.0


def test_estimates_price_scenarios_and_recommend_package():
    from app.services import estimates

    mk = lambda slug, i, o: SimpleNamespace(slug=slug, title=slug, input_price=i, output_price=o)  # noqa: E731
    models = {m.slug: m for m in (mk("gpt-6-luna", 40, 200), mk("gpt-5.6-terra", 750, 4500))}
    packages = [SimpleNamespace(slug=s, tokens=t, bonus_percent=0, price_kopeks=t * 100)
                for s, t in (("start", 500), ("big", 100_000))]
    result = estimates.build(models, models["gpt-6-luna"], packages)
    trial = result["scenarios"][0]
    assert trial["sparks"] == sum(i["sparks"] for i in trial["items"])
    assert trial["package"] == "start"
    assert result["scenarios"][-1]["sparks"] > trial["sparks"]


def test_merge_roles_alternates_and_starts_with_user():
    merged = merge_roles([{"role": "assistant", "content": "hi"}, {"role": "user", "content": "a"},
                          {"role": "user", "content": "b"}, {"role": "assistant", "content": "c"}])
    assert [m["role"] for m in merged] == ["user", "assistant"]
    assert merged[0]["content"] == "a\n\nb"


def dot(x: list[float], y: list[float]) -> float:
    return sum(i * j for i, j in zip(x, y, strict=True))


def test_hashed_embedding_is_normalized_and_similar_for_overlap():
    a, b, c = (_hashed_embedding(t) for t in ("тариф про цена", "цена тарифа про", "погода в лондоне"))
    assert math.isclose(dot(a, a), 1.0, rel_tol=1e-6)
    assert dot(a, b) > dot(a, c)


def test_build_system_includes_sources_and_summary():
    src = rag.Source(1, "doc.md", "фрагмент", 0.9)
    system = context.build_system(None, None, "раньше обсуждали X", [src])
    assert "[1] (doc.md)" in system and "раньше обсуждали X" in system


def test_custom_topup_follows_bonus_ladder():
    assert billing.custom_sparks(500) == 500
    assert billing.custom_sparks(1_000) == 1_100
    assert billing.custom_sparks(3_000) == 3_450
    assert billing.custom_sparks(30_000) == 39_000


def test_promo_bonus_only_for_topup_codes():
    from app.services.growth import normalize, promo_bonus

    assert promo_bonus(SimpleNamespace(kind="topup", value=20), 2200) == 440
    assert promo_bonus(SimpleNamespace(kind="gift", value=100), 2200) == 0
    assert promo_bonus(None, 2200) == 0
    assert normalize("  plus20 ") == "PLUS20"
