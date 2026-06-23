"""
course_grading_rules: "best N of M" configuration per course + assessment
                       group (e.g. course DA101, group PT, best_of_count 5
                       means the top 5 PT scores count and the rest are
                       dropped from the final percentage).

This is distinct from relative_grading_rules (z-score boundaries) -- this
table governs how a student's *raw course percentage* is computed from
individual assessment scores, which then feeds into the relative grading
engine as the raw_score input.

Ported from legacy-v1's assessment-rules.json `bestOfRules`, which stored
this at the trimester level (all courses in T1-T6 shared one PT bestOf=5
rule). Here it's per-course instead of per-trimester, since admins should
be able to set different best-of policies per course even within the same
trimester (e.g. a lab-heavy course vs. a theory-heavy one).
"""
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.course import Course


class CourseGradingRule(Base):
    __tablename__ = "course_grading_rules"
    __table_args__ = (
        UniqueConstraint("course_id", "best_of_group", name="uq_grading_rule_course_group"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    best_of_group: Mapped[str] = mapped_column(String(32), nullable=False)
    best_of_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    course: Mapped["Course"] = relationship()

    def __repr__(self) -> str:
        return f"<CourseGradingRule {self.course_id}:{self.best_of_group} best_of={self.best_of_count}>"
