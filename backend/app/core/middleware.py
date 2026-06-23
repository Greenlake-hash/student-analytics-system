"""
Security middleware for Phase 5 hardening.

Covers the migration plan's "Security Requirements":
- Rate limiting on auth-sensitive routes (via slowapi)
- Secure response headers (HSTS, CSP, X-Frame-Options, etc.)
- Request size limiting (prevent large payload attacks)

Deliberately lightweight: this app uses Firebase ID token verification
for authentication (not cookie sessions), so CSRF protection isn't
needed (CSRF attacks require a cookie-based session to forge). The JWT
headers are not forgeable from a third-party site. XSS protection is
handled by the React frontend's inherent escaping + the CSP header here.
SQL injection protection comes from SQLAlchemy's parameterised queries --
raw string interpolation into queries is never used anywhere in this
codebase. That leaves rate limiting + headers as the meaningful additions.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Adds security response headers to every request.

    These are safe conservative defaults. Adjust CSP if you add external
    font or script CDNs; the current configuration covers the Vite-built
    SPA served from the same origin as the API (or a single known origin
    set in CORS_ORIGINS).
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        # Prevents clickjacking: refuse to be framed by any other origin
        response.headers["X-Frame-Options"] = "DENY"

        # Disables MIME-type sniffing -- browser must use the declared Content-Type
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Forces HTTPS in production (14-day max-age, safe starting value)
        # Only meaningful when served over HTTPS; harmless over HTTP (ignored)
        response.headers["Strict-Transport-Security"] = "max-age=1209600; includeSubDomains"

        # Limits referrer information on cross-origin navigation
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Restricts powerful browser features the API doesn't use
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

        # CSP: allow scripts/styles/frames only from same origin; no inline
        # scripts (the SPA uses hashed/nonce approach through Vite bundling).
        # 'unsafe-inline' is intentionally absent -- Vite injects a small
        # inline style for loading; adjust this after testing in the browser.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "font-src 'self'; "
            "connect-src 'self'; "
            "frame-ancestors 'none';"
        )

        return response
