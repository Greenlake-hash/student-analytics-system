"""
Submission + verification pipeline API.

State machine (migration plan, "Verification Pipeline"):

    DRAFT -> SUBMITTED -> PENDING_VERIFICATION -> APPROVED -> PUBLISHED
                                                -> REJECTED -> (resubmit -> SUBMITTED)

Only APPROVED (or PUBLISHED) submissions are countable by the grading
engine (see app/services/grading.py's COUNTABLE_SUBMISSION_STATUSES).

Duplicate prevention (migration plan, "Duplicate Prevention"):
    - Database level: UNIQUE(student_id, assessment_id) on
      assessment_submissions (Phase 1, already enforced, see
      tests/test_schema_guarantees.py).
    - API level (this file): POST /submissions checks for an existing row
      FIRST and returns 409 with a clear message rather than letting the
      database reject it -- a 500 from an IntegrityError is a worse user
      experience and leaks implementation detail. The 409 response tells
      the frontend to offer "Request Update" (PATCH the existing
      submission) instead of silently retrying the POST.
    - Frontend level: Phase 4, disables the submit button once a
      submission is known to exist (reads from GET /submissions/mine).

Audit logging: every state transition calls record_audit_log() with the
before/after status, per the migration plan's audit logging requirement.
"""
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import CurrentUser, require_role, require_student_profile
from app.models import Assessment, AssessmentSubmission, Semester, Student, VerificationRequest
from app.models.enums import AuditAction, SubmissionStatus, UserRole, VerificationStatus
from app.schemas.submission import (
    SubmissionCreate,
    SubmissionRead,
    SubmissionWithVerificationRead,
    VerificationDecision,
    VerificationRequestRead,
)
from app.services.audit import record_audit_log

router = APIRouter(tags=["submissions"])


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _assert_portal_not_frozen(db: Session, trimester: int) -> None:
    """
    Portal freeze check (migration plan Phase 3.3): if a semester is
    frozen, students cannot create or edit submissions for courses in
    that trimester. Admin actions (approve/reject) are NOT blocked by
    freeze -- freezing stops new data entry, not the verification of data
    already in the pipeline.
    """
    semester = db.query(Semester).filter(Semester.trimester_number == trimester).one_or_none()
    if semester is not None and semester.is_frozen:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"Trimester {trimester}'s submission portal is frozen. Contact an admin to request an override.",
        )


def _get_assessment_or_404(db: Session, assessment_id: uuid.UUID) -> Assessment:
    assessment = db.get(Assessment, assessment_id)
    if assessment is None or not assessment.enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found.")
    return assessment


def _get_own_submission_or_404(db: Session, student: Student, submission_id: uuid.UUID) -> AssessmentSubmission:
    submission = db.get(AssessmentSubmission, submission_id)
    if submission is None or submission.student_id != student.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found.")
    return submission


# ---------------------------------------------------------------------------
# Student-facing endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/submissions",
    response_model=SubmissionRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role(UserRole.STUDENT))],
)
def create_submission(
    payload: SubmissionCreate,
    request: Request,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
) -> AssessmentSubmission:
    student = require_student_profile(current_user, db)
    assessment = _get_assessment_or_404(db, payload.assessment_id)
    _assert_portal_not_frozen(db, assessment.course.trimester)

    if float(payload.score) > float(assessment.max_marks):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Score {payload.score} exceeds this assessment's maximum of {assessment.max_marks}.",
        )

    # API-level duplicate check -- see module docstring. This is a
    # convenience layer; the UNIQUE constraint is the real guarantee and
    # still applies even if two requests race past this check.
    existing = db.query(AssessmentSubmission).filter(
        AssessmentSubmission.student_id == student.user_id,
        AssessmentSubmission.assessment_id == payload.assessment_id,
    ).one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already submitted marks for this assessment. Use 'Request Update' to revise it instead.",
        )

    submission = AssessmentSubmission(
        id=uuid.uuid4(),
        student_id=student.user_id,
        assessment_id=payload.assessment_id,
        score=payload.score,
        status=SubmissionStatus.SUBMITTED,
        submitted_at=datetime.now(UTC),
    )
    db.add(submission)
    db.flush()

    record_audit_log(
        db, user_id=current_user.id, action=AuditAction.CREATED,
        entity_type="assessment_submission", entity_id=submission.id,
        after={"score": payload.score, "status": submission.status.value},
        ip_address=_client_ip(request),
    )
    db.commit()
    db.refresh(submission)
    return submission


@router.get("/submissions/mine", response_model=list[SubmissionRead])
def list_my_submissions(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
) -> list[AssessmentSubmission]:
    student = require_student_profile(current_user, db)
    return (
        db.query(AssessmentSubmission)
        .filter(AssessmentSubmission.student_id == student.user_id)
        .order_by(AssessmentSubmission.created_at.desc())
        .all()
    )


@router.post(
    "/submissions/{submission_id}/request-update",
    response_model=SubmissionRead,
    dependencies=[Depends(require_role(UserRole.STUDENT))],
)
def request_submission_update(
    submission_id: uuid.UUID,
    payload: SubmissionCreate,
    request: Request,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
) -> AssessmentSubmission:
    """
    The "Request Update" path the 409 response on POST /submissions points
    to. Only allowed while the submission hasn't yet been approved --
    once APPROVED, a correction must go through an admin
    (Phase 3+: a dedicated correction-request flow), since the score may
    already be reflected in published statistics.
    """
    student = require_student_profile(current_user, db)
    submission = _get_own_submission_or_404(db, student, submission_id)
    assessment = _get_assessment_or_404(db, submission.assessment_id)
    _assert_portal_not_frozen(db, assessment.course.trimester)

    if submission.assessment_id != payload.assessment_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="assessment_id in the request body must match the submission being updated.",
        )
    if submission.status in (SubmissionStatus.APPROVED, SubmissionStatus.PUBLISHED):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This submission is already {submission.status.value} and can no longer be self-updated. Contact an admin.",
        )
    if float(payload.score) > float(assessment.max_marks):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Score {payload.score} exceeds this assessment's maximum of {assessment.max_marks}.",
        )

    before = {"score": float(submission.score) if submission.score is not None else None, "status": submission.status.value}
    submission.score = payload.score
    submission.status = SubmissionStatus.SUBMITTED  # any prior rejection is cleared by resubmission
    submission.submitted_at = datetime.now(UTC)
    db.flush()

    record_audit_log(
        db, user_id=current_user.id, action=AuditAction.UPDATED,
        entity_type="assessment_submission", entity_id=submission.id,
        before=before, after={"score": payload.score, "status": submission.status.value},
        ip_address=_client_ip(request),
    )
    db.commit()
    db.refresh(submission)
    return submission


@router.post(
    "/submissions/{submission_id}/submit-for-verification",
    response_model=VerificationRequestRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role(UserRole.STUDENT))],
)
def submit_for_verification(
    submission_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
) -> VerificationRequest:
    """Moves a SUBMITTED submission into the PENDING_VERIFICATION queue an admin will review."""
    student = require_student_profile(current_user, db)
    submission = _get_own_submission_or_404(db, student, submission_id)

    if submission.status != SubmissionStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Only a SUBMITTED submission can be sent for verification (current status: {submission.status.value}).",
        )

    before_status = submission.status.value
    submission.status = SubmissionStatus.PENDING_VERIFICATION
    verification = VerificationRequest(
        id=uuid.uuid4(),
        submission_id=submission.id,
        requested_by=current_user.id,
        status=VerificationStatus.PENDING,
    )
    db.add(verification)
    db.flush()

    record_audit_log(
        db, user_id=current_user.id, action=AuditAction.UPDATED,
        entity_type="assessment_submission", entity_id=submission.id,
        before={"status": before_status}, after={"status": submission.status.value},
        ip_address=_client_ip(request),
    )
    db.commit()
    db.refresh(verification)
    return verification


# ---------------------------------------------------------------------------
# Admin-facing endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/admin/verification-queue",
    response_model=list[SubmissionWithVerificationRead],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)
def list_verification_queue(db: Session = Depends(get_db)) -> list[dict]:
    """All submissions currently PENDING_VERIFICATION, oldest first."""
    submissions = (
        db.query(AssessmentSubmission)
        .filter(AssessmentSubmission.status == SubmissionStatus.PENDING_VERIFICATION)
        .order_by(AssessmentSubmission.updated_at.asc())
        .all()
    )
    results = []
    for submission in submissions:
        latest = (
            db.query(VerificationRequest)
            .filter(VerificationRequest.submission_id == submission.id)
            .order_by(VerificationRequest.created_at.desc())
            .first()
        )
        item = SubmissionRead.model_validate(submission).model_dump()
        item["latest_verification"] = VerificationRequestRead.model_validate(latest).model_dump() if latest else None
        results.append(item)
    return results


@router.post(
    "/admin/verification-requests/{verification_request_id}/approve",
    response_model=SubmissionRead,
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)
def approve_verification_request(
    verification_request_id: uuid.UUID,
    payload: VerificationDecision,
    request: Request,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
) -> AssessmentSubmission:
    verification = db.get(VerificationRequest, verification_request_id)
    if verification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Verification request not found.")
    if verification.status != VerificationStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This verification request was already {verification.status.value}.",
        )

    submission = db.get(AssessmentSubmission, verification.submission_id)
    before_submission_status = submission.status.value

    verification.status = VerificationStatus.APPROVED
    verification.reviewer_id = current_user.id
    verification.reviewed_at = datetime.now(UTC)
    verification.notes = payload.notes
    submission.status = SubmissionStatus.APPROVED
    db.flush()

    record_audit_log(
        db, user_id=current_user.id, action=AuditAction.APPROVED,
        entity_type="verification_request", entity_id=verification.id,
        before={"status": "pending"}, after={"status": "approved", "notes": payload.notes},
        ip_address=_client_ip(request),
    )
    record_audit_log(
        db, user_id=current_user.id, action=AuditAction.UPDATED,
        entity_type="assessment_submission", entity_id=submission.id,
        before={"status": before_submission_status}, after={"status": submission.status.value},
        ip_address=_client_ip(request),
    )
    db.commit()
    db.refresh(submission)
    return submission


@router.post(
    "/admin/verification-requests/{verification_request_id}/reject",
    response_model=SubmissionRead,
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)
def reject_verification_request(
    verification_request_id: uuid.UUID,
    payload: VerificationDecision,
    request: Request,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
) -> AssessmentSubmission:
    verification = db.get(VerificationRequest, verification_request_id)
    if verification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Verification request not found.")
    if verification.status != VerificationStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This verification request was already {verification.status.value}.",
        )
    if not payload.notes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A rejection requires a note explaining what needs to change.",
        )

    submission = db.get(AssessmentSubmission, verification.submission_id)
    before_submission_status = submission.status.value

    verification.status = VerificationStatus.REJECTED
    verification.reviewer_id = current_user.id
    verification.reviewed_at = datetime.now(UTC)
    verification.notes = payload.notes
    submission.status = SubmissionStatus.REJECTED
    db.flush()

    record_audit_log(
        db, user_id=current_user.id, action=AuditAction.REJECTED,
        entity_type="verification_request", entity_id=verification.id,
        before={"status": "pending"}, after={"status": "rejected", "notes": payload.notes},
        ip_address=_client_ip(request),
    )
    record_audit_log(
        db, user_id=current_user.id, action=AuditAction.UPDATED,
        entity_type="assessment_submission", entity_id=submission.id,
        before={"status": before_submission_status}, after={"status": submission.status.value},
        ip_address=_client_ip(request),
    )
    db.commit()
    db.refresh(submission)
    return submission
