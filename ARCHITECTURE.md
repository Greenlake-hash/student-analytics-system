# Architecture — Student Performance Analytics Dashboard v2

This document explains the design decisions that shaped the v2 architecture —
not *what* was built (that's in the code and the migration plan), but *why*
each structural choice was made the way it was. It's written for a portfolio
reviewer who wants to understand the engineering judgment behind the project,
not just the technology stack.

---

## Starting point: what v1 was, and wasn't

The original application (archived in `legacy-v1/`) is a static, client-only
dashboard: HTML/CSS/vanilla JavaScript, JSON configuration files, LocalStorage
for persistence, no backend, no accounts. Its architecture is exactly right for
what it is — a single-developer tool that runs offline and deploys to GitHub
Pages with zero infrastructure.

The v2 prompt asked for relative grading, multi-user workflows, and verified
submissions. None of that is possible in a client-only architecture, because:
- Relative grading requires a cohort — you need all students' scores to compute
  a class mean, and you cannot trust client-submitted aggregates.
- Verification requires an identity system and a persistent, auditable record of
  who approved what, when, and what value changed.
- Duplicate prevention at the database level requires... a database.

So v2 is a genuine rebuild, not an extension. The grading *math* and the visual
*design language* carry over; the storage, auth, and rendering layers are replaced.

---

## Why these specific technology choices

### FastAPI over Django or Flask

FastAPI gives automatic OpenAPI documentation (visible at `/docs` while the
server is running), Pydantic request/response validation that doubles as
documentation, and async support without requiring the whole application to
be async. For a portfolio project where the API surface is substantial (15+
endpoints with non-trivial request shapes), auto-generated documentation is
the difference between a reviewer who can explore the API in 5 minutes and one
who has to read source code. Flask would require either flask-restx or hand-
written OpenAPI; Django would bring ORM coupling and views that don't naturally
fit a separate React frontend.

### SQLAlchemy + Alembic over Django ORM

The version-controlled migration chain is the key: `alembic/versions/` contains
a reproducible, reviewable history of every schema change, including the
deliberate `DROP TYPE` additions in `downgrade()` that prevent the common
Postgres enum-type orphan bug. Django migrations bundle schema and ORM together;
Alembic treats them separately, which matters here because the schema needed to
exist and be reviewed before the application code was written, not inferred
after.

### Firebase Auth over rolling JWT/bcrypt

The master prompt lists JWT, refresh tokens, and bcrypt as requirements. Firebase
Auth provides all of those, security-reviewed, for free. The *interesting*
engineering here is the RBAC layer and the audit trail — who can perform which
actions, and is there a permanent record — not the cryptographic plumbing of
token signing. Rolling bcrypt and manual JWT refresh token rotation would have
consumed a session that was better spent on the grading engine and the privacy
split in the analytics API.

The dev-auth fallback (`X-Dev-User-Email` header, active when
`FIREBASE_ENABLED=false`) was not a shortcut — it's what allowed Phases 2, 3,
and 4 to be built and fully tested before a Firebase project was created. The
same route code, the same RBAC guards, the same test suite runs against both
modes without modification.

### Neon + Render over a single PaaS like Railway or Heroku

Separating the database from the compute layer means the database survives a
backend redeploy, a provider switch, or a cold-start while the API server is
spinning up. Neon's serverless Postgres also has genuinely persistent free-tier
storage (as opposed to time-boxed trial credits), which matters for a portfolio
project that should still have a live URL six months from now.

---

## The three design decisions I'd explain to any reviewer

### 1. The grading engine is a pure module with no I/O

`app/services/grading.py` and `app/services/relative_grading.py` are pure
functions: plain Python data structures in, plain Python data structures out,
no database calls, no FastAPI imports. This mirrors the original v1 JavaScript
(`evaluatePlan`, `calculateBestOf`) and was done deliberately for two reasons:

**Testability.** The cross-validation in `tests/test_grading.py` feeds the
same inputs to the Python port and to the real v1 JavaScript (via Node) and
diffs the output — right down to the floating-point representation
(`70.60000000000001`, not `70.6`). That test would be impossible if the grading
functions made database calls. A grading engine that can't be independently
verified on known inputs is a liability in an academic system.

**Reusability.** The freeze orchestration service (`app/services/freeze.py`)
calls the grading engine to compute raw course percentages, then passes those
to the relative grading engine to compute cohort statistics. Both directions of
the pipeline reuse the same pure functions without any coupling to HTTP context.

### 2. Duplicate prevention is layered deliberately

The master prompt says "prevent duplicates at database level, API level, and
frontend level." These are not interchangeable — they serve different purposes:

| Layer | Purpose | Failure mode if only this layer |
|---|---|---|
| DB `UNIQUE(student_id, assessment_id)` | Actual guarantee | Covered by `tests/test_schema_guarantees.py` which inserts directly, bypassing all app code |
| API pre-check returning 409 | UX — gives the frontend an actionable error | Without it, a race condition between two requests gets a raw `IntegrityError` 500 |
| Frontend disable-on-existing | Removes the affordance | Can still be bypassed by a direct API call, so DB + API are still required |

The 409 response body says exactly what the master prompt specified: *"You already
submitted marks for this assessment"* with the options *Cancel* or *Request Update*
— this is the API signaling the UX flow to the frontend, not just an error code.

### 3. The analytics privacy split was a real design decision

The public `GET /courses/{id}/analytics` endpoint returns mean, median, stdev,
histogram, and grade distribution. The admin-only `GET /admin/courses/{id}/analytics`
adds the full per-student roster with identities and exact scores.

This split was a conscious design choice made mid-Phase 4 when I was about to
expose `student_id` + exact score to every authenticated user. Relative grading
is an inherently comparative system — students can see where they rank — but "you
are rank 11 of 25" is very different information from "student
`feddc9b3-44ef-4db2-95be-2eeb2f46c169` scored 70.3%." The first is meaningful
self-assessment; the second enables targeted social pressure about classmates'
performance that the system has no business facilitating.

The `GET /courses/{id}/my-result` endpoint gives a student their own row
(without even including their `student_id` in the response, since it's
implicitly "you") and blocks admins from hitting it via `require_role(STUDENT)`.

---

## What I'd do differently with more time

**Code splitting in the frontend.** The production bundle is ~690KB gzipped to
~208KB, driven mostly by Recharts and React Router. Dynamic imports on the
analytics page would halve the initial load.

**Semester-aware course enrollment.** Currently any student can submit scores
for any course in the catalog. A real system would have an enrollment table
(`student_id`, `course_id`, `semester_id`) and the assessment-submission form
would only show courses the student is actually enrolled in. I documented this
as a "v2.1+" item rather than building it now because the portfolio's value
is demonstrating the grading pipeline, not building a full enrollment system.

**A `course_statistics` cache invalidation strategy.** `recompute_course_results()`
is currently idempotent but has no TTL — calling it twice produces the same
result but at the cost of recomputing everything. For a real deployment with
hundreds of submissions, the right design is to track a `last_submission_approved_at`
timestamp and only recompute when it's newer than `course_statistics.computed_at`.

**The AI study coach.** The master prompt called for rule-based study
recommendations (no external AI APIs required). I scoped this out as "portfolio
value is concentrated in the grading pipeline" — but the right implementation
would be a service that flags assessments where z-score < -1.0, maps those
assessment types to topic coverage from `syllabus.json`, and generates a
targeted revision list. The data model already supports it; it's a service
function and a frontend card away.
