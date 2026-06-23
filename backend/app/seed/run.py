"""
Seed script: loads legacy-v1 domain data (courses.json, course-assessments.json,
assessment-rules.json) into the new Postgres schema, then generates synthetic
students and submissions so the relative grading engine (Phase 3) has a real
distribution to compute against.

Run from backend/ with the venv active:
    python -m app.seed.run

Idempotent: safe to re-run. It checks for existing rows by natural key
(course code, roll number, etc.) before inserting, so re-running won't
create duplicates -- it'll just report what already exists.

Why synthetic students at all (see migration plan, Risk table):
Z-score relative grading is statistically meaningless with 2-3 real demo
students -- standard deviation on a tiny sample doesn't produce a believable
bell curve. We seed ~25 synthetic students per course with scores drawn from
a normal-ish distribution so the analytics (mean, stdev, percentile, rank)
look and behave like a real cohort. These are clearly marked as synthetic
(email domain demo.local) so they're easy to find and wipe later.
"""
import json
import random
import sys
import uuid
from pathlib import Path

# Allow running as `python -m app.seed.run` from backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import (
    Assessment,
    Course,
    CourseGradingRule,
    Student,
    User,
)
from app.models.enums import AssessmentType, CourseType, UserRole

LEGACY_DIR = Path(__file__).resolve().parents[3] / "legacy-v1"
RNG_SEED = 42  # deterministic re-runs while developing
SYNTHETIC_STUDENTS_PER_COURSE = 25


def load_json(filename: str) -> dict | list:
    path = LEGACY_DIR / filename
    if not path.exists():
        raise FileNotFoundError(
            f"Expected legacy data at {path}. Run this from the spad-v2 repo root "
            f"with legacy-v1/ present (see migration plan Phase 0.3)."
        )
    with open(path) as f:
        return json.load(f)


def normalize_assessment_type(raw_type: str) -> AssessmentType:
    try:
        return AssessmentType(raw_type.upper())
    except ValueError:
        return AssessmentType.OTHER


def seed_courses(db: Session, courses_json: list[dict]) -> dict[str, Course]:
    """Insert courses from courses.json, keyed by code. Returns code -> Course."""
    existing = {c.code: c for c in db.query(Course).all()}
    created = 0
    for entry in courses_json:
        if entry["code"] in existing:
            continue
        course = Course(
            id=uuid.uuid4(),
            code=entry["code"],
            name=entry["name"],
            trimester=entry["trimester"],
            credits=entry["credits"],
            credit_pattern=entry.get("creditPattern", ""),
            course_type=CourseType(entry.get("type", "Compulsory")),
            instructor=entry.get("instructor", "Faculty (TBA)"),
        )
        db.add(course)
        existing[course.code] = course
        created += 1
    db.flush()
    print(f"  courses: {created} created, {len(existing) - created} already existed")
    return existing


def seed_assessments_and_rules(
    db: Session,
    courses_by_code: dict[str, Course],
    course_assessments_json: dict,
    assessment_rules_json: dict,
) -> None:
    """
    For each course, resolve its assessment set from:
      1. A course-specific override in course-assessments.json (e.g. DA105, DA108), or
      2. The trimester-matched _defaults block, or
      3. Skip with a warning if neither applies (shouldn't happen given v1's data).

    Then resolve best-of-N counts from assessment-rules.json's trimester-level
    bestOfRules and store them per-course in course_grading_rules.
    """
    defaults_by_trimester: dict[int, list[dict]] = {}
    for default_set in course_assessments_json.get("_defaults", []):
        for trimester in default_set["appliesTo"]["trimesters"]:
            defaults_by_trimester[trimester] = default_set["assessments"]

    overrides_by_code: dict[str, list[dict]] = {
        code: value["assessments"]
        for code, value in course_assessments_json.items()
        if code not in ("version", "updatedAt", "source", "_defaults") and "assessments" in value
    }

    best_of_by_trimester: dict[int, dict[str, int]] = {}
    for rule in assessment_rules_json.get("rules", []):
        groups = {bor["group"]: bor["bestOf"] for bor in rule.get("bestOfRules", []) if bor.get("enabled", True)}
        for trimester in rule["appliesTo"]["trimesters"]:
            best_of_by_trimester[trimester] = groups

    existing_assessments = {
        (a.course_id, a.name) for a in db.query(Assessment.course_id, Assessment.name).all()
    }
    existing_rules = {
        (r.course_id, r.best_of_group) for r in db.query(CourseGradingRule.course_id, CourseGradingRule.best_of_group).all()
    }

    assessments_created = 0
    rules_created = 0
    skipped_courses = []

    for code, course in courses_by_code.items():
        assessment_defs = overrides_by_code.get(code) or defaults_by_trimester.get(course.trimester)
        if not assessment_defs:
            skipped_courses.append(code)
            continue

        groups_seen_for_course: set[str] = set()
        for definition in assessment_defs:
            key = (course.id, definition["name"])
            if key not in existing_assessments:
                db.add(Assessment(
                    id=uuid.uuid4(),
                    course_id=course.id,
                    name=definition["name"],
                    assessment_type=normalize_assessment_type(definition.get("type", "OTHER")),
                    max_marks=definition["maxMarks"],
                    weight=definition["weight"],
                    best_of_group=definition.get("bestOfGroup", definition.get("type", "")),
                    best_of_eligible=definition.get("bestOfEligible", True),
                    enabled=definition.get("enabled", True),
                ))
                existing_assessments.add(key)
                assessments_created += 1
            groups_seen_for_course.add(definition.get("bestOfGroup", definition.get("type", "")))

        course_best_of = best_of_by_trimester.get(course.trimester, {})
        for group in groups_seen_for_course:
            rule_key = (course.id, group)
            if rule_key in existing_rules:
                continue
            group_size = sum(
                1 for d in assessment_defs
                if d.get("bestOfGroup", d.get("type", "")) == group
            )
            best_of_count = min(course_best_of.get(group, group_size), group_size) or group_size
            db.add(CourseGradingRule(
                id=uuid.uuid4(),
                course_id=course.id,
                best_of_group=group,
                best_of_count=best_of_count,
                enabled=True,
            ))
            existing_rules.add(rule_key)
            rules_created += 1

    db.flush()
    print(f"  assessments: {assessments_created} created")
    print(f"  course_grading_rules: {rules_created} created")
    if skipped_courses:
        print(f"  WARNING: no assessment definitions found for {len(skipped_courses)} course(s): {', '.join(skipped_courses)}")


def seed_admin_user(db: Session) -> User:
    admin = db.query(User).filter(User.email == "admin@spad.local").one_or_none()
    if admin:
        print("  admin user: already exists")
        return admin
    admin = User(
        id=uuid.uuid4(),
        firebase_uid="seed-admin-placeholder",  # replaced with a real Firebase UID in Phase 1.4
        email="admin@spad.local",
        full_name="Demo Admin",
        role=UserRole.ADMIN,
    )
    db.add(admin)
    db.flush()
    print("  admin user: created (admin@spad.local)")
    return admin


def seed_synthetic_students_and_results(db: Session, courses_by_code: dict[str, Course]) -> None:
    """
    Create a synthetic cohort and, for each course, a believable score
    distribution. This does NOT write assessment_submissions row-by-row
    (that's a Phase 2 concern, exercised through the real API); it writes
    directly to student_results as if a verification + freeze cycle already
    ran, purely so Phase 3's analytics have data to display while that
    pipeline is being built.
    """
    rng = random.Random(RNG_SEED)

    existing_rolls = {s.roll_number for s in db.query(Student.roll_number).all()}
    students: list[Student] = []

    if existing_rolls:
        print(f"  synthetic students: {len(existing_rolls)} already exist, skipping generation")
        students = db.query(Student).filter(Student.roll_number.like("DSAI-SYN-%")).all()
    else:
        for i in range(1, SYNTHETIC_STUDENTS_PER_COURSE + 1):
            roll = f"DSAI-SYN-{i:03d}"
            user = User(
                id=uuid.uuid4(),
                firebase_uid=f"seed-synthetic-{i:03d}",
                email=f"student{i:03d}@demo.local",
                full_name=f"Demo Student {i:03d}",
                role=UserRole.STUDENT,
            )
            db.add(user)
            db.flush()  # need user.id before creating the dependent Student row
            student = Student(
                user_id=user.id,
                roll_number=roll,
                program="BSc (Hons.) Data Science & AI",
                current_trimester=rng.choice([1, 2, 3, 4, 5, 6]),
            )
            db.add(student)
            students.append(student)
        db.flush()
        print(f"  synthetic students: {len(students)} created")

    # NOTE: student_results generation (raw_score, z_score, rank, percentile)
    # is intentionally deferred to Phase 3, where it will be produced by the
    # actual relative grading service rather than hand-rolled here -- seeding
    # fake z-scores now would just be numbers we'd have to throw away once
    # the real engine exists. This function stops at creating the student
    # cohort; Phase 2/3 will generate believable submissions and run the real
    # calculation against them.
    print("  student_results: skipped (generated by the Phase 3 grading engine, not the seed script)")


def run() -> None:
    print("Seeding database from legacy-v1 data...")
    db = SessionLocal()
    try:
        courses_json = load_json("courses.json")
        course_assessments_json = load_json("course-assessments.json")
        assessment_rules_json = load_json("assessment-rules.json")

        print("Courses:")
        courses_by_code = seed_courses(db, courses_json)

        print("Assessments and grading rules:")
        seed_assessments_and_rules(db, courses_by_code, course_assessments_json, assessment_rules_json)

        print("Admin user:")
        seed_admin_user(db)

        print("Synthetic cohort:")
        seed_synthetic_students_and_results(db, courses_by_code)

        db.commit()
        print("Done. Database seeded successfully.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run()
