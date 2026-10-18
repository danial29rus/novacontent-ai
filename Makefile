.PHONY: up down logs test lint check smoke backup deploy revision dev-api dev-web

up:            ## Build and start the stack (local: http://localhost:8080)
	docker compose up -d --build

down:          ## Stop containers (data is kept; never add -v)
	docker compose down

logs:
	./scripts/logs.sh api web caddy

test:
	cd backend && .venv/bin/pytest -q

lint:
	cd backend && .venv/bin/ruff check app tests migrations
	cd frontend && npx tsc -b

check: lint test  ## Everything that must pass before a deploy
	cd frontend && npx vite build >/dev/null && echo "frontend build ok"

smoke:         ## make smoke URL=https://24nova-ai.ru
	./scripts/smoke.sh $(or $(URL),http://localhost:8080)

backup:
	./scripts/backup.sh

deploy:        ## make deploy SERVER=root@1.2.3.4
	./scripts/deploy.sh $(SERVER)

revision:      ## make revision m="add something"
	cd backend && .venv/bin/alembic revision --autogenerate -m "$(m)"

dev-api:       ## Local API with hot reload (needs: docker compose up -d db redis)
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

dev-web:       ## Vite dev server on :5173 proxying /api to :8000
	cd frontend && npm run dev
