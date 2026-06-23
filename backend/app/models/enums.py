"""
Shared enum types used across multiple models.

Defined as Python enums and mapped via SQLAlchemy's Enum type, which creates
a real Postgres ENUM type (not a plain varchar with app-level checking only).
"""
import enum


class UserRole(str, enum.Enum):
    STUDENT = "student"
    ADMIN = "admin"


class CourseType(str, enum.Enum):
    COMPULSORY = "Compulsory"
    ELECTIVE = "Elective"


class AssessmentType(str, enum.Enum):
    PT = "PT"
    NPT = "NPT"
    ST = "ST"
    OTHER = "OTHER"


class SubmissionStatus(str, enum.Enum):
    """
    State machine for an assessment_submissions row.

    DRAFT              -> student is still entering the value, not yet submitted
    SUBMITTED           -> student has submitted, awaiting verification queue pickup
    PENDING_VERIFICATION -> an admin has opened/claimed it for review
    APPROVED            -> verified correct; eligible to feed grading calculations
    REJECTED             -> verified incorrect; student must resubmit
    PUBLISHED            -> included in a published, frozen result set
    """
    DRAFT = "draft"
    SUBMITTED = "submitted"
    PENDING_VERIFICATION = "pending_verification"
    APPROVED = "approved"
    REJECTED = "rejected"
    PUBLISHED = "published"


class VerificationStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class AuditAction(str, enum.Enum):
    CREATED = "created"
    UPDATED = "updated"
    DELETED = "deleted"
    APPROVED = "approved"
    REJECTED = "rejected"
    PUBLISHED = "published"
    FROZEN = "frozen"
    UNFROZEN = "unfrozen"
