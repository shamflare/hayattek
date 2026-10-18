from __future__ import annotations

import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext as _

from apps.audit import services as audit
from apps.audit.models import AuditOutcome
from apps.core.exceptions import DomainError
from apps.notifications.messaging import delivery_state, send_message
from apps.notifications.models import MessageChannel, MessagePurpose, MessageStatus, NotificationKind
from apps.notifications.services import notify, patient_recipients

from .context import PracticeContext
from .models import (
    ALL_SCOPES,
    AccessGrant,
    AccessRequest,
    AccessRequestStatus,
    GrantMethod,
)

MAX_OTP_ATTEMPTS = 5


def _validate_scopes(scopes: list[str]) -> list[str]:
    cleaned = sorted(set(scopes))
    if not cleaned or not set(cleaned) <= set(ALL_SCOPES):
        raise DomainError(_("حدد نطاق المعلومات المطلوبة."), code="invalid_scopes")
    return cleaned


def _require_clinician(ctx: PracticeContext) -> None:
    if not ctx.is_clinician:
        raise DomainError(_("طلب الوصول متاح للأطباء المعتمدين فقط."), code="forbidden",
                          status_code=403)


@transaction.atomic
def create_grant(*, patient, organization, scopes, method, duration: timedelta, granted_by,
                 practitioner=None, purpose="treatment", attestation="", request=None,
                 ctx=None) -> AccessGrant:
    now = timezone.now()
    grant = AccessGrant.objects.create(
        patient=patient, organization=organization, practitioner=practitioner,
        scopes=_validate_scopes(scopes), method=method, purpose=purpose, starts_at=now,
        expires_at=now + duration, granted_by=granted_by, attestation=attestation[:300],
    )
    audit.record(audit.Action.GRANT_CREATE, request=request, ctx=ctx, actor=granted_by,
                 target=grant, patient_id=patient.pk,
                 metadata={"method": method, "scopes": grant.scopes,
                           "organization_id": str(organization.pk),
                           "hours": int(duration.total_seconds() // 3600)})
    notify(patient_recipients(patient), kind=NotificationKind.ACCESS_GRANTED,
           title=_("تم منح وصول إلى ملفك الطبي"),
           body=_("حصلت %(org)s على وصول مؤقت إلى أجزاء من ملفك. يمكنك مراجعته أو إلغاؤه.")
           % {"org": organization.name},
           link="/app/me/sharing")
    return grant


def grant_in_person(*, ctx: PracticeContext, patient, scopes, hours: int, attestation: str,
                    request=None) -> AccessGrant:
    """ADR-014 method 3: the patient is physically present with card/number."""
    _require_clinician(ctx)
    max_hours = settings.HAYAT["IN_PERSON_GRANT_MAX_HOURS"]
    if not 1 <= hours <= max_hours:
        raise DomainError(_("مدة الوصول الحضوري يجب أن تكون بين ساعة و%(h)s ساعة.")
                          % {"h": max_hours}, code="invalid_duration")
    if len(attestation.strip()) < 5:
        raise DomainError(_("وثّق طريقة التحقق من هوية المريض."), code="attestation_required")
    return create_grant(patient=patient, organization=ctx.organization, scopes=scopes,
                        method=GrantMethod.IN_PERSON, duration=timedelta(hours=hours),
                        granted_by=ctx.user, practitioner=ctx.practitioner,
                        attestation=attestation, request=request, ctx=ctx)


@transaction.atomic
def request_access(*, ctx: PracticeContext, patient, scopes, hours: int, channel: str,
                   note: str = "", request=None) -> AccessRequest:
    """ADR-014 methods 1 & 2: ask the patient in-app, or send an OTP to their phone."""
    _require_clinician(ctx)
    if not 1 <= hours <= settings.HAYAT["PATIENT_GRANT_MAX_DAYS"] * 24:
        raise DomainError(_("مدة غير صالحة."), code="invalid_duration")
    if channel == "otp" and not patient.phone:
        raise DomainError(_("لا يوجد رقم هاتف مسجل للمريض. استخدم التحقق الحضوري."),
                          code="no_phone")
    if channel == "patient_app" and not patient_recipients(patient):
        raise DomainError(_("المريض لا يملك حساباً في التطبيق. استخدم رمز الهاتف أو التحقق "
                            "الحضوري."), code="no_account")

    access_request = AccessRequest.objects.create(
        patient=patient, organization=ctx.organization, practitioner=ctx.practitioner,
        requested_by=ctx.user, scopes=_validate_scopes(scopes), duration_hours=hours,
        note=note[:300], expires_at=timezone.now() + timedelta(hours=24),
    )
    if channel == "otp":
        code = f"{secrets.randbelow(10**6):06d}"
        access_request.otp_hash = make_password(code)
        access_request.otp_expires_at = timezone.now() + timedelta(
            minutes=settings.HAYAT["OTP_TTL_MINUTES"])
        access_request.save(update_fields=["otp_hash", "otp_expires_at", "updated_at"])
        message = send_message(
            channel=MessageChannel.SMS, to=patient.phone, purpose=MessagePurpose.OTP,
            body=_("%(brand)s: رمز السماح لـ %(org)s بالاطلاع على ملفك هو %(code)s. لا تشاركه "
                   "إلا مع طبيبك.") % {"brand": settings.HAYAT["BRAND_NAME"],
                                       "org": ctx.organization.name, "code": code},
            idempotency_key=f"otp:{access_request.pk}",
        )
        if message.status == MessageStatus.SUPPRESSED:
            # Rolls back the request: no code exists that nobody received.
            raise DomainError(_("أُرسلت رموز كثيرة إلى هذا الرقم مؤخراً. انتظر قليلاً أو استخدم "
                                "التحقق الحضوري."), code="sms_rate_limited", status_code=429)
        # Honest delivery state for the API (never the code itself): see AccessRequestSerializer.
        access_request.delivery = delivery_state(message)
    else:
        practitioner_name = ctx.practitioner.display_name if ctx.practitioner else ""
        notify(patient_recipients(patient), kind=NotificationKind.ACCESS_REQUEST,
               title=_("طلب اطلاع على ملفك الطبي"),
               body=_("%(doc)s من %(org)s يطلب الاطلاع على ملفك.")
               % {"doc": practitioner_name, "org": ctx.organization.name},
               link="/app/me/sharing", data={"request_id": str(access_request.pk)})
    audit.record(audit.Action.ACCESS_REQUEST, request=request, ctx=ctx, target=access_request,
                 patient_id=patient.pk, metadata={"channel": channel,
                                                  "scopes": access_request.scopes})
    return access_request


def verify_otp(*, ctx: PracticeContext, access_request: AccessRequest, code: str,
               request=None) -> AccessGrant:
    """Check the code the patient read out. Failed attempts are committed before raising."""
    invalid = DomainError(_("الرمز غير صحيح أو منتهي الصلاحية."), code="invalid_otp")
    with transaction.atomic():
        access_request = AccessRequest.objects.select_for_update().get(pk=access_request.pk)
        if (access_request.status != AccessRequestStatus.PENDING or not access_request.otp_hash
                or access_request.organization_id != ctx.organization.pk):
            raise invalid
        if access_request.otp_attempts >= MAX_OTP_ATTEMPTS:
            raise DomainError(_("تجاوزت عدد المحاولات. اطلب رمزاً جديداً."), code="otp_locked")
        if access_request.otp_expires_at < timezone.now():
            _close_request(access_request, AccessRequestStatus.EXPIRED, None)
        elif check_password(code.strip(), access_request.otp_hash):
            grant = create_grant(
                patient=access_request.patient, organization=access_request.organization,
                practitioner=access_request.practitioner, scopes=access_request.scopes,
                method=GrantMethod.OTP, duration=timedelta(hours=access_request.duration_hours),
                granted_by=None, request=request, ctx=ctx,
            )
            _close_request(access_request, AccessRequestStatus.APPROVED, None, grant)
            return grant
        else:
            access_request.otp_attempts += 1
            access_request.save(update_fields=["otp_attempts", "updated_at"])
            audit.record(audit.Action.ACCESS_DECISION, request=request, ctx=ctx,
                         target=access_request, patient_id=access_request.patient_id,
                         outcome=AuditOutcome.DENIED, metadata={"reason": "bad_otp"})
    raise invalid


def _close_request(access_request, status, decided_by, grant=None):
    access_request.status = status
    access_request.decided_at = timezone.now()
    access_request.decided_by = decided_by
    access_request.grant = grant
    access_request.otp_hash = ""
    access_request.save(update_fields=["status", "decided_at", "decided_by", "grant",
                                       "otp_hash", "updated_at"])


@transaction.atomic
def patient_decide(*, user, access_request: AccessRequest, approve: bool,
                   scopes: list[str] | None = None, request=None) -> AccessGrant | None:
    access_request = AccessRequest.objects.select_for_update().get(pk=access_request.pk)
    if access_request.status != AccessRequestStatus.PENDING:
        raise DomainError(_("تمت معالجة هذا الطلب مسبقاً."), code="already_decided")
    if access_request.expires_at < timezone.now():
        _close_request(access_request, AccessRequestStatus.EXPIRED, None)
        raise DomainError(_("انتهت صلاحية هذا الطلب."), code="expired")
    grant = None
    if approve:
        # The patient may narrow, never widen, the requested scopes.
        chosen = [s for s in (scopes or access_request.scopes) if s in access_request.scopes]
        grant = create_grant(
            patient=access_request.patient, organization=access_request.organization,
            practitioner=access_request.practitioner, scopes=chosen,
            method=GrantMethod.PATIENT_APP,
            duration=timedelta(hours=access_request.duration_hours), granted_by=user,
            request=request,
        )
    _close_request(access_request,
                   AccessRequestStatus.APPROVED if approve else AccessRequestStatus.DENIED,
                   user, grant)
    audit.record(audit.Action.ACCESS_DECISION, request=request, actor=user,
                 target=access_request, patient_id=access_request.patient_id,
                 metadata={"approved": approve})
    notify([access_request.requested_by], kind=NotificationKind.ACCESS_GRANTED,
           title=_("وافق المريض على طلب الوصول") if approve else _("رفض المريض طلب الوصول"),
           link=f"/app/patients/{access_request.patient_id}")
    return grant


@transaction.atomic
def revoke_grant(*, grant: AccessGrant, user, request=None, ctx=None) -> AccessGrant:
    if grant.revoked_at is None:
        grant.revoked_at = timezone.now()
        grant.revoked_by = user
        grant.save(update_fields=["revoked_at", "revoked_by", "updated_at"])
        audit.record(audit.Action.GRANT_REVOKE, request=request, ctx=ctx, actor=user,
                     target=grant, patient_id=grant.patient_id)
    return grant

