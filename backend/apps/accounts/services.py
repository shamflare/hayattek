from datetime import timedelta

import pyotp
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext as _

from apps.audit import services as audit
from apps.audit.models import AuditOutcome
from apps.core.exceptions import DomainError

from .models import User

MAX_FAILED_LOGINS = 5
LOCK_DURATION = timedelta(minutes=15)
_DUMMY_HASH = make_password("timing-equaliser-not-a-real-password")


class MfaRequired(DomainError):
    status_code = 401
    default_code = "mfa_required"


def authenticate_credentials(request, identifier: str, password: str, otp: str = "") -> User:
    """Verify credentials with lockout and MFA. Raises DomainError with a generic message."""
    invalid = DomainError(_("بيانات الدخول غير صحيحة."), code="invalid_credentials")
    try:
        user = User.objects.get_by_identifier(identifier)
    except User.DoesNotExist:
        # Spend the same time as a real check so accounts cannot be enumerated.
        check_password(password, _DUMMY_HASH)
        audit.record(audit.Action.AUTH_LOGIN_FAILED, request=request,
                     outcome=AuditOutcome.FAILURE, metadata={"reason": "unknown_identifier"})
        raise invalid from None

    if not user.is_active:
        raise invalid
    if user.is_locked:
        raise DomainError(
            _("تم إيقاف الدخول مؤقتاً بسبب محاولات متكررة. حاول بعد ربع ساعة."),
            code="account_locked", status_code=403,
        )

    if not user.check_password(password):
        with transaction.atomic():
            user.failed_login_count += 1
            if user.failed_login_count >= MAX_FAILED_LOGINS:
                user.locked_until = timezone.now() + LOCK_DURATION
                user.failed_login_count = 0
            user.save(update_fields=["failed_login_count", "locked_until", "updated_at"])
            audit.record(audit.Action.AUTH_LOGIN_FAILED, request=request, actor=user,
                         outcome=AuditOutcome.FAILURE, metadata={"reason": "bad_password"})
        raise invalid

    if user.mfa_enabled:
        if not otp:
            raise MfaRequired(_("أدخل رمز التحقق من تطبيق المصادقة."))
        if not verify_totp(user, otp):
            audit.record(audit.Action.AUTH_LOGIN_FAILED, request=request, actor=user,
                         outcome=AuditOutcome.FAILURE, metadata={"reason": "bad_otp"})
            raise DomainError(_("رمز التحقق غير صحيح."), code="invalid_otp")

    if user.failed_login_count or user.locked_until:
        user.failed_login_count = 0
        user.locked_until = None
        user.save(update_fields=["failed_login_count", "locked_until", "updated_at"])
    return user


def verify_totp(user: User, otp: str) -> bool:
    if not user.mfa_secret:
        return False
    return pyotp.TOTP(user.mfa_secret).verify(otp.strip(), valid_window=1)


def begin_mfa_setup(user: User) -> dict:
    secret = pyotp.random_base32()
    user.mfa_secret = secret
    user.mfa_enabled = False
    user.save(update_fields=["mfa_secret", "mfa_enabled", "updated_at"])
    issuer = settings.HAYAT["BRAND_NAME_EN"]
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email or user.phone or str(user.pk),
                                              issuer_name=issuer)
    return {"secret": secret, "otpauth_uri": uri}


def requires_mfa(user: User) -> bool:
    """Clinical and administrative accounts must use MFA when enforcement is on."""
    if not settings.HAYAT["ENFORCE_MFA"] or user.mfa_enabled:
        return False
    return user.is_platform_admin or user.memberships.filter(status="active").exists()
