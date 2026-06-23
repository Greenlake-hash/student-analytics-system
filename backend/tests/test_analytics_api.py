"""
End-to-end API tests for app/routers/analytics.py: freeze controls,
recompute, and the public/admin analytics privacy split.

Every scenario here was first verified by hand against a live server
during development with a 25-student synthetic cohort and realistic
score distributions (see the session transcript) -- these are the
permanent, automated versions of those checks, using small hand-built
cohorts instead so the exact statistics are independently verifiable.
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import (
    Assessment,
    AssessmentSubmission,
    Course,
    CourseGradingRule,
    Student,
    User,
)
from app.models.enums import AssessmentType, CourseType, SubmissionStatus, UserRole


def _auth(email: str) -> dict:
    return {"X-Dev-User-Email": email}


@pytest.fixture()
def admin_user(db_session: Session) -> User:
    user = User(id=uuid.uuid4(), firebase_uid="analytics-admin", email="analytics-admin@test.dev",
                full_name="Analytics Admin", role=UserRole.ADMIN)
    db_session.add(user)
    db_session.flush()
    return user


@pytest.fixture()
def course_with_one_assessment(db_session: Session) -> tuple[Course, Assessment]:
    # Trimester 98, distinct from both real seed trimesters (1-9) and the
    # submissions test suite's trimester 99, so freeze/semester tests here
    # can't collide with either.
    course = Course(id=uuid.uuid4(), code="ANALYTICSTEST", name="Analytics Test Course", trimester=98,
                     credits=6, credit_pattern="3-0-0-6", course_type=CourseType.COMPULSORY,
                     instructor="Faculty (TBA)")
    db_session.add(course)
    db_session.flush()
    assessment = Assessment(id=uuid.uuid4(), course_id=course.id, name="ENDTERM",
                             assessment_type=AssessmentType.OTHER, max_marks=100, weight=100,
                             best_of_group="ENDTERM", best_of_eligible=False, enabled=True)
    db_session.add(assessment)
    db_session.flush()
    rule = CourseGradingRule(id=uuid.uuid4(), course_id=course.id, best_of_group="ENDTERM", best_of_count=1, enabled=True)
    db_session.add(rule)
    db_session.flush()
    return course, assessment


def _make_student(db_session: Session, suffix: str) -> Student:
    user = User(id=uuid.uuid4(), firebase_uid=f"analytics-student-{suffix}", email=f"analytics-student-{suffix}@test.dev",
                full_name=f"Analytics Student {suffix}", role=UserRole.STUDENT)
    db_session.add(user)
    db_session.flush()
    student = Student(user_id=user.id, roll_number=f"ANALYTICS-{suffix}", program="BSc DSAI", current_trimester=98)
    db_session.add(student)
    db_session.flush()
    return student


def _approved_submission(db_session: Session, student: Student, assessment: Assessment, score: float) -> None:
    db_session.add(AssessmentSubmission(
        id=uuid.uuid4(), student_id=student.user_id, assessment_id=assessment.id,
        score=score, status=SubmissionStatus.APPROVED,
    ))
    db_session.flush()


# ---------------------------------------------------------------------------
# Freeze controls
# ---------------------------------------------------------------------------

def test_freeze_creates_semester_if_missing(client: TestClient, admin_user):
    resp = client.post("/admin/semesters/77/freeze", json={"is_frozen": True}, headers=_auth(admin_user.email))
    assert resp.status_code == 200
    assert resp.json()["trimester_number"] == 77
    assert resp.json()["is_frozen"] is True


def test_freeze_toggles_existing_semester(client: TestClient, admin_user):
    client.post("/admin/semesters/78/freeze", json={"is_frozen": True}, headers=_auth(admin_user.email))
    resp = client.post("/admin/semesters/78/freeze", json={"is_frozen": False}, headers=_auth(admin_user.email))
    assert resp.status_code == 200
    assert resp.json()["is_frozen"] is False


def test_student_cannot_freeze_a_semester(client: TestClient, db_session):
    student = _make_student(db_session, "freeze-rbac")
    resp = client.post("/admin/semesters/79/freeze", json={"is_frozen": True}, headers=_auth(student.user.email))
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Recompute: success, idempotency, error paths
# ---------------------------------------------------------------------------

def test_recompute_with_no_submissions_returns_422(client: TestClient, admin_user, course_with_one_assessment):
    course, _assessment = course_with_one_assessment
    resp = client.post(f"/admin/courses/{course.id}/recompute", headers=_auth(admin_user.email))
    assert resp.status_code == 422
    assert "nothing to compute" in resp.json()["detail"]


def test_recompute_computes_correct_statistics(client: TestClient, db_session, admin_user, course_with_one_assessment):
    """Three students, scores 60/80/100 -> mean=80, population stdev=sqrt(800/3)."""
    course, assessment = course_with_one_assessment
    for suffix, score in [("a", 60), ("b", 80), ("c", 100)]:
        student = _make_student(db_session, suffix)
        _approved_submission(db_session, student, assessment, score)

    resp = client.post(f"/admin/courses/{course.id}/recompute", headers=_auth(admin_user.email))
    assert resp.status_code == 200
    body = resp.json()
    assert body["mean"] == 80.0
    assert body["submission_count"] == 3


def test_recompute_is_idempotent(client: TestClient, db_session, admin_user, course_with_one_assessment):
    course, assessment = course_with_one_assessment
    student = _make_student(db_session, "idem")
    _approved_submission(db_session, student, assessment, 75)

    for _ in range(3):
        resp = client.post(f"/admin/courses/{course.id}/recompute", headers=_auth(admin_user.email))
        assert resp.status_code == 200

    from app.models import StudentResult
    count = db_session.query(StudentResult).filter(StudentResult.course_id == course.id).count()
    assert count == 1  # not 3


def test_student_cannot_trigger_recompute(client: TestClient, db_session, course_with_one_assessment):
    course, _assessment = course_with_one_assessment
    student = _make_student(db_session, "recompute-rbac")
    resp = client.post(f"/admin/courses/{course.id}/recompute", headers=_auth(student.user.email))
    assert resp.status_code == 403


def test_only_approved_submissions_count_toward_recompute(client: TestClient, db_session, admin_user, course_with_one_assessment):
    """A student with only a SUBMITTED (not yet approved) submission shouldn't appear in the cohort."""
    course, assessment = course_with_one_assessment
    approved_student = _make_student(db_session, "appr")
    _approved_submission(db_session, approved_student, assessment, 70)

    unapproved_student = _make_student(db_session, "unappr")
    db_session.add(AssessmentSubmission(
        id=uuid.uuid4(), student_id=unapproved_student.user_id, assessment_id=assessment.id,
        score=20, status=SubmissionStatus.SUBMITTED,  # NOT approved
    ))
    db_session.flush()

    resp = client.post(f"/admin/courses/{course.id}/recompute", headers=_auth(admin_user.email))
    assert resp.status_code == 200
    assert resp.json()["submission_count"] == 1  # only the approved student counted


# ---------------------------------------------------------------------------
# Analytics privacy split
# ---------------------------------------------------------------------------

def test_public_analytics_has_no_student_identities(client: TestClient, db_session, admin_user, course_with_one_assessment):
    course, assessment = course_with_one_assessment
    for suffix, score in [("a", 60), ("b", 80), ("c", 100)]:
        student = _make_student(db_session, suffix)
        _approved_submission(db_session, student, assessment, score)
    client.post(f"/admin/courses/{course.id}/recompute", headers=_auth(admin_user.email))

    viewer = _make_student(db_session, "viewer")
    resp = client.get(f"/courses/{course.id}/analytics", headers=_auth(viewer.user.email))

    assert resp.status_code == 200
    body = resp.json()
    assert "results" not in body
    assert "student_id" not in str(body)  # no raw identifiers leak anywhere in the payload
    assert body["statistics"]["mean"] == 80.0
    assert sum(b["count"] for b in body["grade_distribution"]) == 3


def test_admin_roster_includes_student_identities(client: TestClient, db_session, admin_user, course_with_one_assessment):
    course, assessment = course_with_one_assessment
    student = _make_student(db_session, "roster")
    _approved_submission(db_session, student, assessment, 85)
    client.post(f"/admin/courses/{course.id}/recompute", headers=_auth(admin_user.email))

    resp = client.get(f"/admin/courses/{course.id}/analytics", headers=_auth(admin_user.email))
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["results"]) == 1
    assert body["results"][0]["student_id"] == str(student.user_id)


def test_student_cannot_access_admin_roster(client: TestClient, db_session, admin_user, course_with_one_assessment):
    course, assessment = course_with_one_assessment
    student = _make_student(db_session, "blocked")
    _approved_submission(db_session, student, assessment, 85)
    client.post(f"/admin/courses/{course.id}/recompute", headers=_auth(admin_user.email))

    resp = client.get(f"/admin/courses/{course.id}/analytics", headers=_auth(student.user.email))
    assert resp.status_code == 403


def test_analytics_404_before_any_recompute(client: TestClient, admin_user, course_with_one_assessment):
    course, _assessment = course_with_one_assessment
    resp = client.get(f"/courses/{course.id}/analytics", headers=_auth(admin_user.email))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Student's own result
# ---------------------------------------------------------------------------

def test_student_sees_own_result_without_seeing_others(client: TestClient, db_session, admin_user, course_with_one_assessment):
    course, assessment = course_with_one_assessment
    me = _make_student(db_session, "me")
    _approved_submission(db_session, me, assessment, 90)
    other = _make_student(db_session, "other")
    _approved_submission(db_session, other, assessment, 50)
    client.post(f"/admin/courses/{course.id}/recompute", headers=_auth(admin_user.email))

    resp = client.get(f"/courses/{course.id}/my-result", headers=_auth(me.user.email))
    assert resp.status_code == 200
    body = resp.json()
    assert body["raw_score"] == 90.0
    assert "student_id" not in body  # MyResultRead deliberately omits this
    assert body["rank"] == 1  # higher score than 'other'


def test_my_result_404_when_not_yet_computed(client: TestClient, db_session, course_with_one_assessment):
    course, _assessment = course_with_one_assessment
    student = _make_student(db_session, "nocomputed")
    resp = client.get(f"/courses/{course.id}/my-result", headers=_auth(student.user.email))
    assert resp.status_code == 404


def test_admin_cannot_use_my_result_endpoint(client: TestClient, admin_user, course_with_one_assessment):
    """require_role(STUDENT) should reject an admin before the profile check even runs."""
    course, _assessment = course_with_one_assessment
    resp = client.get(f"/courses/{course.id}/my-result", headers=_auth(admin_user.email))
    assert resp.status_code == 403
