from .base import *  # noqa: F403
from .base import HAYAT, env

DEBUG = False
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS")
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS")

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

HAYAT["ENFORCE_MFA"] = env.bool("HAYAT_ENFORCE_MFA", default=True)
HAYAT["CATALOG_INCLUDE_SYNTHETIC"] = env.bool("HAYAT_CATALOG_INCLUDE_SYNTHETIC", default=False)

EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.smtp.EmailBackend")

# ---- Uploads: ClamAV, fail-closed (SECURITY_MODEL §7). Never released unscanned. ----
HAYAT["MALWARE_SCANNER"] = env("HAYAT_MALWARE_SCANNER",
                               default="apps.documents.scanning.ClamAVScanner")
HAYAT["SCAN_FAIL_MODE"] = "closed"

# ---- Messaging: no real provider until the owner chooses one (no pretend delivery). ----
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="no-reply@localhost")
HAYAT["SMS_PROVIDER"] = env("HAYAT_SMS_PROVIDER",
                            default="apps.notifications.sms.NotConfiguredSmsProvider")
HAYAT["EMAIL_PROVIDER"] = env("HAYAT_EMAIL_PROVIDER", default=(
    "apps.notifications.providers.DjangoEmailProvider" if EMAIL_HOST
    else "apps.notifications.providers.NotConfiguredEmailProvider"))
HAYAT["MESSAGE_DISPATCH"] = env("HAYAT_MESSAGE_DISPATCH", default="celery")

_DEV_ONLY = {"apps.documents.scanning.NoopMalwareScanner",
             "apps.notifications.sms.ConsoleSmsProvider"}
if {HAYAT["MALWARE_SCANNER"], HAYAT["SMS_PROVIDER"]} & _DEV_ONLY:
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured("Development-only scanner/SMS provider configured in production.")
