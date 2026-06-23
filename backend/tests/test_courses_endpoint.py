"""
Tests for GET /courses -- specifically that it returns a real `id` field,
since the frontend depends on it to call every per-course endpoint
(analytics, recompute, submissions). See app/main.py's CourseRead schema
and its docstring for context on why this replaced the original
id-less response.
"""
import uuid

from fastapi.testclient import TestClient

from app.models import Course, User
from app.models.enums import CourseType, UserRole


def test_courses_endpoint_returns_real_uuid_ids(client: TestClient, db_session):
    admin = User(id=uuid.uuid4(), firebase_uid="courses-test-admin", email="courses-test-admin@test.dev",
                 full_name="Courses Test Admin", role=UserRole.ADMIN)
    db_session.add(admin)
    course = Course(id=uuid.uuid4(), code="COURSETEST", name="Course Endpoint Test", trimester=97,
                     credits=6, credit_pattern="3-0-0-6", course_type=CourseType.ELECTIVE,
                     instructor="Faculty (TBA)")
    db_session.add(course)
    db_session.flush()

    resp = client.get("/courses", headers={"X-Dev-User-Email": admin.email})
    assert resp.status_code == 200
    body = resp.json()

    match = next(c for c in body if c["code"] == "COURSETEST")
    assert match["id"] == str(course.id)
    assert match["type"] == "Elective"
    uuid.UUID(match["id"])  # raises if it's not a real UUID string


def test_course_assessments_endpoint_lists_enabled_only(client: TestClient, db_session):
    from app.models import Assessment
    from app.models.enums import AssessmentType

    admin = User(id=uuid.uuid4(), firebase_uid="assess-test-admin", email="assess-test-admin@test.dev",
                 full_name="Assessments Test Admin", role=UserRole.ADMIN)
    db_session.add(admin)
    course = Course(id=uuid.uuid4(), code="ASSESSTEST", name="Assessment Endpoint Test", trimester=96,
                     credits=6, credit_pattern="3-0-0-6", course_type=CourseType.COMPULSORY,
                     instructor="Faculty (TBA)")
    db_session.add(course)
    db_session.flush()

    enabled = Assessment(id=uuid.uuid4(), course_id=course.id, name="PT1", assessment_type=AssessmentType.PT,
                          max_marks=30, weight=18, best_of_group="PT", best_of_eligible=True, enabled=True)
    disabled = Assessment(id=uuid.uuid4(), course_id=course.id, name="PT2", assessment_type=AssessmentType.PT,
                           max_marks=30, weight=18, best_of_group="PT", best_of_eligible=True, enabled=False)
    db_session.add_all([enabled, disabled])
    db_session.flush()

    resp = client.get(f"/courses/{course.id}/assessments", headers={"X-Dev-User-Email": admin.email})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "PT1"
    assert body[0]["max_marks"] == 30.0


def test_assessments_endpoint_404_for_unknown_course(client: TestClient, db_session):
    admin = User(id=uuid.uuid4(), firebase_uid="assess-404-admin", email="assess-404-admin@test.dev",
                 full_name="404 Admin", role=UserRole.ADMIN)
    db_session.add(admin)
    db_session.flush()

    resp = client.get(f"/courses/{uuid.uuid4()}/assessments", headers={"X-Dev-User-Email": admin.email})
    assert resp.status_code == 404
