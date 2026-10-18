"""Practice context: who is acting, in which organization, with which roles (ADR-005)."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property

from django.utils.translation import gettext as _
from rest_framework import exceptions, permissions

from apps.organizations.models import Membership, MembershipStatus, OrganizationStatus, Role

MEMBERSHIP_HEADER = "X-Hayat-Membership"

CLINICAL_ROLES = (Role.PHYSICIAN,)
DIAGNOSTIC_ROLES = (Role.LAB_STAFF, Role.IMAGING_STAFF)
FRONT_DESK_ROLES = (Role.RECEPTIONIST, Role.PHYSICIAN, Role.NURSE, Role.LAB_STAFF,
                    Role.IMAGING_STAFF)


@dataclass
class PracticeContext:
    user: object
    membership: Membership
    roles: frozenset[str] = field(default_factory=frozenset)

    @property
    def organization(self):
        return self.membership.organization

    @cached_property
    def practitioner(self):
        practitioner = getattr(self.user, "practitioner", None)
        return practitioner if practitioner is not None and practitioner.is_verified else None

    def has_role(self, *roles: str) -> bool:
        return any(r in self.roles for r in roles)

    @property
    def is_clinician(self) -> bool:
        """A verified physician acting in this organization."""
        return self.has_role(Role.PHYSICIAN) and self.practitioner is not None

    @property
    def is_diagnostic_staff(self) -> bool:
        return self.has_role(*DIAGNOSTIC_ROLES)

    @property
    def can_manage_patients(self) -> bool:
        """Create/register patients and see demographics of registered patients."""
        return self.has_role(*FRONT_DESK_ROLES)

    @property
    def is_org_admin(self) -> bool:
        return self.has_role(Role.ORG_ADMIN)

    @property
    def primary_role(self) -> str:
        for role in (Role.PHYSICIAN, Role.LAB_STAFF, Role.IMAGING_STAFF, Role.NURSE,
                     Role.RECEPTIONIST, Role.ORG_ADMIN):
            if role in self.roles:
                return role
        return ""


def resolve_practice_context(request) -> PracticeContext | None:
    """Validate the membership header against the authenticated user. Cached per request."""
    if hasattr(request, "_practice_ctx"):
        return request._practice_ctx
    ctx = None
    raw = request.headers.get(MEMBERSHIP_HEADER)
    user = getattr(request, "user", None)
    if raw and user is not None and user.is_authenticated and mfa_blocked(request):
        request._practice_ctx = None
        return None
    if raw and user is not None and user.is_authenticated:
        membership = (
            Membership.objects.select_related("organization")
            .filter(
                pk=raw if _looks_like_uuid(raw) else None,
                user=user,
                status=MembershipStatus.ACTIVE,
                organization__status=OrganizationStatus.ACTIVE,
            )
            .first()
        )
        if membership is not None:
            ctx = PracticeContext(user=user, membership=membership,
                                  roles=frozenset(membership.roles))
    request._practice_ctx = ctx
    return ctx


def _looks_like_uuid(value: str) -> bool:
    import uuid

    try:
        uuid.UUID(value)
    except (ValueError, AttributeError):
        return False
    return True


def mfa_blocked(request) -> bool:
    """Staff/admin accounts without MFA are blocked when HAYAT_ENFORCE_MFA is on (prod)."""
    if not hasattr(request, "_mfa_blocked"):
        from apps.accounts.services import requires_mfa

        user = getattr(request, "user", None)
        request._mfa_blocked = bool(user and user.is_authenticated and requires_mfa(user))
    return request._mfa_blocked


MFA_REQUIRED = exceptions.PermissionDenied(
    _("حسابك يتطلب تفعيل المصادقة الثنائية قبل المتابعة."), code="mfa_setup_required")


def require_practice_context(request) -> PracticeContext:
    if mfa_blocked(request):
        raise MFA_REQUIRED
    ctx = resolve_practice_context(request)
    if ctx is None:
        raise exceptions.PermissionDenied(
            _("يرجى اختيار المنشأة التي تعمل باسمها، أو أن عضويتك غير فعالة."),
            code="practice_context_required",
        )
    return ctx


class HasPracticeContext(permissions.BasePermission):
    message = _("يرجى اختيار المنشأة التي تعمل باسمها.")

    def has_permission(self, request, view) -> bool:
        if mfa_blocked(request):
            raise MFA_REQUIRED
        return request.user.is_authenticated and resolve_practice_context(request) is not None


class IsClinician(permissions.BasePermission):
    message = _("هذه العملية متاحة للأطباء المعتمدين فقط.")

    def has_permission(self, request, view) -> bool:
        if mfa_blocked(request):
            raise MFA_REQUIRED
        ctx = resolve_practice_context(request)
        return ctx is not None and ctx.is_clinician


class CanManagePatients(permissions.BasePermission):
    message = _("لا تملك صلاحية إدارة ملفات المرضى في هذه المنشأة.")

    def has_permission(self, request, view) -> bool:
        if mfa_blocked(request):
            raise MFA_REQUIRED
        ctx = resolve_practice_context(request)
        return ctx is not None and ctx.can_manage_patients


class IsOrgAdmin(permissions.BasePermission):
    message = _("هذه العملية متاحة لمدير المنشأة فقط.")

    def has_permission(self, request, view) -> bool:
        if mfa_blocked(request):
            raise MFA_REQUIRED
        ctx = resolve_practice_context(request)
        return ctx is not None and ctx.is_org_admin


class IsPlatformAdmin(permissions.BasePermission):
    message = _("هذه العملية متاحة لإدارة المنصة فقط.")

    def has_permission(self, request, view) -> bool:
        if mfa_blocked(request):
            raise MFA_REQUIRED
        return bool(request.user.is_authenticated and request.user.is_platform_admin)
