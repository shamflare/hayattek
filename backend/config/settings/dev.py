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

# Many local tools (E2E, screenshots) log in from one IP; production keeps 5/min.
from .base import REST_FRAMEWORK  # noqa: E402

REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "DEFAULT_THROTTLE_RATES": {**REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], "login": "60/min"},
}

# OCR: local Tesseract sidecar (`docker compose up -d ocr`), run inline (no dev worker).
from .base import HAYAT  # noqa: E402

HAYAT["OCR_PROVIDER"] = env("HAYAT_OCR_PROVIDER",
                            default="apps.documents.ocr.TesseractHttpOcrProvider")
HAYAT["OCR_INLINE"] = env.bool("HAYAT_OCR_INLINE", default=True)

# Local development runs background tasks inline unless a worker is started explicitly
# (`celery -A config worker --pool=solo` on Windows) and HAYAT_CELERY_EAGER=false.
CELERY_TASK_ALWAYS_EAGER = env.bool("HAYAT_CELERY_EAGER", default=True)

# Private DICOM store: `docker compose up -d orthanc` (127.0.0.1 only). DEV-ONLY credentials.
HAYAT["ORTHANC_URL"] = env("ORTHANC_URL", default="http://127.0.0.1:58042")
HAYAT["ORTHANC_USERNAME"] = env("ORTHANC_USERNAME", default="hayat")
HAYAT["ORTHANC_PASSWORD"] = env("ORTHANC_PASSWORD", default="hayat_orthanc_dev_password")
