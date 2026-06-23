"""
Tests for app/core/security.py.

Strategy: test the dev-auth path against the real database (no mocking
needed -- it's just a header-to-user lookup). For the real Firebase path,
mock only `app.core.security.verify_id_token` -- the one function that
actually talks to Google -- so these tests prove the user-provisioning and
RBAC logic is correct without needing a live Firebase project or network
access. A real Firebase integration test (using the Firebase emulator
suite) is a reasonable thing to add once Firebase is actually configured,
but that's a different test, not a substitute for this one.
"""
import uuid
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.core.security import (
    _get_current_user_dev,
    _get_or_create_user_from_firebase,
    require_role,
)
from app.models import User
from app.models.enums import UserRole


# ---------------------------------------------------------------------------
# Dev-mode auth (X-Dev-User-Email header)
# ---------------------------------------------------------------------------

def test_dev_auth_resolves_existing_user(db_session):
    user = User(
        id=uuid.uuid4(), firebase_uid="dev-test-1", email="devtest1@test.dev",
        full_name="Dev Test User", role=UserRole.STUDENT,
    )
    db_session.add(user)
    db_session.flush()

    resolved = _get_current_user_dev(x_dev_user_email="devtest1@test.dev", db=db_session)
    assert resolved.id == user.id
    assert resolved.role == UserRole.STUDENT


def test_dev_auth_rejects_missing_header(db_session):
    with pytest.raises(HTTPException) as exc_info:
        _get_current_user_dev(x_dev_user_email=None, db=db_session)
    assert exc_info.value.status_code == 401


def test_dev_auth_rejects_unknown_email(db_session):
    with pytest.raises(HTTPException) as exc_info:
        _get_current_user_dev(x_dev_user_email="nobody@nowhere.dev", db=db_session)
    assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# Firebase just-in-time user provisioning
# ---------------------------------------------------------------------------

def test_firebase_first_signin_creates_student_user(db_session):
    """A brand new firebase_uid with no matching local user gets provisioned as STUDENT."""
    decoded_token = {"uid": "new-firebase-uid-1", "email": "newuser@test.dev", "name": "New User"}

    user = _get_or_create_user_from_firebase(db_session, decoded_token)
    db_session.flush()

    assert user.firebase_uid == "new-firebase-uid-1"
    assert user.email == "newuser@test.dev"
    assert user.role == UserRole.STUDENT  # never auto-admin, regardless of token claims


def test_firebase_returning_user_is_not_duplicated(db_session):
    """A second sign-in with the same firebase_uid resolves to the SAME row, doesn't create a new one."""
    decoded_token = {"uid": "repeat-uid-1", "email": "repeat@test.dev", "name": "Repeat User"}

    first = _get_or_create_user_from_firebase(db_session, decoded_token)
    db_session.flush()
    second = _get_or_create_user_from_firebase(db_session, decoded_token)
    db_session.flush()

    assert first.id == second.id
    count = db_session.query(User).filter(User.firebase_uid == "repeat-uid-1").count()
    assert count == 1


def test_firebase_token_without_email_is_rejected(db_session):
    """Firebase tokens can theoretically lack email (e.g. phone auth) -- we don't support that yet."""
    decoded_token = {"uid": "no-email-uid", "name": "No Email"}

    with pytest.raises(HTTPException) as exc_info:
        _get_or_create_user_from_firebase(db_session, decoded_token)
    assert exc_info.value.status_code == 400


@patch("app.core.security.verify_id_token")
def test_real_auth_path_with_mocked_firebase_verification(mock_verify, db_session):
    """
    Exercises _get_current_user_real end-to-end with Firebase's actual
    network call mocked out, proving the Authorization-header parsing and
    user resolution work correctly together.
    """
    from app.core.security import _get_current_user_real

    mock_verify.return_value = {"uid": "mocked-uid-1", "email": "mocked@test.dev", "name": "Mocked User"}

    user = _get_current_user_real(authorization="Bearer some-fake-but-well-formed-token", db=db_session)

    assert user.email == "mocked@test.dev"
    mock_verify.assert_called_once_with("some-fake-but-well-formed-token")


def test_real_auth_path_rejects_malformed_header(db_session):
    from app.core.security import _get_current_user_real

    with pytest.raises(HTTPException) as exc_info:
        _get_current_user_real(authorization="NotBearer something", db=db_session)
    assert exc_info.value.status_code == 401


@patch("app.core.security.verify_id_token")
def test_real_auth_path_rejects_invalid_token(mock_verify, db_session):
    from app.core.security import _get_current_user_real

    mock_verify.side_effect = Exception("token expired")

    with pytest.raises(HTTPException) as exc_info:
        _get_current_user_real(authorization="Bearer expired-token", db=db_session)
    assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# RBAC
# ---------------------------------------------------------------------------

def test_require_role_allows_matching_role():
    admin = User(id=uuid.uuid4(), firebase_uid="x", email="a@a.dev", full_name="A", role=UserRole.ADMIN)
    checker = require_role(UserRole.ADMIN)
    result = checker(current_user=admin)
    assert result is admin


def test_require_role_rejects_non_matching_role():
    student = User(id=uuid.uuid4(), firebase_uid="x", email="s@s.dev", full_name="S", role=UserRole.STUDENT)
    checker = require_role(UserRole.ADMIN)
    with pytest.raises(HTTPException) as exc_info:
        checker(current_user=student)
    assert exc_info.value.status_code == 403


def test_require_role_accepts_multiple_allowed_roles():
    student = User(id=uuid.uuid4(), firebase_uid="x", email="s2@s.dev", full_name="S2", role=UserRole.STUDENT)
    checker = require_role(UserRole.ADMIN, UserRole.STUDENT)
    result = checker(current_user=student)
    assert result is student
