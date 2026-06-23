# SPAD v2 — Backend

FastAPI + SQLAlchemy + Alembic + PostgreSQL. See `/SPAD-v2-Migration-Plan.docx`
at the repo root for the full phased plan this implements.

## Phase status

- [x] **Phase 0** — repo scaffold, Docker Compose for local Postgres
- [x] **Phase 1.1–1.3** — schema (12 tables), Alembic migrations, seed script
- [x] **Phase 1.4–1.5** — Firebase Auth + RBAC middleware (dev-mode fallback included)
- [x] **Phase 2** — grading engine port, submission/verification pipeline, audit logging
- [x] **Phase 3** — relative grading engine (z-scores, rank, percentile), portal freeze, analytics
- [x] **Phase 4** — frontend (React 19 + Vite + Tailwind v4)
- [x] **Phase 5** — security hardening, GitHub Actions CI, deployment configuration

## One-time setup

```bash
# From the repo root: start local Postgres (Docker)
docker compose up -d

# From backend/:
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env             # defaults already match docker-compose.yml
```

## Authentication

The API has two auth modes, controlled by `FIREBASE_ENABLED` in `.env`:

**Dev mode (default, `FIREBASE_ENABLED=false`)** — no Firebase project
required. Authenticate as any seeded user by sending their email in a
header:

```bash
curl -H "X-Dev-User-Email: admin@spad.local" http://localhost:8000/me
curl -H "X-Dev-User-Email: student001@demo.local" http://localhost:8000/me
```

This exists so the submission/verification/grading routes (Phase 2+) can
be built and tested against real RBAC logic before a Firebase project
exists. It is hard-blocked from running with `APP_ENV=production` — the
app raises at startup if you try.

**Real mode (`FIREBASE_ENABLED=true`)** — once you've created a Firebase
project and set `FIREBASE_CREDENTIALS_PATH` or `FIREBASE_CREDENTIALS_JSON`
(see `.env.example`), the same routes authenticate via a real
`Authorization: Bearer <firebase-id-token>` header instead. First sign-in
auto-provisions a local `users` row with `role=student` — nobody can
self-promote to admin; that happens through admin-only user-management
routes (Phase 3+).

Try the RBAC guard:

```bash
curl -H "X-Dev-User-Email: admin@spad.local" http://localhost:8000/admin/ping     # 200
curl -H "X-Dev-User-Email: student001@demo.local" http://localhost:8000/admin/ping  # 403
curl http://localhost:8000/admin/ping                                              # 401
```

## Submission & verification pipeline

State machine: `DRAFT → SUBMITTED → PENDING_VERIFICATION → APPROVED → PUBLISHED`
(or `→ REJECTED → resubmit → SUBMITTED`). Only `APPROVED`/`PUBLISHED`
submissions count toward grading — see `app/services/grading.py`.

```bash
# Student creates a submission
curl -X POST http://localhost:8000/submissions \
  -H "X-Dev-User-Email: student001@demo.local" -H "Content-Type: application/json" \
  -d '{"assessment_id": "<uuid>", "score": 25}'

# Duplicate attempt -> 409, not a raw DB error
curl -X POST http://localhost:8000/submissions \
  -H "X-Dev-User-Email: student001@demo.local" -H "Content-Type: application/json" \
  -d '{"assessment_id": "<same uuid>", "score": 28}'

# Send for verification
curl -X POST http://localhost:8000/submissions/<id>/submit-for-verification \
  -H "X-Dev-User-Email: student001@demo.local"

# Admin reviews the queue and approves/rejects
curl -H "X-Dev-User-Email: admin@spad.local" http://localhost:8000/admin/verification-queue
curl -X POST http://localhost:8000/admin/verification-requests/<id>/approve \
  -H "X-Dev-User-Email: admin@spad.local" -H "Content-Type: application/json" -d '{"notes": "ok"}'
```

Every transition is recorded in `audit_logs` with before/after values —
query it directly to see the full history of any submission.

## Grading engine

`app/services/grading.py` is a direct, behavior-preserving port of
legacy-v1's `evaluatePlan`/`calculateBestOf`/etc — cross-validated against
the real v1 JavaScript (via Node) during development, down to exact
floating-point output. It's pure functions with no DB/FastAPI dependency,
so it's reused as-is by the relative grading engine in Phase 3. See the
module docstring for what's preserved vs. intentionally adapted (e.g.
only `APPROVED` submissions count, which is how the verification pipeline
above actually affects a student's grade).

## Relative grading & analytics

```bash
# 1. Freeze the trimester (stops new submissions; doesn't compute anything yet)
curl -X POST http://localhost:8000/admin/semesters/1/freeze \
  -H "X-Dev-User-Email: admin@spad.local" -H "Content-Type: application/json" \
  -d '{"is_frozen": true}'

# 2. Recompute one course: runs the grading engine per student, then z-score/
#    rank/percentile across the whole cohort, and upserts the results
curl -X POST http://localhost:8000/admin/courses/<course_id>/recompute \
  -H "X-Dev-User-Email: admin@spad.local"

# 3. View aggregate analytics (any authenticated user -- no student identities)
curl http://localhost:8000/courses/<course_id>/analytics -H "X-Dev-User-Email: student001@demo.local"

# 4. A student checks their own result (rank/percentile/grade, not classmates')
curl http://localhost:8000/courses/<course_id>/my-result -H "X-Dev-User-Email: student001@demo.local"

# 5. An admin views the full roster (identities + exact scores + rank)
curl http://localhost:8000/admin/courses/<course_id>/analytics -H "X-Dev-User-Email: admin@spad.local"
```

**Privacy split, by design:** `GET /courses/{id}/analytics` returns only
aggregate statistics (mean/median/stdev/histogram/grade distribution) —
nothing that identifies an individual student. The full per-student
roster (`student_id`, exact score, rank) is only available via the
admin-only `GET /admin/courses/{id}/analytics`. Students get their own
row through the separate `GET /courses/{id}/my-result`, which doesn't
include `student_id` at all since it's implicitly "you."

**Statistical choices worth knowing about** (documented in depth in
`app/services/relative_grading.py`'s module docstring):
- **Population standard deviation** (÷N), not sample (÷N-1) — the class
  being graded IS the full population, not a sample.
- **Standard competition ranking** for ties (1, 1, 3, 4, 4, 6 — not
  1, 1, 2, 3, 3, 4) — nobody is shorted a rank position by someone else's tie.
- **Zero-variance cohorts** (everyone scores identically) are explicitly
  flagged rather than silently producing a misleading z-score of 0 with
  no indication that no real statistical comparison was possible.

Only `APPROVED`/`PUBLISHED` submissions feed into a recompute — a student
with submissions still pending verification is excluded from that
course's cohort entirely (not counted as having scored 0%), until at
least one of their submissions is approved.

## Deploying to Render + Neon

1. Create a Neon Postgres database at [neon.tech](https://neon.tech) — copy
   the connection string from the dashboard.
2. Create a Firebase project, generate a service account key (JSON), and
   base64-encode it: `cat key.json | base64 -w0`
3. In the Render dashboard, create a Web Service connected to this repo.
4. Set these environment variables (from the Render dashboard, not committed):
   - `DATABASE_URL` — Neon connection string
   - `FIREBASE_CREDENTIALS_JSON` — base64-encoded service account key
   - `FIREBASE_PROJECT_ID` — your Firebase project ID
   - `CORS_ORIGINS` — your Vercel/frontend URL
5. Push to `main` — `render.yaml` at the repo root configures the rest.

`render.yaml` runs `alembic upgrade head` before starting Uvicorn, so
migrations apply automatically on every deploy.

## Everyday workflow

```bash
# Apply all migrations (creates/updates every table)
alembic upgrade head

# Load legacy-v1 course/assessment data + a 25-student synthetic cohort
python -m app.seed.run

# Run the API with auto-reload
uvicorn app.main:app --reload --port 8000
# -> http://localhost:8000/docs for interactive API docs
# -> http://localhost:8000/health to confirm DB connectivity
```

## Running tests

Tests run against the same local Postgres database as development. Each
test runs inside a transaction that's rolled back at teardown, so the
seeded demo data is never touched and tests never need their own DB.

```bash
python -m pytest tests/ -v
```

## Database schema changes

This project uses Alembic autogenerate, but **always read the generated
migration before applying it** — autogenerate can miss things (renamed
columns look like a drop + add, for example) and won't ever generate
`DROP TYPE` statements for Postgres enums in `downgrade()` by default
(see the first migration for the pattern to copy if you add new enums).

```bash
# 1. Edit/add a model in app/models/
# 2. Make sure it's imported in app/models/__init__.py
# 3. Generate the migration
alembic revision --autogenerate -m "describe the change"
# 4. Read the generated file in alembic/versions/
# 5. Apply it
alembic upgrade head
```

## Local Postgres admin UI

`docker compose up -d` also starts Adminer at http://localhost:8081.
Server: `db`, username: `spad`, password: `spad_dev_password`, database: `spad_dev`.

## Resetting your local database

```bash
docker compose down -v   # wipes the named volume entirely
docker compose up -d
alembic upgrade head
python -m app.seed.run
```

## Why a 25-student synthetic cohort?

Z-score relative grading is statistically meaningless on 2–3 real demo
students — standard deviation on a tiny sample doesn't produce a
believable bell curve (see the migration plan's Risk table). The seed
script creates a synthetic cohort (`email LIKE '%@demo.local'`,
`roll_number LIKE 'DSAI-SYN-%'`) so Phase 3's analytics have a real
distribution to compute against. It deliberately does **not** fabricate
`student_results` rows — those are generated by the actual grading engine
once Phase 2/3 land, not hand-rolled here.
