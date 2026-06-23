"""
Admin freeze controls and course analytics API (Phase 3.3, 3.4).

Freeze/unfreeze just flips Semester.is_frozen -- the actual statistics
computation is a separate, explicit step (POST .../recompute), not an
automatic side effect of freezing. This is deliberate: an admin should be
able to freeze a portal (stop new submissions) without immediately
committing to a specific computed result, e.g. to do a final review pass
on the verification queue first. Recompute is idempotent (see
app/services/freeze.py), so calling it multiple times before publishing
is safe and expected.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import CurrentUser, require_role, require_student_profile
from app.models import Course, CourseStatistics, Semester, StudentResult
from app.models.enums import UserRole
from app.schemas.analytics import (
    CourseAnalyticsRead,
    CourseAnalyticsWithRosterRead,
    CourseStatisticsRead,
    GradeDistributionBucket,
    HistogramBucket,
    MyResultRead,
    SemesterFreezeRequest,
    SemesterRead,
    StudentResultRead,
)
from app.services.freeze import NoEligibleStudentsError, recompute_course_results
from app.services.relative_grading import StudentScore, build_histogram

freeze_router = APIRouter(tags=["analytics"], dependencies=[Depends(require_role(UserRole.ADMIN))])
analytics_router = APIRouter(tags=["analytics"])  # any authenticated user -- aggregate data only, see schema docstrings


# ---------------------------------------------------------------------------
# Portal freeze controls
# ---------------------------------------------------------------------------

@freeze_router.post("/admin/semesters/{trimester_number}/freeze", response_model=SemesterRead)
def set_semester_freeze(
    trimester_number: int,
    payload: SemesterFreezeRequest,
    db: Session = Depends(get_db),
) -> Semester:
    """
    Creates the Semester row if it doesn't exist yet -- admins shouldn't
    need a separate "create semester" step before they can freeze one.
    """
    semester = db.query(Semester).filter(Semester.trimester_number == trimester_number).one_or_none()
    if semester is None:
        semester = Semester(id=uuid.uuid4(), trimester_number=trimester_number, is_frozen=payload.is_frozen)
        db.add(semester)
    else:
        semester.is_frozen = payload.is_frozen
    db.commit()
    db.refresh(semester)
    return semester


@freeze_router.get("/admin/semesters", response_model=list[SemesterRead])
def list_semesters(db: Session = Depends(get_db)) -> list[Semester]:
    return db.query(Semester).order_by(Semester.trimester_number).all()


# ---------------------------------------------------------------------------
# Recompute + analytics
# ---------------------------------------------------------------------------

@freeze_router.post("/admin/courses/{course_id}/recompute", response_model=CourseStatisticsRead)
def recompute_course(course_id: uuid.UUID, db: Session = Depends(get_db)) -> CourseStatistics:
    """
    Runs the full Phase 2.1 + Phase 3.1 pipeline for one course: grading
    engine -> relative grading stats -> upserts CourseStatistics and
    StudentResult rows. See app/services/freeze.py for what this does NOT
    do (it doesn't require the portal to be frozen first -- an admin
    previewing results before freezing is a legitimate workflow).
    """
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found.")

    try:
        stats = recompute_course_results(db, course_id)
    except NoEligibleStudentsError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    db.commit()
    db.refresh(stats)
    return stats


def _build_aggregate_analytics(db: Session, course_id: uuid.UUID) -> tuple[CourseStatistics, list[StudentResult]]:
    stats = db.get(CourseStatistics, course_id)
    if stats is None or stats.computed_at is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No results have been computed for this course yet. An admin must run recompute first.",
        )
    results = db.query(StudentResult).filter(StudentResult.course_id == course_id).order_by(StudentResult.rank).all()
    return stats, results


@analytics_router.get("/courses/{course_id}/analytics", response_model=CourseAnalyticsRead)
def get_course_analytics(
    course_id: uuid.UUID,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
) -> dict:
    """
    Aggregate-only analytics: mean/median/stdev, grade distribution, and
    score histogram. Open to any authenticated user (student or admin) --
    see CourseAnalyticsRead's docstring for why this is safe to share:
    none of it identifies an individual student or their exact score.
    Does not trigger a recompute; reflects whatever the last admin
    recompute produced (see app/services/freeze.py).
    """
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found.")

    stats, results = _build_aggregate_analytics(db, course_id)

    grade_counts: dict[str, int] = {}
    for r in results:
        if r.relative_grade:
            grade_counts[r.relative_grade] = grade_counts.get(r.relative_grade, 0) + 1
    histogram_data = build_histogram([StudentScore(student_id=str(r.student_id), raw_score=float(r.raw_score)) for r in results])

    return {
        "statistics": CourseStatisticsRead.model_validate(stats),
        "grade_distribution": [GradeDistributionBucket(grade=g, count=c) for g, c in sorted(grade_counts.items())],
        "histogram": [HistogramBucket(range_label=label, range_min=lo, range_max=hi, count=count) for label, lo, hi, count in histogram_data],
    }


@freeze_router.get("/admin/courses/{course_id}/analytics", response_model=CourseAnalyticsWithRosterRead)
def get_course_analytics_with_roster(course_id: uuid.UUID, db: Session = Depends(get_db)) -> dict:
    """
    Admin-only: the aggregate view PLUS the full per-student roster
    (identity, exact score, rank). This is the endpoint the verification/
    grading admin UI uses; the student-facing dashboard uses the
    aggregate-only /courses/{course_id}/analytics instead.
    """
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found.")

    stats, results = _build_aggregate_analytics(db, course_id)

    grade_counts: dict[str, int] = {}
    for r in results:
        if r.relative_grade:
            grade_counts[r.relative_grade] = grade_counts.get(r.relative_grade, 0) + 1
    histogram_data = build_histogram([StudentScore(student_id=str(r.student_id), raw_score=float(r.raw_score)) for r in results])

    return {
        "statistics": CourseStatisticsRead.model_validate(stats),
        "grade_distribution": [GradeDistributionBucket(grade=g, count=c) for g, c in sorted(grade_counts.items())],
        "histogram": [HistogramBucket(range_label=label, range_min=lo, range_max=hi, count=count) for label, lo, hi, count in histogram_data],
        "results": [StudentResultRead.model_validate(r) for r in results],
    }


@analytics_router.get("/courses/{course_id}/my-result", response_model=MyResultRead, dependencies=[Depends(require_role(UserRole.STUDENT))])
def get_my_course_result(
    course_id: uuid.UUID,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
) -> StudentResult:
    """
    A student's own computed result for one course -- their raw score,
    z-score, relative grade, rank, and percentile, without exposing any
    classmate's identity or score. This is how the plan's "View relative
    grades / View rank / View percentile" student features are served
    without widening the aggregate endpoint into a privacy leak.
    """
    student = require_student_profile(current_user, db)
    result = (
        db.query(StudentResult)
        .filter(StudentResult.course_id == course_id, StudentResult.student_id == student.user_id)
        .one_or_none()
    )
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No computed result found for you in this course yet.",
        )
    return result
