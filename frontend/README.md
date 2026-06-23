# SPAD v2 — Frontend

React 19 + TypeScript + Vite + Tailwind CSS v4. See `/SPAD-v2-Migration-Plan.docx`
at the repo root for the full phased plan.

## Phase status

- [x] **Phase 4 (current)** — React app shell, auth, routing, all core pages

## One-time setup

```bash
# From frontend/:
npm install
cp .env.example .env.local   # defaults are fine for local dev
```

The Vite dev server proxies `/api` to `http://localhost:8000` — make sure
the backend is running first (see backend/README.md).

## Everyday workflow

```bash
# Terminal 1: start the backend
cd ../backend && uvicorn app.main:app --reload --port 8000

# Terminal 2: start the frontend
npm run dev
# -> http://localhost:5173
```

Sign in using the dev sign-in screen (choose any seeded user) since
`VITE_FIREBASE_ENABLED=false` by default. Admin: `admin@spad.local`.
Students: `student001-025@demo.local`.

## Pages

| Route | Access | What it does |
|---|---|---|
| `/` | All | Dashboard: submission summary (student) or queue preview (admin) |
| `/grade-lab` | Student | Submit scores for each assessment, send for verification |
| `/analytics` | All | Bell curve, grade distribution, my result / full roster |
| `/admin/verification` | Admin | Review and approve or reject student submissions |

## Auth modes

Dev mode (default, VITE_FIREBASE_ENABLED=false): pick any seeded user
from the sign-in screen. Real mode: set VITE_FIREBASE_ENABLED=true once
a Firebase project is configured.

## Build

```bash
npm run build       # TypeScript check + Vite production build
npm run preview     # Serve dist/ to test the production build
```
