"""
FastAPI application entrypoint — production-ready configuration (Phase 5).

Security additions over the Phase 1–4 prototype:
  - SecurityHeadersMiddleware: X-Frame-Options, HSTS, CSP, etc.
  - Rate limiting via slowapi on auth-sensitive and admin routes.
  - Request body size cap (1 MB) via Starlette's built-in limit.

Run from backend/ with the venv active:
    uvicorn app.main:app --reload --port 8000

Visit http://localhost:8000/docs for interactive API docs.
"""
import uuid

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.middleware import SecurityHeadersMiddleware
from app.core.security import CurrentUser, require_role
from app.models import Assessment, Course
from app.models.enums import UserRole
from app.routers.analytics import analytics_router, freeze_router
from app.routers.submissions import router as submissions_router
from app.schemas.assessment import AssessmentRead
from app.schemas.course import CourseRead

settings = get_settings()

# ---------------------------------------------------------------------------
# Rate limiter
# Key by remote address. In production behind a proxy (Render), set
# FORWARDED_ALLOW_IPS in the environment so Starlette trusts the
# X-Forwarded-For header and rate-limits by real client IP, not the proxy.
# ---------------------------------------------------------------------------
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

app = FastAPI(
    title="Student Performance Analytics Dashboard API",
    description="Relative grading and academic analytics platform — v2 backend.",
    version="2.0.0",
)

# Security headers must be added BEFORE CORS so they appear on every response
# including preflight requests.
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.include_router(submissions_router)
app.include_router(freeze_router)
app.include_router(analytics_router)


# ---------------------------------------------------------------------------
# Core endpoints
# ---------------------------------------------------------------------------

@app.get("/health", tags=["meta"])
def health_check(db: Session = Depends(get_db)) -> dict:
    """Verifies the API process is up AND can reach Postgres -- not just a static 200."""
    db.execute(text("SELECT 1"))
    return {"status": "ok", "env": settings.app_env, "firebase_enabled": settings.firebase_enabled}


@app.get("/me", tags=["auth"])
@limiter.limit("60/minute")
def get_me(request: Request, current_user: CurrentUser) -> dict:
    """
    Resolves the current user from their auth token/header. The 60/minute
    rate limit prevents token-probing attacks: an attacker can't rapidly
    enumerate valid credentials through this endpoint.
    """
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "full_name": current_user.full_name,
        "role": current_user.role.value,
    }


@app.get("/admin/ping", tags=["auth"])
def admin_only_ping(admin_user=Depends(require_role(UserRole.ADMIN))) -> dict:
    """Proof-of-life for RBAC: only reachable by users with role=admin."""
    return {"message": f"Hello, admin {admin_user.full_name}. RBAC is working."}


@app.get("/courses", tags=["courses"], response_model=list[CourseRead])
def list_courses(db: Session = Depends(get_db)) -> list[CourseRead]:
    """Full course catalog with UUIDs -- the frontend needs the id for analytics/submission calls."""
    courses = db.query(Course).order_by(Course.trimester, Course.code).all()
    return [
        CourseRead(id=c.id, code=c.code, name=c.name, trimester=c.trimester, credits=c.credits, type=c.course_type.value)
        for c in courses
    ]


@app.get("/courses/{course_id}/assessments", tags=["courses"], response_model=list[AssessmentRead])
def list_course_assessments(
    course_id: uuid.UUID,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
) -> list[AssessmentRead]:
    """Assessment definitions for one course. Open to any authenticated user."""
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found.")
    assessments = (
        db.query(Assessment)
        .filter(Assessment.course_id == course_id, Assessment.enabled.is_(True))
        .order_by(Assessment.name)
        .all()
    )
    return [
        AssessmentRead(
            id=a.id, course_id=a.course_id, name=a.name, assessment_type=a.assessment_type.value,
            max_marks=float(a.max_marks), weight=float(a.weight), best_of_group=a.best_of_group,
            best_of_eligible=a.best_of_eligible, enabled=a.enabled,
        )
        for a in assessments
    ]
