"""
Audit logging service.

A thin, explicit helper rather than a clever decorator/middleware that
auto-wraps every mutating route: explicit calls at the point of mutation
are easier to read, easier to test, and don't risk logging the wrong
before/after values when a route does something non-obvious (e.g. the
verification approve endpoint mutates BOTH the submission and the
verification_request row in one logical action).

This trades a small amount of repetition (one call per mutation site) for
auditability of the audit log itself -- you can read any route function
top to bottom and see exactly what gets logged, without chasing through
decorator/middleware indirection.
"""
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog
from app.models.enums import AuditAction


def record_audit_log(
    db: Session,
    *,
    user_id: uuid.UUID | None,
    action: AuditAction,
    entity_type: str,
    entity_id: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """
    Adds an AuditLog row to the session (does NOT commit -- the caller's
    transaction boundary is the source of truth, so a failed mutation and
    its audit log entry roll back together, never one without the other).
    """
    entry = AuditLog(
        id=uuid.uuid4(),
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        before_value=before,
        after_value=after,
        ip_address=ip_address,
    )
    db.add(entry)
    return entry
