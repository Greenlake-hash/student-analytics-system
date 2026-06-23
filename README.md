# Student Performance Analytics Dashboard — v2

A relative-grading academic analytics platform, rebuilt from a local-first
static dashboard (`legacy-v1/`) into a real client/server application.

**Start here:** `SPAD-v2-Migration-Plan.docx` — the full phased build plan,
scope decisions, and architecture rationale.

## Repo layout

```
spad-v2/
├── backend/          FastAPI + SQLAlchemy + Alembic + Postgres (see backend/README.md)
├── frontend/          React + TS + Vite (scaffolded in Phase 4)
├── legacy-v1/          Archived original static app, kept for reference and
│                       resume continuity — NOT part of the running v2 app
├── docker-compose.yml  Local Postgres + Adminer for development
└── .gitignore
```

## Current status: All phases complete

83 backend tests · Clean TypeScript build · Security hardened · CI configured

**The full-stack application is built, tested, and deployment-ready.**

| Layer | Stack | Status |
|---|---|---|
| Database | PostgreSQL 16 on Neon | Schema versioned via Alembic |
| Backend | FastAPI + SQLAlchemy | 83 tests, rate-limited, security headers |
| Frontend | React 19 + TypeScript + Vite + Tailwind v4 | Clean build, 4 pages |
| Auth | Firebase (real) / dev-mode fallback | RBAC: student + admin roles |
| CI | GitHub Actions | Runs on push to main/develop |

## Quick start (local)

```bash
# Terminal 1 — backend
docker compose up -d              # or: service postgresql start
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
python -m app.seed.run
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
npm install
npm run dev                       # → http://localhost:5173
```

Sign in as `admin@spad.local` or any `student001–025@demo.local` on the
dev sign-in screen.

## Deploy to production

**Backend (Render):** set `DATABASE_URL`, `FIREBASE_CREDENTIALS_JSON`,
`FIREBASE_PROJECT_ID`, `CORS_ORIGINS` in the Render dashboard, then push
to main — `render.yaml` handles the rest.

**Frontend (Vercel):** update `VITE_API_BASE_URL` in `vercel.json` to
point at your Render URL, connect the repo in the Vercel dashboard, deploy.

See `ARCHITECTURE.md` for the *why* behind each design decision — the
document specifically written for portfolio reviewers.

## Quick start

```bash
docker compose up -d                  # local Postgres + Adminer
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
python -m app.seed.run
uvicorn app.main:app --reload --port 8000
```

Then visit `http://localhost:8000/docs`.
