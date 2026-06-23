"""
relative_grading_rules: configurable z-score -> letter grade boundaries
                         per course (defaults match the migration plan's
                         AA/AB/.../F z-boundary table, but are editable).
course_statistics: cached mean/median/mode/stdev for a course, recomputed
                    when the semester is frozen (Phase 3.1). Cached rather
                    than computed on every read because rank/percentile
                    for every student in the course depend on it.
student_results: the materialized output of the relative grading engine
                  for one student in one course — raw score, z-score,
                  letter grade, rank, percentile. This is what the
                  dashboards and exports actually read from.
"""
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

# Default z-score boundaries from the migration plan, Section "Relative Grade
# Formula". Stored as the default for new rows; each course's actual
# boundaries live in relative_grading_rules.z_boundaries and can be edited
# by an admin without a code change.
DEFAULT_Z_BOUNDARIES: dict[str, float] = {
    "AA": 1.5,
    "AB": 1.0,
    "BB": 0.5,
    "BC": 0.0,
    "CC": -0.5,
    "CD": -1.0,
    "DD": -1.5,
    # F is implicitly "below DD" — anything under -1.5
}


class RelativeGradingRule(Base):
    __tablename__ = "relative_grading_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    z_boundaries: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=lambda: dict(DEFAULT_Z_BOUNDARIES))
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self) -> str:
        return f"<RelativeGradingRule {self.course_id} published={self.is_published}>"


class CourseStatistics(Base):
    __tablename__ = "course_statistics"

    course_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True)
    mean: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    median: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    mode: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    stdev: Mapped[float | None] = mapped_column(Numeric(6, 3), nullable=True)
    submission_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<CourseStatistics {self.course_id} mean={self.mean}>"


class StudentResult(Base):
    __tablename__ = "student_results"
    __table_args__ = (
        UniqueConstraint("student_id", "course_id", name="uq_result_student_course"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("students.user_id", ondelete="CASCADE"), nullable=False, index=True)
    course_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    raw_score: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    z_score: Mapped[float | None] = mapped_column(Numeric(6, 3), nullable=True)
    relative_grade: Mapped[str | None] = mapped_column(String(4), nullable=True)
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    percentile: Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:
        return f"<StudentResult {self.student_id}:{self.course_id} {self.relative_grade}>"
