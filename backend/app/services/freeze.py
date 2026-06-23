"""
Freeze orchestration: the service that actually runs when an admin
freezes a semester (migration plan Phase 3.3's "after freeze: calculate
mean/median/.../grade distribution").

This module is the connective tissue between the two pure engines
(app/services/grading.py for per-student course percentage,
app/services/relative_grading.py for cohort statistics/z-scores/rank) and
the database: it's the only place that reads Assessment/AssessmentSubmission
rows, calls both engines, and writes CourseStatistics/StudentResult rows.
Keeping that DB-touching logic in one place (rather than scattered across
route handlers) means there is exactly one code path that can produce a
published result set, which matters for the "only APPROVED submissions
feed grading" and "results are computed once at freeze, not recomputed
live" guarantees the migration plan calls for.
"""
import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import (
    Assessment,
    AssessmentSubmission,
    Course,
    CourseGradingRule,
    CourseStatistics,
    RelativeGradingRule,
    StudentResult,
)
from app.services.grading import (
    AssessmentInput,
    GradingRuleInput,
    SubmissionInput,
    evaluate_plan,
)
from app.services.relative_grading import (
    StudentScore,
    compute_cohort_statistics,
    compute_relative_results,
)


class NoEligibleStudentsError(ValueError):
    """Raised when a course has zero students with at least one submission -- nothing to grade."""


def _raw_course_percentage_for_student(
    student_id: uuid.UUID,
    assessments: list[Assessment],
    submissions: list[AssessmentSubmission],
    rules: list[CourseGradingRule],
) -> float | None:
    """
    Runs one student's submissions through the Phase 2.1 grading engine.

    Returns None -- meaning "not part of the graded cohort yet," not
    "scored 0%" -- in two cases:
      1. The student has no submissions at all for this course.
      2. The student has submissions, but NONE of them are
         APPROVED/PUBLISHED (e.g. still pending verification, or
         rejected). evaluate_plan() would happily return 0.0 for such a
         student (every assessment treated as not-entered, per Phase
         2.1's COUNTABLE_SUBMISSION_STATUSES), but a 0.0 from "nothing is
         verified yet" must not be indistinguishable from a 0.0 from "this
         student genuinely scored zero on every assessment" -- the first
         means exclude them from the cohort being graded; the second is a
         real, countable data point. This is exactly the bug a naive
         "submissions exist -> run the engine" check would miss, since an
         empty/zero evaluate_plan() result looks identical to a real zero
         score from the caller's side.
    """
    student_submissions = [s for s in submissions if s.student_id == student_id]
    if not student_submissions:
        return None

    has_any_approved = any(
        s.status.value in {"approved", "published"} for s in student_submissions
    )
    if not has_any_approved:
        return None

    result = evaluate_plan(
        assessments=[
            AssessmentInput(
                id=str(a.id), name=a.name, best_of_group=a.best_of_group,
                max_marks=float(a.max_marks), weight=float(a.weight),
                best_of_eligible=a.best_of_eligible, enabled=a.enabled,
            )
            for a in assessments
        ],
        submissions=[
            SubmissionInput(assessment_id=str(s.assessment_id), score=float(s.score) if s.score is not None else None, status=s.status.value)
            for s in student_submissions
        ],
        rules=[
            GradingRuleInput(best_of_group=r.best_of_group, best_of_count=r.best_of_count, enabled=r.enabled)
            for r in rules
        ],
    )
    return result.projected


def recompute_course_results(db: Session, course_id: uuid.UUID) -> CourseStatistics:
    """
    The full Phase 3 pipeline for one course:

      1. For every student with at least one submission in this course,
         run the Phase 2.1 grading engine to get their raw course
         percentage (using only APPROVED/PUBLISHED submissions).
      2. Feed those raw percentages into the Phase 3.1 relative grading
         engine to get mean/median/mode/stdev, then z-score/grade/rank/
         percentile per student.
      3. Upsert one CourseStatistics row and one StudentResult row per
         student.

    Idempotent: safe to call again (e.g. after a late correction is
    approved and the admin re-freezes) -- existing rows are updated in
    place, not duplicated, since both tables have a unique constraint on
    their natural key.

    Does NOT commit -- caller controls the transaction boundary, same
    convention as app/services/audit.py, so this can be composed into a
    larger "freeze the whole semester" operation that either fully
    succeeds or fully rolls back.
    """
    course = db.get(Course, course_id)
    if course is None:
        raise ValueError(f"Course {course_id} not found.")

    assessments = db.query(Assessment).filter(Assessment.course_id == course_id, Assessment.enabled.is_(True)).all()
    rules = db.query(CourseGradingRule).filter(CourseGradingRule.course_id == course_id).all()

    assessment_ids = [a.id for a in assessments]
    submissions = (
        db.query(AssessmentSubmission)
        .filter(AssessmentSubmission.assessment_id.in_(assessment_ids))
        .all()
        if assessment_ids else []
    )
    student_ids_with_submissions = {s.student_id for s in submissions}

    student_scores: list[StudentScore] = []
    for student_id in student_ids_with_submissions:
        percentage = _raw_course_percentage_for_student(student_id, assessments, submissions, rules)
        if percentage is not None:
            student_scores.append(StudentScore(student_id=str(student_id), raw_score=percentage))

    if not student_scores:
        raise NoEligibleStudentsError(
            f"Course {course.code} has no students with any submission yet -- nothing to compute."
        )

    cohort_stats = compute_cohort_statistics(student_scores)

    grading_rule = db.query(RelativeGradingRule).filter(RelativeGradingRule.course_id == course_id).one_or_none()
    boundaries = grading_rule.z_boundaries if grading_rule else None

    relative_results = compute_relative_results(student_scores, boundaries=boundaries)

    stats_row = db.get(CourseStatistics, course_id)
    if stats_row is None:
        stats_row = CourseStatistics(course_id=course_id)
        db.add(stats_row)
    stats_row.mean = cohort_stats.mean
    stats_row.median = cohort_stats.median
    stats_row.mode = cohort_stats.mode
    stats_row.stdev = cohort_stats.stdev
    stats_row.submission_count = cohort_stats.count
    stats_row.computed_at = datetime.now(UTC)

    existing_results = {
        r.student_id: r
        for r in db.query(StudentResult).filter(StudentResult.course_id == course_id).all()
    }
    for result in relative_results:
        student_uuid = uuid.UUID(result.student_id)
        row = existing_results.get(student_uuid)
        if row is None:
            row = StudentResult(id=uuid.uuid4(), student_id=student_uuid, course_id=course_id, raw_score=result.raw_score)
            db.add(row)
        row.raw_score = result.raw_score
        row.z_score = result.z_score
        row.relative_grade = result.relative_grade
        row.rank = result.rank
        row.percentile = result.percentile
        row.computed_at = datetime.now(UTC)

    db.flush()
    return stats_row
