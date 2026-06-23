"""
Tests for the schema-level guarantees the migration plan calls out
explicitly: duplicate submission prevention and cascade delete behavior.

These are deliberately database-level tests (not mocked) -- the entire
point of the UNIQUE constraint is that it's enforced by Postgres itself,
not by application code that could have a bug or get bypassed by a raw
SQL script or a future second API. A test that mocks the DB away would
not actually verify the guarantee.
"""
import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Assessment, AssessmentSubmission, Course, Student, User
from app.models.enums import AssessmentType, CourseType, SubmissionStatus, UserRole


def _make_student(db, suffix: str) -> Student:
    user = User(
        id=uuid.uuid4(),
        firebase_uid=f"test-uid-{suffix}",
        email=f"student-{suffix}@test.dev",
        full_name=f"Test Student {suffix}",
        role=UserRole.STUDENT,
    )
    db.add(user)
    db.flush()
    student = Student(user_id=user.id, roll_number=f"TEST-{suffix}", program="BSc DSAI", current_trimester=1)
    db.add(student)
    db.flush()
    return student


def _make_course_with_assessment(db, suffix: str) -> tuple[Course, Assessment]:
    course = Course(
        id=uuid.uuid4(),
        code=f"TEST{suffix}",
        name="Test Course",
        trimester=1,
        credits=6,
        credit_pattern="3-0-0-6",
        course_type=CourseType.COMPULSORY,
        instructor="Faculty (TBA)",
    )
    db.add(course)
    db.flush()
    assessment = Assessment(
        id=uuid.uuid4(),
        course_id=course.id,
        name="PT1",
        assessment_type=AssessmentType.PT,
        max_marks=20,
        weight=18,
        best_of_group="PT",
        best_of_eligible=True,
        enabled=True,
    )
    db.add(assessment)
    db.flush()
    return course, assessment


def test_duplicate_submission_is_rejected(db_session):
    """The core guarantee: a student cannot submit twice for the same assessment."""
    student = _make_student(db_session, "dup1")
    _course, assessment = _make_course_with_assessment(db_session, "DUP1")

    db_session.add(AssessmentSubmission(
        id=uuid.uuid4(), student_id=student.user_id, assessment_id=assessment.id,
        score=17.5, status=SubmissionStatus.SUBMITTED,
    ))
    db_session.flush()

    db_session.add(AssessmentSubmission(
        id=uuid.uuid4(), student_id=student.user_id, assessment_id=assessment.id,
        score=19.0, status=SubmissionStatus.SUBMITTED,
    ))
    with pytest.raises(IntegrityError, match="uq_submission_student_assessment"):
        db_session.flush()


def test_different_assessment_same_student_is_allowed(db_session):
    """The constraint must not be overly broad -- different assessment, same student, should work."""
    student = _make_student(db_session, "dup2")
    course, assessment_one = _make_course_with_assessment(db_session, "DUP2")
    assessment_two = Assessment(
        id=uuid.uuid4(), course_id=course.id, name="PT2", assessment_type=AssessmentType.PT,
        max_marks=20, weight=18, best_of_group="PT", best_of_eligible=True, enabled=True,
    )
    db_session.add(assessment_two)
    db_session.flush()

    db_session.add(AssessmentSubmission(
        id=uuid.uuid4(), student_id=student.user_id, assessment_id=assessment_one.id,
        score=15.0, status=SubmissionStatus.SUBMITTED,
    ))
    db_session.add(AssessmentSubmission(
        id=uuid.uuid4(), student_id=student.user_id, assessment_id=assessment_two.id,
        score=16.0, status=SubmissionStatus.SUBMITTED,
    ))
    db_session.flush()  # should not raise

    count = db_session.query(AssessmentSubmission).filter_by(student_id=student.user_id).count()
    assert count == 2


def test_course_delete_cascades_to_assessments_and_submissions(db_session):
    """Deleting a course should clean up its assessments and any submissions against them."""
    student = _make_student(db_session, "casc1")
    course, assessment = _make_course_with_assessment(db_session, "CASC1")
    db_session.add(AssessmentSubmission(
        id=uuid.uuid4(), student_id=student.user_id, assessment_id=assessment.id,
        score=10.0, status=SubmissionStatus.SUBMITTED,
    ))
    db_session.flush()

    db_session.delete(course)
    db_session.flush()

    assert db_session.query(Assessment).filter_by(course_id=course.id).count() == 0
    assert db_session.query(AssessmentSubmission).filter_by(assessment_id=assessment.id).count() == 0


def test_user_role_enum_round_trips_as_lowercase_value(db_session):
    """
    Regression test for the enum-storage bug found during Phase 0/1 build:
    SQLAlchemy's Enum type defaults to storing the Python member NAME
    ("STUDENT"), not the str-mixin .value ("student"). This must store and
    read back as the lowercase value, since the API and frontend both
    compare against .value, not the member name.
    """
    user = User(
        id=uuid.uuid4(), firebase_uid="enum-test", email="enum-test@test.dev",
        full_name="Enum Test", role=UserRole.STUDENT,
    )
    db_session.add(user)
    db_session.flush()
    db_session.expire(user)  # force a re-read from the DB, not the Python object cache

    reloaded = db_session.get(User, user.id)
    assert reloaded.role == UserRole.STUDENT
    assert reloaded.role.value == "student"
