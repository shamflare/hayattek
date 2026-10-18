from .base import *  # noqa: F403
from .base import env

DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "10.0.2.2", "0.0.0.0", "*"]  # noqa: S104
CSRF_TRUSTED_ORIGINS = env.list(
    "CSRF_TRUSTED_ORIGINS", default=["http://localhost:3100", "http://127.0.0.1:3100"]
)
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# CORS for the Expo web preview (apps/mobile on :8081) — DEV ONLY.
# Native apps do not need CORS and production keeps CORS closed (SECURITY_MODEL §8).
from corsheaders.defaults import default_headers  # noqa: E402

INSTALLED_APPS = [*INSTALLED_APPS, "corsheaders"]  # noqa: F405
MIDDLEWARE = ["corsheaders.middleware.CorsMiddleware", *MIDDLEWARE]  # noqa: F405
CORS_ALLOWED_ORIGINS = ["http://localhost:8081", "http://127.0.0.1:8081"]
CORS_ALLOW_CREDENTIALS = False  # the mobile client authenticates with a Token header, not cookies
CORS_ALLOW_HEADERS = (*default_headers, "x-hayat-membership")
