from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext as _

from apps.accounts.models import User
from apps.audit import services as audit
from apps.core.arabic import normalize_syrian_phone
from apps.core.exceptions import DomainError
from apps.practitioners.models import Practitioner, VerificationStatus

from .models import Membership, MembershipStatus, Organization, OrganizationStatus, Role


@dataclass
class MemberAddResult:
    membership: Membership
    user_created: bool
    setup_link: str = ""


@transaction.atomic
def add_member(
    *,
    organization: Organization,
    added_by: User,
    full_name: str,
    roles: list[str],
    email: str = "",
    phone: str = "",
    title: str = "",
    practitioner: dict | None = None,
    request=None,
) -> MemberAddResult:
    """Attach a (new or existing) user to an organization.

    New users get no password: they receive a one-time setup link. Physicians get a
    Practitioner identity that stays `pending` until the platform verifies it.
    """
    if not roles:
        raise DomainError(_("حدد دوراً واحداً على الأقل."), code="roles_required")
    invalid = set(roles) - set(Role.values)
    if invalid:
        raise DomainError(_("دور غير معروف."), code="invalid_role")
    email = (email or "").strip().lower()
    phone = normalize_syrian_phone(phone)
    if not email and not phone:
        raise DomainError(_("أدخل البريد الإلكتروني أو رقم الهاتف."), code="identifier_required")

    user = None
    if email:
        user = User.objects.filter(email__iexact=email).first()
    if user is None and phone:
        user = User.objects.filter(phone=phone).first()

    created = user is None
    if created:
        user = User.objects.create_user(email=email or None, phone=phone or None,
                                        full_name=full_name)

    if Role.PHYSICIAN in roles:
        existing = getattr(user, "practitioner", None)
        if existing is None:
            data = practitioner or {}
            if not data.get("specialty"):
                raise DomainError(_("حدد اختصاص الطبيب."), code="specialty_required")
            Practitioner.objects.create(
                user=user,
                display_name=data.get("display_name") or f"د. {full_name}",
                display_name_en=data.get("display_name_en", ""),
                specialty=data["specialty"],
                specialty_detail=data.get("specialty_detail", ""),
                license_number=data.get("license_number", ""),
                license_authority=data.get("license_authority", ""),
            )

    membership, _created = Membership.objects.get_or_create(
        user=user, organization=organization,
        defaults={"roles": roles, "title": title, "added_by": added_by},
    )
    if not _created:
        membership.roles = sorted(set(membership.roles) | set(roles))
        membership.status = MembershipStatus.ACTIVE
        membership.save(update_fields=["roles", "status", "updated_at"])

    audit.record(audit.Action.MEMBERSHIP_CHANGE, request=request, actor=added_by,
                 target=membership, metadata={"op": "add", "roles": roles})

    setup_link = ""
    if created:
        from apps.accounts.views import build_reset_link, send_reset_link

        setup_link = build_reset_link(user)
        if user.email:
            send_reset_link(user, purpose="account_activation")
    return MemberAddResult(membership=membership, user_created=created, setup_link=setup_link)


@transaction.atomic
def set_organization_status(org: Organization, status: str, *, actor: User, request=None):
    if status not in OrganizationStatus.values:
        raise DomainError(_("حالة غير معروفة."), code="invalid_status")
    org.status = status
    org.save(update_fields=["status", "updated_at"])
    audit.record(audit.Action.ORGANIZATION_CHANGE, request=request, actor=actor, target=org,
                 metadata={"status": status})
    return org


@transaction.atomic
def set_practitioner_verification(
    practitioner: Practitioner, status: str, *, actor: User, notes: str = "", request=None
) -> Practitioner:
    if status not in VerificationStatus.values:
        raise DomainError(_("حالة غير معروفة."), code="invalid_status")
    practitioner.verification_status = status
    practitioner.verification_notes = notes
    if status == VerificationStatus.VERIFIED:
        practitioner.verified_by = actor
        practitioner.verified_at = timezone.now()
    practitioner.save()
    audit.record(audit.Action.PRACTITIONER_VERIFY, request=request, actor=actor,
                 target=practitioner, metadata={"status": status})
    return practitioner
