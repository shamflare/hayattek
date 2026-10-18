from __future__ import annotations

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext as _

from apps.audit import services as audit
from apps.audit.models import AuditOutcome
from apps.core.arabic import normalize_arabic, normalize_digits, normalize_syrian_phone
from apps.core.exceptions import DomainError
from apps.core.ids import luhn_check_digit, luhn_is_valid, random_digits, random_token

from .models import CardStatus, HealthCard, Patient, PatientRegistration, PatientStatus


def generate_health_number() -> str:
    length = settings.HAYAT["HEALTH_NUMBER_DIGITS"]
    body = random_digits(length - 1)
    return body + luhn_check_digit(body)


def clean_health_number(raw: str) -> str:
    return "".join(ch for ch in normalize_digits(raw) if ch.isdigit())


def find_by_health_number(raw: str) -> Patient | None:
    number = clean_health_number(raw)
    if not luhn_is_valid(number):
        return None
    patient = Patient.objects.filter(health_number=number).first()
    return _follow_merge(patient)


def find_by_card_token(token: str) -> tuple[Patient | None, HealthCard | None]:
    card = HealthCard.objects.select_related("patient").filter(token=(token or "").strip()).first()
    if card is None or card.status != CardStatus.ACTIVE:
        return None, card
    return _follow_merge(card.patient), card


def _follow_merge(patient: Patient | None) -> Patient | None:
    seen = 0
    while patient is not None and patient.status == PatientStatus.MERGED and seen < 5:
        patient = patient.merged_into
        seen += 1
    return patient


@transaction.atomic
def issue_card(patient: Patient, *, issued_by, reason: str = "", request=None, ctx=None) -> HealthCard:
    """Revoke the current card (if any) and issue a new one. The health number never changes."""
    now = timezone.now()
    for card in HealthCard.objects.select_for_update().filter(patient=patient,
                                                              status=CardStatus.ACTIVE):
        card.status = CardStatus.REVOKED
        card.revoked_at = now
        card.revoked_reason = reason[:200]
        card.save(update_fields=["status", "revoked_at", "revoked_reason", "updated_at"])
        audit.record(audit.Action.CARD_REVOKE, request=request, ctx=ctx, actor=issued_by,
                     target=card, patient_id=patient.pk)
    card = HealthCard.objects.create(patient=patient, token=random_token(16), issued_by=issued_by)
    audit.record(audit.Action.CARD_ISSUE, request=request, ctx=ctx, actor=issued_by, target=card,
                 patient_id=patient.pk)
    return card


def card_url(card: HealthCard) -> str:
    return f"{settings.HAYAT['PUBLIC_BASE_URL']}/c/{card.token}"


@transaction.atomic
def create_patient(*, ctx, data: dict, request=None) -> Patient:
    """Create a patient at the acting organization: identity + registration + first card."""
    data = dict(data)
    data["phone"] = normalize_syrian_phone(data.get("phone"))
    if data.get("emergency_contact_phone"):
        data["emergency_contact_phone"] = normalize_syrian_phone(data["emergency_contact_phone"])

    for _attempt in range(5):
        try:
            with transaction.atomic():
                patient = Patient.objects.create(
                    health_number=generate_health_number(),
                    created_by=ctx.user,
                    created_at_organization=ctx.organization,
                    **data,
                )
            break
        except IntegrityError:  # astronomically rare health-number collision
            continue
    else:
        raise DomainError(_("تعذر إنشاء رقم صحي. حاول مجدداً."), code="health_number_collision")

    PatientRegistration.objects.create(patient=patient, organization=ctx.organization,
                                       registered_by=ctx.user)
    audit.record(audit.Action.PATIENT_CREATE, request=request, ctx=ctx, target=patient,
                 patient_id=patient.pk)
    issue_card(patient, issued_by=ctx.user, request=request, ctx=ctx)
    return patient


@transaction.atomic
def register_patient(*, ctx, patient: Patient, request=None) -> PatientRegistration:
    registration, created = PatientRegistration.objects.get_or_create(
        patient=patient, organization=ctx.organization,
        defaults={"registered_by": ctx.user},
    )
    if not created and registration.status != "active":
        registration.status = "active"
        registration.save(update_fields=["status", "updated_at"])
    audit.record(audit.Action.PATIENT_REGISTER, request=request, ctx=ctx, target=registration,
                 patient_id=patient.pk, metadata={"created": created})
    return registration


def identify_presented_patient(*, ctx, health_number: str = "", card_token: str = "",
                               request=None) -> Patient:
    """Resolve a patient the person physically presented (card QR or health number).

    Presenting the card/number identifies the patient; it does NOT unlock records.
    """
    method = "card" if card_token else "health_number"
    if card_token:
        patient, card = find_by_card_token(card_token)
        if patient is None and card is not None:
            audit.record(audit.Action.CARD_RESOLVE, request=request, ctx=ctx,
                         outcome=AuditOutcome.DENIED, target=card,
                         metadata={"reason": "revoked_card"})
            raise DomainError(_("هذه البطاقة مبطلة. اطلب من المريض بطاقته الجديدة."),
                              code="card_revoked", status_code=404)
    else:
        patient = find_by_health_number(health_number)

    if patient is None:
        audit.record(audit.Action.CARD_RESOLVE, request=request, ctx=ctx,
                     outcome=AuditOutcome.DENIED, metadata={"method": method,
                                                           "reason": "not_found"})
        raise DomainError(_("لم يتم العثور على مريض بهذا الرقم أو البطاقة."),
                          code="patient_not_found", status_code=404)
    audit.record(audit.Action.CARD_RESOLVE, request=request, ctx=ctx, target=patient,
                 patient_id=patient.pk, metadata={"method": method})
    return patient


def duplicate_candidates(*, ctx, first_name: str, family_name: str = "", father_name: str = "",
                         birth_year: int | None = None, phone: str = "") -> dict:
    """ADR-015: name-based matching only within the acting organization's own patients.
    Network-wide we only reveal *whether* a phone + birth-year match exists."""
    own = Patient.objects.filter(registrations__organization=ctx.organization,
                                 registrations__status="active").exclude(status="merged")
    q = Q(pk__in=[])
    phone = normalize_syrian_phone(phone)
    if phone:
        q |= Q(phone=phone)
    name = normalize_arabic(" ".join(p for p in [first_name, father_name, family_name] if p))
    if name:
        name_q = Q(name_search__trigram_similar=name)
        if birth_year:
            name_q &= Q(birth_date__year=birth_year)
        q |= name_q
    candidates = list(own.filter(q).distinct()[:10])

    network_hint = False
    if phone and birth_year:
        network_hint = (
            Patient.objects.filter(phone=phone, birth_date__year=birth_year)
            .exclude(registrations__organization=ctx.organization)
            .exclude(status="merged")
            .exists()
        )
    return {"candidates": candidates, "network_match_hint": network_hint}


@transaction.atomic
def activate_account(*, ctx, patient: Patient, email: str = "", phone: str = "",
                     request=None) -> tuple[object, str, str]:
    """Create (or link) the patient's login. The patient sets their own password through a
    one-time link sent by email/SMS; staff never choose or see a password.

    Returns ``(user, link, delivery)``; ``delivery`` is the honest outbox state
    (queued/sent/not_configured/failed/suppressed)."""
    from apps.accounts.models import User
    from apps.accounts.views import build_reset_link, send_reset_link
    from apps.notifications.messaging import delivery_state, send_message
    from apps.notifications.models import MessageChannel, MessagePurpose

    if patient.user_id:
        raise DomainError(_("للمريض حساب مفعل مسبقاً."), code="already_active", status_code=409)
    email = (email or "").strip().lower()
    phone = normalize_syrian_phone(phone or patient.phone)
    if not email and not phone:
        raise DomainError(_("أدخل بريداً إلكترونياً أو رقم هاتف للمريض."), code="identifier_required")
    user = None
    if email:
        user = User.objects.filter(email__iexact=email).first()
    if user is None and phone:
        user = User.objects.filter(phone=phone).first()
    if user is not None and hasattr(user, "patient_profile"):
        raise DomainError(_("هذا البريد أو الهاتف مرتبط بملف مريض آخر."), code="identifier_in_use",
                          status_code=409)
    if user is None:
        user = User.objects.create_user(email=email or None, phone=phone or None,
                                        full_name=patient.full_name)
    patient.user = user
    patient.save(update_fields=["user", "updated_at"])
    link = build_reset_link(user)
    message = None
    if user.email:
        message = send_reset_link(user, purpose=MessagePurpose.ACCOUNT_ACTIVATION)
    elif user.phone:
        message = send_message(
            channel=MessageChannel.SMS, to=user.phone, purpose=MessagePurpose.ACCOUNT_ACTIVATION,
            body=_("حياة: لتفعيل حسابك وتعيين كلمة المرور افتح: %(l)s") % {"l": link},
            idempotency_key=f"account_activation:{user.pk}:{patient.pk}")
    audit.record(audit.Action.PATIENT_UPDATE, request=request, ctx=ctx, target=patient,
                 metadata={"op": "account_activated"})
    return user, link, delivery_state(message)


@transaction.atomic
def link_guardian(*, ctx, patient: Patient, guardian_health_number: str, relationship: str,
                  valid_until=None, request=None):
    """Verified in person at the facility: the guardian's own patient file (with an app
    account) is linked to the ward. Valid until the given date (e.g. the 18th birthday)."""
    from .models import PatientGuardian

    guardian_patient = find_by_health_number(guardian_health_number)
    if guardian_patient is None or guardian_patient.pk == patient.pk:
        raise DomainError(_("لم يتم العثور على ملف الوصي بهذا الرقم."), code="guardian_not_found",
                          status_code=404)
    if not guardian_patient.user_id:
        raise DomainError(_("يجب تفعيل حساب للوصي في التطبيق أولاً."), code="guardian_no_account")
    if valid_until is None and patient.birth_date and patient.is_minor():
        b = patient.birth_date
        valid_until = b.replace(year=b.year + 18) if not (b.month == 2 and b.day == 29) \
            else b.replace(year=b.year + 18, day=28)
    guardianship, _created = PatientGuardian.objects.update_or_create(
        guardian=guardian_patient.user, patient=patient,
        defaults={"relationship": relationship, "valid_until": valid_until,
                  "verified_by": ctx.user, "revoked_at": None},
    )
    audit.record(audit.Action.PATIENT_UPDATE, request=request, ctx=ctx, target=patient,
                 metadata={"op": "guardian_linked", "relationship": relationship})
    return guardianship
