"""Base settings shared by every environment.

Secrets and environment-specific values come from environment variables
(see /.env.example). Never commit real secrets.
"""

from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent
REPO_ROOT = BASE_DIR.parent

env = environ.Env()
environ.Env.read_env(REPO_ROOT / ".env", overwrite=False)

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = False
ALLOWED_HOSTS: list[str] = env.list("DJANGO_ALLOWED_HOSTS", default=[])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    # third party
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    # hayat
    "apps.core",
    "apps.accounts",
    "apps.organizations",
    "apps.practitioners",
    "apps.patients",
    "apps.access",
    "apps.clinical",
    "apps.medications",
    "apps.diagnostics",
    "apps.documents",
    "apps.referrals",
    "apps.notifications",
    "apps.audit",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.core.middleware.RequestIdMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {"default": env.db("DATABASE_URL")}
DATABASES["default"]["ATOMIC_REQUESTS"] = False
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---- i18n / time ----
LANGUAGE_CODE = "ar"
LANGUAGES = [("ar", "العربية"), ("en", "English")]
LOCALE_PATHS = [BASE_DIR / "locale"]
USE_I18N = True
USE_TZ = True
TIME_ZONE = "UTC"  # storage is always UTC; display zone below.
HAYAT_DISPLAY_TIME_ZONE = env("HAYAT_DISPLAY_TIME_ZONE", default="Asia/Damascus")

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# ---- Object storage (private S3-compatible bucket) ----
AWS_S3_ENDPOINT_URL = env("S3_ENDPOINT_URL", default=None)
AWS_ACCESS_KEY_ID = env("S3_ACCESS_KEY", default=None)
AWS_SECRET_ACCESS_KEY = env("S3_SECRET_KEY", default=None)
AWS_STORAGE_BUCKET_NAME = env("S3_BUCKET", default="hayat-private")
AWS_S3_REGION_NAME = env("S3_REGION", default="us-east-1")
AWS_S3_SIGNATURE_VERSION = "s3v4"
AWS_S3_ADDRESSING_STYLE = "path"
AWS_DEFAULT_ACL = None
AWS_QUERYSTRING_AUTH = True
AWS_QUERYSTRING_EXPIRE = 60
AWS_S3_FILE_OVERWRITE = False

STORAGES = {
    "default": {"BACKEND": "storages.backends.s3.S3Storage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

# ---- Sessions / CSRF / security ----
SESSION_COOKIE_NAME = "hayat_session"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = int(timedelta(hours=12).total_seconds())
SESSION_SAVE_EVERY_REQUEST = True
CSRF_COOKIE_NAME = "hayat_csrftoken"
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_HEADER_NAME = "HTTP_X_CSRFTOKEN"
CSRF_TRUSTED_ORIGINS: list[str] = env.list("CSRF_TRUSTED_ORIGINS", default=[])
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

# ---- Cache / Celery ----
REDIS_URL = env("REDIS_URL", default="redis://localhost:56379/0")
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
        "KEY_PREFIX": "hayat",
    }
}
CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = None
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_TIME_LIMIT = 300
CELERY_TIMEZONE = "UTC"

# ---- DRF ----
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.accounts.authentication.DeviceTokenAuthentication",
        "apps.accounts.authentication.CsrfEnforcedSessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "120/min",
        "user": "600/min",
        "login": "5/min",
        "otp": "3/10min",
        "card_resolve": "30/min",
        "public_verify": "30/min",
    },
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "HAYAT Healthcare Network API",
    "DESCRIPTION": "REST API shared by the HAYAT web and mobile apps.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": r"/api/v1",
    "ENUM_NAME_OVERRIDES": {},
    "POSTPROCESSING_HOOKS": [
        "drf_spectacular.hooks.postprocess_schema_enums",
    ],
}

# ---- Logging (structured, PHI-free) ----
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {"request_id": {"()": "apps.core.logging.RequestIdFilter"}},
    "formatters": {
        "json": {"()": "apps.core.logging.JsonFormatter"},
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
            "filters": ["request_id"],
        }
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django.request": {"level": "WARNING"},
        "django.db.backends": {"level": "WARNING"},
    },
}

# ---- HAYAT product configuration ----
HAYAT = {
    "BRAND_NAME": env("HAYAT_BRAND_NAME", default="حياة"),
    "BRAND_NAME_EN": env("HAYAT_BRAND_NAME_EN", default="HAYAT"),
    "PUBLIC_BASE_URL": env("HAYAT_PUBLIC_BASE_URL", default="http://localhost:3100"),
    "ENFORCE_MFA": env.bool("HAYAT_ENFORCE_MFA", default=False),
    "HEALTH_NUMBER_DIGITS": 10,
    "MOBILE_TOKEN_TTL_DAYS": 30,
    "IN_PERSON_GRANT_MAX_HOURS": env.int("HAYAT_IN_PERSON_GRANT_MAX_HOURS", default=72),
    "IN_PERSON_GRANT_DEFAULT_HOURS": 24,
    "PATIENT_GRANT_MAX_DAYS": 365,
    "OTP_TTL_MINUTES": 10,
    "UPLOAD_MAX_BYTES": env.int("HAYAT_UPLOAD_MAX_BYTES", default=25 * 1024 * 1024),
    "SMS_PROVIDER": env("HAYAT_SMS_PROVIDER", default="apps.notifications.sms.ConsoleSmsProvider"),
    "MALWARE_SCANNER": env(
        "HAYAT_MALWARE_SCANNER", default="apps.documents.scanning.NoopMalwareScanner"
    ),
    "OCR_PROVIDER": env("HAYAT_OCR_PROVIDER", default="apps.documents.ocr.NullOcrProvider"),
}
