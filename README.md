# Nova AI

AI-платформа: чаты с GPT и Claude, свои агенты, база знаний (RAG), контент-паки и Студия, токенный баланс с пополнением, админка.

## Быстрый старт (локально)

```bash
cp .env.example .env      # затем: ENVIRONMENT=development, COOKIE_SECURE=false, SITE_ADDRESS=http://localhost,
                          #        PUBLIC_URL=http://localhost:8080, HTTP_PORT=8080, PAYMENT_PROVIDER=mock
make up
open http://localhost:8080
make check                # линтер, типы, тесты, сборка фронта
make smoke                # 17 сквозных проверок работающего стека
```

Без `OPENAI_API_KEY` в разработке отвечает помеченный dev-провайдер, в продакшене — честная ошибка без списания.

## Деплой

Продакшен на Timeweb Cloud: [DEPLOY.md](DEPLOY.md) (сервер, домен 24nova-ai.ru, почта support@24nova-ai.ru, HTTPS, ЮKassa, бэкапы).

## Архитектура

```
nginx (web) ──/api──▶ FastAPI (api) ──▶ Postgres 16 + pgvector
   │ SPA                     │      └──▶ Redis (rate limit)
   ▼                         ├──▶ OpenAI   (чат + эмбеддинги)
React + Vite                 └──▶ Anthropic (чат)
```

```
backend/
  app/
    core/        config (env), security (пароли/токены), ratelimit
    db/          движок, сессии, Base
    models/      user, billing (модели, леджер, пакеты, платежи), chat (агенты, чаты, сообщения),
                 knowledge (базы, документы, чанки с vector), project (проекты, паки, генерации)
    schemas/     Pydantic in/out
    services/
      llm/       единый stream-интерфейс: openai, anthropic, dev
      context.py системный промпт + память бренда + источники + бюджет истории + скользящее саммари
      rag.py     извлечение текста (PDF/MD/TXT…), чанкинг, индексация, векторный поиск
      billing.py атомарные списания/начисления с леджером, пополнения (mock / ЮKassa)
      seed.py    модели, пакеты, контент-паки, встроенные агенты, первый админ
    api/v1/      auth, billing, chats (SSE), agents, knowledge, projects+studio, admin
  migrations/    Alembic (0001_initial — схема + pgvector + HNSW-индекс)
  tests/
frontend/
  src/
    lib/         api-клиент + SSE-парсер, типы, форматтеры
    components/  ui-кит, layout (сайдбар/drawer/таб-бар), chat (markdown, composer, model picker)
    pages/       Landing, Auth, app/* (Home, Chat, Agents, Knowledge, Projects, Studio, Library,
                 Billing, Profile), admin/Admin
legacy/          прежний MVP (server.py + статичный фронт), для справки
```

### Как устроен чат

`POST /api/v1/chats/{id}/messages` отдаёт Server-Sent Events: `meta` (модель, найденные источники) → `delta`… → `done` (сообщение, новый баланс) или `error`.

1. Если к чату или агенту подключена база знаний, ищутся top-k фрагментов (cosine, HNSW) и передаются модели с нумерацией `[n]`.
2. История упаковывается с конца в бюджет `CONTEXT_BUDGET_TOKENS`. Когда несжатых сообщений больше `SUMMARY_TRIGGER_MESSAGES`, старшая половина в фоне сворачивается в `chat.summary`, и этот конспект дальше идёт в системный промпт.
3. Списание идёт по фактическому usage провайдера: `ceil(prompt × input_price + completion × output_price)`. Цены задаются для каждой модели в админке. Ответ сохраняется и оплачивается, даже если клиент оборвал соединение. При ошибке провайдера токены не списываются.

### Искры ✦, услуги и затраты

- **Искры ✦** — внутренняя валюта, 1 ✦ ≈ 1 ₽. Цены моделей задаются в ✦ за 1M токенов провайдера (`ai_models.input/output_price`), каждый ответ стоит минимум 1 ✦. Новый пользователь получает `WELCOME_TOKENS` ✦.
- **Пополнение:** шесть пакетов от 500 ₽ до 25 000 ₽ с бонусом до +30%. Есть и «своя сумма» от 500 ₽: бонус считается по той же лестнице (`billing.BONUS_LADDER`), а `GET /billing/custom-quote` показывает расчёт до оплаты.
- **Услуги** (`services/catalog.py`) — пошаговые мастера с фиксированной ценой: конструктор AI-агента (сам создаёт агента), контент-завод, контент-план на месяц, Reels, лендинг, email, SEO, упаковка бренда, конкуренты, нейминг, отзывы, реклама. Новая услуга добавляется одной записью в каталоге.
- **Оценки** (`GET /billing/estimates`) — «сколько ✦ нужно» под типовые сценарии. Считаются от живых цен и рекомендуют подходящий пакет.
- **Затраты:** каждый вызов провайдера пишется в `usage_events` с реальной себестоимостью (`ai_models.cost_*_usd`, `EMBEDDING_COST_USD`). Это касается и бесплатных для пользователя вызовов — сжатия памяти и индексации RAG. В админке вкладка «Затраты»: себестоимость, выручка, маржа и наценка по дням, типам задач, моделям и пользователям. Курс задаётся в `USD_RUB`.
- **ЮKassa:** `PAYMENT_PROVIDER=mock` зачисляет сразу. `yookassa` создаёт платёж с редиректом, а вебхук перепроверяет статус через API и телу запроса не доверяет.

## Разработка

```bash
docker compose up -d db redis
cd backend && python3.12 -m venv .venv && .venv/bin/pip install -e ".[dev]"
DATABASE_URL=postgresql+asyncpg://nova:nova@localhost:5432/nova .venv/bin/alembic upgrade head
make dev-api      # :8000, hot reload
make dev-web      # :5173, проксирует /api на :8000
make test lint
make revision m="add field"   # автогенерация миграции
```

Для локальной разработки пробросьте порт Postgres (`ports: ["5432:5432"]` у сервиса `db`).

## Перед продом

- `ENVIRONMENT=production`, `COOKIE_SECURE=true`, HTTPS перед nginx, сильный `POSTGRES_PASSWORD`;
- реальные ключи провайдеров и проверка `provider_model` в админке;
- при смене `EMBEDDING_MODEL` на модель другой размерности нужна новая миграция и переиндексация. С hashed-эмбеддингов (без ключа) на OpenAI тоже стоит переиндексировать документы;
- ЮKassa: `PAYMENT_PROVIDER=yookassa`, shop id / secret, URL вебхука в личном кабинете, оферта и возвраты;
- бэкапы Postgres и мониторинг (`/api/health`).
