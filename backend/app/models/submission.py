"""
assessment_submissions: a student's score for one assessment. The UNIQUE
                         constraint here is the real duplicate-prevention
                         guarantee referenced in the migration plan —
                         API/frontend checks are convenience layers on top
                         of this, not substitutes for it.
verification_requests: one row per review cycle on a submission. A
                        rejected submission that gets resubmitted creates
                        a new verification_requests row rather than
                        mutating the old one, so history is preserved.
audit_logs: generic before/after log for any mutating action, per the
            migration plan's audit logging requirement.
"""
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import AuditAction, SubmissionStatus, VerificationStatus


class AssessmentSubmission(Base):
    __tablename__ = "assessment_submissions"
    __table_args__ = (
        # The actual duplicate-prevention guarantee: one student can have
        # exactly one (current) submission row per assessment.
        UniqueConstraint("student_id", "assessment_id", name="uq_submission_student_assessment"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("students.user_id", ondelete="CASCADE"), nullable=False, index=True)
    assessment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False, index=True)
    score: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    status: Mapped[SubmissionStatus] = mapped_column(
        Enum(SubmissionStatus, name="submission_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False, default=SubmissionStatus.DRAFT, index=True,
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    verification_requests: Mapped[list["VerificationRequest"]] = relationship(back_populates="submission", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Submission {self.student_id}:{self.assessment_id} {self.status.value}>"


class VerificationRequest(Base):
    __tablename__ = "verification_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    submission_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assessment_submissions.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status: Mapped[VerificationStatus] = mapped_column(
        Enum(VerificationStatus, name="verification_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False, default=VerificationStatus.PENDING, index=True,
    )
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    submission: Mapped["AssessmentSubmission"] = relationship(back_populates="verification_requests")

    def __repr__(self) -> str:
        return f"<VerificationRequest {self.submission_id} {self.status.value}>"


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    action: Mapped[AuditAction] = mapped_column(
        Enum(AuditAction, name="audit_action", values_callable=lambda e: [m.value for m in e]),
        nullable=False, index=True,
    )
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    before_value: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    after_value: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    def __repr__(self) -> str:
        return f"<AuditLog {self.action.value} {self.entity_type}:{self.entity_id}>"
