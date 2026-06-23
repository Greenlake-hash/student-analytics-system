"""
Import every model here so that `Base.metadata` is fully populated
whenever this package is imported -- this is what Alembic's
`target_metadata` relies on for autogenerate to see the whole schema.

If you add a new model file, import its classes here too.
"""
from app.models.course import Assessment, Course, Semester
from app.models.grading_rule import CourseGradingRule
from app.models.result import CourseStatistics, RelativeGradingRule, StudentResult
from app.models.submission import AssessmentSubmission, AuditLog, VerificationRequest
from app.models.user import Student, User

__all__ = [
    "User",
    "Student",
    "Course",
    "Semester",
    "Assessment",
    "CourseGradingRule",
    "AssessmentSubmission",
    "VerificationRequest",
    "AuditLog",
    "RelativeGradingRule",
    "CourseStatistics",
    "StudentResult",
]
