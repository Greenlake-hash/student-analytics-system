"""
End-to-end API tests for app/routers/submissions.py, exercising the full
state machine through the actual FastAPI app (not just the service layer)
using dev-mode auth (X-Dev-User-Email) -- see app/core/security.py.

Every scenario here was first verified by hand against a live server
during development (see the session transcript); these are the permanent,
automated versions of those same checks.
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Assessment, AssessmentSubmission, Course, Semester, Student, User, VerificationRequest
from app.models.enums import AssessmentType, CourseType, SubmissionStatus, UserRole, VerificationStatus


# ---------------------------------------------------------------------------
# Fixtures: a minimal course + assessment + student + admin, built fresh
# per test via db_session so nothing depends on seed data ordering.
# ---------------------------------------------------------------------------

@pytest.fixture()
def admin_user(db_session: Session) -> User:
    user = User(id=uuid.uuid4(), firebase_uid="api-admin", email="api-admin@test.dev",
                full_name="API Test Admin", role=UserRole.ADMIN)
    db_session.add(user)
    db_session.flush()
    return user


@pytest.fixture()
def student_user_and_profile(db_session: Session) -> tuple[User, Student]:
    user = User(id=uuid.uuid4(), firebase_uid="api-student", email="api-student@test.dev",
                full_name="API Test Student", role=UserRole.STUDENT)
    db_session.add(user)
    db_session.flush()
    student = Student(user_id=user.id, roll_number="API-TEST-01", program="BSc DSAI", current_trimester=1)
    db_session.add(student)
    db_session.flush()
    return user, student


@pytest.fixture()
def course_and_assessment(db_session: Session) -> tuple[Course, Assessment]:
    # Trimester 99 is deliberately out of the real 1-9 range used by seed
    # data and other manual testing in this dev DB, so tests that create a
    # Semester row for this course's trimester can't collide with a
    # pre-existing row (semesters.trimester_number is UNIQUE).
    course = Course(id=uuid.uuid4(), code="APITEST", name="API Test Course", trimester=99,
                     credits=6, credit_pattern="3-0-0-6", course_type=CourseType.COMPULSORY,
                     instructor="Faculty (TBA)")
    db_session.add(course)
    db_session.flush()
    assessment = Assessment(id=uuid.uuid4(), course_id=course.id, name="PT1",
                             assessment_type=AssessmentType.PT, max_marks=30, weight=18,
                             best_of_group="PT", best_of_eligible=True, enabled=True)
    db_session.add(assessment)
    db_session.flush()
    return course, assessment


def _auth(email: str) -> dict:
    return {"X-Dev-User-Email": email}


# ---------------------------------------------------------------------------
# Creation + duplicate prevention (API level, on top of the DB constraint)
# ---------------------------------------------------------------------------

def test_create_submission_succeeds(client: TestClient, student_user_and_profile, course_and_assessment):
    user, _student = student_user_and_profile
    _course, assessment = course_and_assessment

    resp = client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 25},
                        headers=_auth(user.email))

    assert resp.status_code == 201
    body = resp.json()
    assert body["score"] == 25.0
    assert body["status"] == "submitted"


def test_duplicate_submission_returns_409_not_500(client: TestClient, student_user_and_profile, course_and_assessment):
    """
    The whole point of the API-level check: a duplicate must come back as
    a clean 409 with an actionable message, not a raw IntegrityError 500.
    """
    user, _student = student_user_and_profile
    _course, assessment = course_and_assessment

    first = client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 25}, headers=_auth(user.email))
    assert first.status_code == 201

    second = client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 28}, headers=_auth(user.email))
    assert second.status_code == 409
    assert "already submitted" in second.json()["detail"]


def test_score_above_max_marks_is_rejected(client: TestClient, student_user_and_profile, course_and_assessment):
    user, _student = student_user_and_profile
    _course, assessment = course_and_assessment

    resp = client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 999}, headers=_auth(user.email))

    assert resp.status_code == 422
    assert "exceeds" in resp.json()["detail"]


def test_negative_score_is_rejected_by_schema_validation(client: TestClient, student_user_and_profile, course_and_assessment):
    user, _student = student_user_and_profile
    _course, assessment = course_and_assessment

    resp = client.post("/submissions", json={"assessment_id": str(assessment.id), "score": -5}, headers=_auth(user.email))

    assert resp.status_code == 422  # Pydantic Field(ge=0) catches this before it reaches route logic


def test_admin_cannot_create_a_submission(client: TestClient, admin_user, course_and_assessment):
    """RBAC: this route is student-only."""
    _course, assessment = course_and_assessment
    resp = client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 20}, headers=_auth(admin_user.email))
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Full happy-path state machine: submitted -> pending -> approved
# ---------------------------------------------------------------------------

def test_full_approval_flow(client: TestClient, db_session, student_user_and_profile, admin_user, course_and_assessment):
    user, student = student_user_and_profile
    _course, assessment = course_and_assessment

    created = client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 25}, headers=_auth(user.email))
    submission_id = created.json()["id"]

    queued = client.post(f"/submissions/{submission_id}/submit-for-verification", headers=_auth(user.email))
    assert queued.status_code == 201
    assert queued.json()["status"] == "pending"

    queue = client.get("/admin/verification-queue", headers=_auth(admin_user.email))
    assert queue.status_code == 200
    queue_ids = [item["id"] for item in queue.json()]
    assert submission_id in queue_ids

    verification_id = queued.json()["id"]
    approved = client.post(f"/admin/verification-requests/{verification_id}/approve",
                            json={"notes": "Looks good"}, headers=_auth(admin_user.email))
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    # The DB row itself should reflect APPROVED, independent of the response body.
    db_session.expire_all()
    submission = db_session.get(AssessmentSubmission, uuid.UUID(submission_id))
    assert submission.status == SubmissionStatus.APPROVED


def test_double_approval_is_rejected(client: TestClient, student_user_and_profile, admin_user, course_and_assessment):
    user, _student = student_user_and_profile
    _course, assessment = course_and_assessment

    created = client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 25}, headers=_auth(user.email))
    queued = client.post(f"/submissions/{created.json()['id']}/submit-for-verification", headers=_auth(user.email))
    verification_id = queued.json()["id"]

    first = client.post(f"/admin/verification-requests/{verification_id}/approve", json={}, headers=_auth(admin_user.email))
    assert first.status_code == 200

    second = client.post(f"/admin/verification-requests/{verification_id}/approve", json={}, headers=_auth(admin_user.email))
    assert second.status_code == 409


def test_approved_submission_cannot_be_self_updated(client: TestClient, student_user_and_profile, admin_user, course_and_assessment):
    user, _student = student_user_and_profile
    _course, assessment = course_and_assessment

    created = client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 25}, headers=_auth(user.email))
    submission_id = created.json()["id"]
    queued = client.post(f"/submissions/{submission_id}/submit-for-verification", headers=_auth(user.email))
    client.post(f"/admin/verification-requests/{queued.json()['id']}/approve", json={}, headers=_auth(admin_user.email))

    resp = client.post(f"/submissions/{submission_id}/request-update",
                        json={"assessment_id": str(assessment.id), "score": 29}, headers=_auth(user.email))
    assert resp.status_code == 409
    assert "Contact an admin" in resp.json()["detail"]


def test_student_only_sees_their_own_submissions(client: TestClient, db_session, student_user_and_profile, course_and_assessment):
    user, _student = student_user_and_profile
    _course, assessment = course_and_assessment

    other_user = User(id=uuid.uuid4(), firebase_uid="other", email="other-student@test.dev",
                       full_name="Other Student", role=UserRole.STUDENT)
    db_session.add(other_user)
    db_session.flush()
    other_student = Student(user_id=other_user.id, roll_number="OTHER-01", program="BSc DSAI", current_trimester=1)
    db_session.add(other_student)
    db_session.flush()

    client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 25}, headers=_auth(user.email))
    client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 18}, headers=_auth(other_user.email))

    mine = client.get("/submissions/mine", headers=_auth(user.email))
    assert mine.status_code == 200
    assert len(mine.json()) == 1
    assert mine.json()[0]["score"] == 25.0


# ---------------------------------------------------------------------------
# Rejection + resubmission cycle
# ---------------------------------------------------------------------------

def test_rejection_requires_notes(client: TestClient, student_user_and_profile, admin_user, course_and_assessment):
    user, _student = student_user_and_profile
    _course, assessment = course_and_assessment

    created = client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 15}, headers=_auth(user.email))
    queued = client.post(f"/submissions/{created.json()['id']}/submit-for-verification", headers=_auth(user.email))

    resp = client.post(f"/admin/verification-requests/{queued.json()['id']}/reject", json={}, headers=_auth(admin_user.email))
    assert resp.status_code == 422


def test_reject_then_resubmit_cycle(client: TestClient, db_session, student_user_and_profile, admin_user, course_and_assessment):
    user, _student = student_user_and_profile
    _course, assessment = course_and_assessment

    created = client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 15}, headers=_auth(user.email))
    submission_id = created.json()["id"]
    queued = client.post(f"/submissions/{submission_id}/submit-for-verification", headers=_auth(user.email))

    rejected = client.post(f"/admin/verification-requests/{queued.json()['id']}/reject",
                            json={"notes": "Score mismatch, please recheck."}, headers=_auth(admin_user.email))
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"

    resubmitted = client.post(f"/submissions/{submission_id}/request-update",
                               json={"assessment_id": str(assessment.id), "score": 18}, headers=_auth(user.email))
    assert resubmitted.status_code == 200
    assert resubmitted.json()["status"] == "submitted"
    assert resubmitted.json()["score"] == 18.0


# ---------------------------------------------------------------------------
# Portal freeze
# ---------------------------------------------------------------------------

def test_frozen_portal_blocks_new_submissions(client: TestClient, db_session, student_user_and_profile, course_and_assessment):
    user, _student = student_user_and_profile
    course, assessment = course_and_assessment

    semester = Semester(id=uuid.uuid4(), trimester_number=course.trimester, is_frozen=True)
    db_session.add(semester)
    db_session.flush()

    resp = client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 20}, headers=_auth(user.email))
    assert resp.status_code == 423


def test_unfrozen_portal_allows_submissions(client: TestClient, db_session, student_user_and_profile, course_and_assessment):
    user, _student = student_user_and_profile
    course, assessment = course_and_assessment

    semester = Semester(id=uuid.uuid4(), trimester_number=course.trimester, is_frozen=False)
    db_session.add(semester)
    db_session.flush()

    resp = client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 20}, headers=_auth(user.email))
    assert resp.status_code == 201


# ---------------------------------------------------------------------------
# Audit logging
# ---------------------------------------------------------------------------

def test_audit_log_records_full_lifecycle(client: TestClient, db_session, student_user_and_profile, admin_user, course_and_assessment):
    from app.models import AuditLog

    user, _student = student_user_and_profile
    _course, assessment = course_and_assessment

    created = client.post("/submissions", json={"assessment_id": str(assessment.id), "score": 25}, headers=_auth(user.email))
    submission_id = created.json()["id"]
    queued = client.post(f"/submissions/{submission_id}/submit-for-verification", headers=_auth(user.email))
    client.post(f"/admin/verification-requests/{queued.json()['id']}/approve",
                json={"notes": "ok"}, headers=_auth(admin_user.email))

    db_session.expire_all()
    logs = (
        db_session.query(AuditLog)
        .filter(AuditLog.entity_type == "assessment_submission", AuditLog.entity_id == submission_id)
        .order_by(AuditLog.created_at)
        .all()
    )
    actions = [log.action.value for log in logs]
    assert actions == ["created", "updated", "updated"]  # create, ->pending, ->approved
    assert logs[0].after_value["status"] == "submitted"
    assert logs[-1].after_value["status"] == "approved"
    assert all(log.user_id == user.id for log in logs[:2])  # student-initiated actions attributed to the student
