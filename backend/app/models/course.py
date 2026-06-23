"""
courses: catalog of offerings, ported from legacy-v1/courses.json.
semesters: one row per trimester instance, owns the portal-freeze window.
assessments: individual gradeable components within a course
             (replaces the JSON-file-driven assessment-rules.json /
             course-assessments.json from v1 with real, admin-editable rows).
"""
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import AssessmentType, CourseType


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    trimester: Mapped[int] = mapped_column(Integer, nullable=False)
    credits: Mapped[int] = mapped_column(Integer, nullable=False)
    credit_pattern: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    course_type: Mapped[CourseType] = mapped_column(
        Enum(CourseType, name="course_type", values_callable=lambda e: [m.value for m in e]),
        nullable=False, default=CourseType.COMPULSORY,
    )
    instructor: Mapped[str] = mapped_column(String(255), nullable=False, default="Faculty (TBA)")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    assessments: Mapped[list["Assessment"]] = relationship(back_populates="course", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Course {self.code}>"


class Semester(Base):
    __tablename__ = "semesters"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trimester_number: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    start_date: Mapped[date | None] = mapped_column(nullable=True)
    end_date: Mapped[date | None] = mapped_column(nullable=True)

    # Portal freeze window (migration plan Phase 3.3). Submissions are only
    # accepted when now() is between freeze_start and freeze_end AND
    # is_frozen is False. Admin can force is_frozen True to override early.
    is_frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    freeze_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    freeze_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<Semester T{self.trimester_number} frozen={self.is_frozen}>"


class Assessment(Base):
    __tablename__ = "assessments"
    __table_args__ = (
        UniqueConstraint("course_id", "name", name="uq_assessment_course_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    assessment_type: Mapped[AssessmentType] = mapped_column(
        Enum(AssessmentType, name="assessment_type", values_callable=lambda e: [m.value for m in e]),
        nullable=False, default=AssessmentType.OTHER,
    )
    max_marks: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False, default=100)
    weight: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    best_of_group: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    best_of_eligible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped["Course"] = relationship(back_populates="assessments")

    def __repr__(self) -> str:
        return f"<Assessment {self.course_id}:{self.name}>"
