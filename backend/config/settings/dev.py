from .base import *  # noqa: F403
from .base import env

DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "10.0.2.2", "0.0.0.0", "*"]  # noqa: S104
CSRF_TRUSTED_ORIGINS = env.list(
    "CSRF_TRUSTED_ORIGINS", default=["http://localhost:3100", "http://127.0.0.1:3100"]
)
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
