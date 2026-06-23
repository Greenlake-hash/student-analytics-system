"""
Authentication and RBAC dependencies for FastAPI routes.

Two modes, switched by settings.firebase_enabled:

REAL MODE (firebase_enabled=true):
    Reads `Authorization: Bearer <firebase-id-token>`, verifies it against
    Firebase, and resolves it to a local `users` row by firebase_uid --
    creating one on first sign-in (just-in-time provisioning) so there's no
    separate "register" step. New users default to UserRole.STUDENT; an
    existing admin must promote them via the admin user-management routes
    (Phase 3+) -- nobody can grant themselves admin through this path.

DEV MODE (firebase_enabled=false, the default until a Firebase project
exists):
    Reads `X-Dev-User-Email` instead of a real bearer token and resolves
    directly to a local user by email, with NO signature verification at
    all. This exists so Phases 2-3 (submission pipeline, verification
    workflow, RBAC-gated routes) can be built and tested end-to-end before
    Firebase is set up, without writing throwaway code that gets deleted
    later -- it's the same dependency functions, same RBAC guards, same
    route code either way.

    DEV MODE MUST NEVER RUN IN PRODUCTION. The settings.app_env guard below
    raises at import time if firebase_enabled=false and app_env=production,
    so this can't ship by accident.
"""
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from firebase_admin import auth as firebase_auth
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.firebase import verify_id_token
from app.models import Student, User
from app.models.enums import UserRole

settings = get_settings()

if not settings.firebase_enabled and settings.app_env == "production":
    raise RuntimeError(
        "firebase_enabled=false (dev auth mode) cannot be used with app_env=production. "
        "Set FIREBASE_ENABLED=true and configure real Firebase credentials before deploying."
    )


def _get_or_create_user_from_firebase(db: Session, decoded_token: dict) -> User:
    firebase_uid = decoded_token["uid"]
    user = db.query(User).filter(User.firebase_uid == firebase_uid).one_or_none()
    if user is not None:
        return user

    email = decoded_token.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Firebase account has no email address; cannot provision a user.",
        )

    user = User(
        firebase_uid=firebase_uid,
        email=email,
        full_name=decoded_token.get("name", email.split("@")[0]),
        role=UserRole.STUDENT,  # new sign-ins are always students; admin is granted, never self-assigned
    )
    db.add(user)
    db.flush()
    return user


def _get_current_user_real(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header. Expected: Bearer <firebase-id-token>",
            headers={"WWW-Authenticate": "Bearer"},
        )
    id_token = authorization.removeprefix("Bearer ").strip()

    try:
        decoded = verify_id_token(id_token)
    except firebase_auth.CertificateFetchError as exc:
        # Firebase's public-key servers are unreachable -- this is OUR
        # infrastructure failing to verify, not evidence the token is bad.
        # Surfacing this as 401 would tell a legitimately-logged-in user
        # their session is invalid when it isn't.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to reach the authentication service. Please try again shortly.",
        ) from exc
    except (
        firebase_auth.ExpiredIdTokenError,
        firebase_auth.RevokedIdTokenError,
        firebase_auth.InvalidIdTokenError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except Exception as exc:
        # Catch-all for anything firebase_admin's API doesn't document as a
        # named exception -- still treated as unauthenticated, but logged
        # distinctly in spirit from the cases above since it's unexpected.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    return _get_or_create_user_from_firebase(db, decoded)


def _get_current_user_dev(
    x_dev_user_email: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> User:
    if not x_dev_user_email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "DEV AUTH MODE: missing X-Dev-User-Email header. "
                "Set FIREBASE_ENABLED=true for real auth, or pass this header "
                "(e.g. 'admin@spad.local' from the seed script) to act as that user."
            ),
        )
    user = db.query(User).filter(User.email == x_dev_user_email).one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"DEV AUTH MODE: no user with email '{x_dev_user_email}' exists. "
                   f"Run `python -m app.seed.run` or create one first.",
        )
    return user


def get_current_user(
    db: Session = Depends(get_db),
    authorization: Annotated[str | None, Header()] = None,
    x_dev_user_email: Annotated[str | None, Header()] = None,
) -> User:
    """
    The single dependency every protected route should use. Delegates to
    the real or dev implementation based on settings.firebase_enabled, so
    route code never has to know or care which mode is active.
    """
    if settings.firebase_enabled:
        return _get_current_user_real(authorization=authorization, db=db)
    return _get_current_user_dev(x_dev_user_email=x_dev_user_email, db=db)


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(*allowed_roles: UserRole):
    """
    Dependency factory for RBAC. Usage:

        @router.get("/admin/verification-queue")
        def queue(user: User = Depends(require_role(UserRole.ADMIN))):
            ...

    Raises 403 (not 401) when the user IS authenticated but lacks the
    required role -- the two failure modes are different and the frontend
    should treat them differently (401 -> send to login, 403 -> show
    "you don't have access").
    """
    def _check(current_user: CurrentUser) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires role: {', '.join(r.value for r in allowed_roles)}.",
            )
        return current_user
    return _check


def require_student_profile(current_user: CurrentUser, db: Session = Depends(get_db)) -> "Student":
    """
    For routes that need the Student row, not just the User row (e.g.
    submitting marks needs roll_number/current_trimester). Separate from
    require_role(STUDENT) because an admin acting as themselves never has
    a Student row, and a route that needs both the role check AND the
    profile should compose require_role(UserRole.STUDENT) first.
    """
    student = db.query(Student).filter(Student.user_id == current_user.id).one_or_none()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No student profile found for this account.",
        )
    return student
