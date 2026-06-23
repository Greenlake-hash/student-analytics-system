"""
Pydantic request/response schemas for the submission and verification API.

Kept separate from the SQLAlchemy models (app/models/) deliberately: the
API's public shape (what a student is allowed to send, what a response
looks like) should be free to diverge from the storage shape over time
without one forcing a change in the other.
"""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models.enums import SubmissionStatus, VerificationStatus


class SubmissionCreate(BaseModel):
    """What a student sends to submit (or update a draft of) a mark."""
    assessment_id: UUID
    score: float = Field(ge=0, description="Raw score; validated against the assessment's max_marks server-side, since that's the authoritative source, not client input.")

    @field_validator("score")
    @classmethod
    def score_must_be_finite(cls, value: float) -> float:
        if value != value or value in (float("inf"), float("-inf")):  # NaN/inf guard
            raise ValueError("score must be a finite number")
        return value


class SubmissionRead(BaseModel):
    id: UUID
    student_id: UUID
    assessment_id: UUID
    score: float | None
    status: SubmissionStatus
    submitted_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class VerificationDecision(BaseModel):
    """What an admin sends to approve or reject a pending submission."""
    notes: str | None = Field(default=None, max_length=2000)


class VerificationRequestRead(BaseModel):
    id: UUID
    submission_id: UUID
    requested_by: UUID
    status: VerificationStatus
    reviewer_id: UUID | None
    reviewed_at: datetime | None
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class SubmissionWithVerificationRead(SubmissionRead):
    """Submission plus its most recent verification request, for the admin queue view."""
    latest_verification: VerificationRequestRead | None = None
