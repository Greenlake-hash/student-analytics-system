"""
Firebase Admin SDK initialization.

This module's only job is to initialize the Firebase Admin app exactly
once and expose a `verify_id_token` function. Everything downstream
(app/core/security.py) depends on this function, not on the firebase_admin
package directly -- that's what makes it possible to swap in a fake for
tests without a real Firebase project.

Credential resolution order:
  1. FIREBASE_CREDENTIALS_PATH (a service account JSON file path) -- used
     for local development, where the file lives outside the repo.
  2. FIREBASE_CREDENTIALS_JSON (the service account JSON pasted as a single
     env var) -- used on Render and other platforms without file mounts.
  3. Neither set -> raise clearly at startup, not on the first request.

You won't have either of these until you create a Firebase project
(Console -> Project Settings -> Service Accounts -> Generate new private
key). Until then, the app can still run with FIREBASE_ENABLED=false, which
is the default -- see app/core/security.py for what that unlocks.
"""
import json
from functools import lru_cache

import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials

from app.core.config import get_settings


class FirebaseNotConfiguredError(RuntimeError):
    """Raised when Firebase-dependent code runs without credentials configured."""


@lru_cache
def get_firebase_app() -> firebase_admin.App:
    settings = get_settings()

    if settings.firebase_credentials_path:
        cred = credentials.Certificate(settings.firebase_credentials_path)
    elif settings.firebase_credentials_json:
        cred = credentials.Certificate(json.loads(settings.firebase_credentials_json))
    else:
        raise FirebaseNotConfiguredError(
            "Neither FIREBASE_CREDENTIALS_PATH nor FIREBASE_CREDENTIALS_JSON is set. "
            "Create a Firebase project and a service account key, then set one of these "
            "in backend/.env. See app/core/firebase.py for details."
        )

    return firebase_admin.initialize_app(cred, {"projectId": settings.firebase_project_id} if settings.firebase_project_id else None)


def verify_id_token(id_token: str) -> dict:
    """
    Verifies a Firebase ID token and returns its decoded claims.

    Raises firebase_admin.auth.InvalidIdTokenError (or a subclass) on any
    verification failure -- expired, malformed, wrong project, revoked, etc.
    Callers should not try to distinguish these cases for the end user;
    they all mean "not authenticated."
    """
    app = get_firebase_app()
    return firebase_auth.verify_id_token(id_token, app=app, check_revoked=True)
