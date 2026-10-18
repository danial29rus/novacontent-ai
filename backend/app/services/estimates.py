"""'How many sparks do I need?' — scenarios priced from live model and service prices."""

from app.models import AIModel, TopupPackage
from app.services.billing import package_tokens, usage_cost
from app.services.catalog import BY_SLUG
from app.services.llm import Usage

# A typical chat turn: history + system prompt in, a medium answer out.
TYPICAL_TURN = Usage(2_500, 700)
RAG_TURN = Usage(4_500, 700)


def per_message(model: AIModel, rag: bool = False) -> int:
    return usage_cost(model, RAG_TURN if rag else TYPICAL_TURN)


def build(models: dict[str, AIModel], default: AIModel, packages: list[TopupPackage]) -> dict:
    fast = models.get("gpt-6-luna", default)
    smart = models.get("gpt-5.6-terra", default)
    agent_model = fast

    def svc(slug: str, times: int = 1) -> tuple[str, int]:
        s = BY_SLUG[slug]
        return (f"{s.title}{f' × {times}' if times > 1 else ''}", s.price * times)

    def chat(model: AIModel, n: int, rag: bool = False) -> tuple[str, int]:
        return (f"{n} сообщений в чате · {model.title}{' + база знаний' if rag else ''}", per_message(model, rag) * n)

    scenarios = [
        ("🧪", "Попробовать платформу", "Пара диалогов и одна услуга — понять, как всё работает.",
         [chat(fast, 30), svc("naming")]),
        ("📱", "Контент на месяц · 1 бренд", "Стратегия, 30 постов, видео и доработка в чате.",
         [svc("content-plan-month"), svc("content-factory", 3), svc("reels-pack"), chat(smart, 40)]),
        ("🚀", "Запуск продукта", "От позиционирования до рекламы и писем.",
         [svc("brand-pack"), svc("competitor-analysis"), svc("landing-copy"), svc("email-chain"),
          svc("ads-pack"), chat(smart, 60)]),
        ("🤖", "AI-агент для бизнеса · месяц", "Агент отвечает клиентам по вашей базе знаний.",
         [svc("agent-builder"), chat(agent_model, 600, rag=True)]),
        ("🏢", "Агентство · 5 клиентов в месяц", "Полный контент-цикл для пяти брендов.",
         [svc("content-plan-month", 5), svc("content-factory", 15), svc("reels-pack", 5), chat(smart, 200)]),
    ]

    active = sorted(packages, key=lambda p: p.price_kopeks)

    def recommend(total: int) -> str | None:
        for p in active:
            if package_tokens(p) >= total:
                return p.slug
        return active[-1].slug if active else None

    return {
        "scenarios": [
            {"emoji": e, "title": t, "description": d, "sparks": sum(c for _, c in items),
             "items": [{"label": label, "sparks": cost} for label, cost in items],
             "package": recommend(sum(c for _, c in items))}
            for e, t, d, items in scenarios
        ],
        "per_message": [{"model": m.title, "slug": m.slug, "sparks": per_message(m),
                         "sparks_rag": per_message(m, rag=True)} for m in models.values()],
        "services": [{"title": s.title, "emoji": s.emoji, "sparks": s.price} for s in BY_SLUG.values()],
    }
