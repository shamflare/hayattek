"""Central authorization engine (ADR-006).

Every read of patient data must go through these functions. Views build their
querysets from `visible_records()` / `patients_visible_to_*()`; they never call
`Model.objects.get(pk=...)` for patient data directly.

Two visibility sources for clinicians:
  1. Own-organization records of patients registered at the organization.
  2. Network records (any other organization, or patient uploads) covered by an
     effective AccessGrant whose scopes include the record's scope.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import timedelta

from django.db.models import Model, Q, QuerySet
from django.utils import timezone

from apps.clinical.base import VISIBLE_STATUSES, RecordStatus
from apps.patients.models import Patient, PatientGuardian, PatientRegistration, PatientStatus

from .context import PracticeContext
from .models import AccessGrant, Scope

SUMMARY_MEDICATION_WINDOW = timedelta(days=180)


# ---------------------------------------------------------------- scope mapping


def _scope_conditions(model: type[Model], *, summary_view: bool = False) -> dict[str, Q]:
    """Map each access scope to the subset of `model` rows it unlocks.

    `summary_view` is only used by the patient-summary endpoint: the `summary` scope then
    unlocks recent prescriptions so the current-medication list can be derived, without
    exposing prescription records anywhere else.
    """
    from apps.clinical.models import Allergy, Condition, ConditionCategory, Encounter
    from apps.diagnostics.models import ImagingReport, LabReport, RequestKind, ServiceRequest
    from apps.documents.models import IMAGING_CATEGORIES, ClinicalDocument, DocumentCategory
    from apps.medications.models import Prescription
    from apps.referrals.models import Referral

    # Not Q(): an empty Q is dropped when OR-combined, which would silently hide rows.
    everything = Q(pk__isnull=False)
    if model is Encounter:
        return {Scope.ENCOUNTERS: everything}
    if model is Condition:
        chronic = Q(category__in=[ConditionCategory.PROBLEM_LIST, ConditionCategory.PAST_HISTORY])
        return {Scope.ENCOUNTERS: everything, Scope.SUMMARY: chronic}
    if model is Allergy:
        return {Scope.SUMMARY: everything, Scope.ENCOUNTERS: everything}
    if model is Prescription:
        if summary_view:
            recent = Q(occurred_at__gte=timezone.now() - SUMMARY_MEDICATION_WINDOW)
            return {Scope.PRESCRIPTIONS: everything, Scope.SUMMARY: recent}
        return {Scope.PRESCRIPTIONS: everything}
    if model is ServiceRequest:
        return {Scope.LABS: Q(kind=RequestKind.LAB), Scope.IMAGING: Q(kind=RequestKind.IMAGING)}
    if model is LabReport:
        return {Scope.LABS: everything}
    if model is ImagingReport:
        return {Scope.IMAGING: everything}
    if model is ClinicalDocument:
        imaging = Q(category__in=IMAGING_CATEGORIES)
        labs = Q(category=DocumentCategory.LAB_RESULT)
        return {Scope.IMAGING: imaging, Scope.LABS: labs, Scope.DOCUMENTS: ~imaging & ~labs}
    if model is Referral:
        return {Scope.REFERRALS: everything}
    raise ValueError(f"No scope mapping for {model.__name__}")


def _status_filter(ctx_user) -> Q:
    """Finalized records for everyone; drafts only for their author."""
    return Q(status__in=VISIBLE_STATUSES) | Q(status=RecordStatus.DRAFT, author=ctx_user)


# ---------------------------------------------------------------- clinician access


@dataclass
class ClinicalAccess:
    registered: bool = False
    network_scopes: set[str] = field(default_factory=set)
    grant_ids: list = field(default_factory=list)

    @property
    def any(self) -> bool:
        return self.registered or bool(self.network_scopes)

    def allows(self, scope: str) -> bool:
        return self.registered or scope in self.network_scopes


def effective_grants(ctx: PracticeContext, patient_id) -> QuerySet[AccessGrant]:
    qs = AccessGrant.objects.effective().filter(patient_id=patient_id,
                                                organization=ctx.organization)
    practitioner = ctx.practitioner
    if practitioner is not None:
        return qs.filter(Q(practitioner__isnull=True) | Q(practitioner=practitioner))
    return qs.filter(practitioner__isnull=True)


def is_registered(ctx: PracticeContext, patient_id) -> bool:
    return PatientRegistration.objects.filter(
        patient_id=patient_id, organization=ctx.organization, status="active"
    ).exists()


def clinical_access(ctx: PracticeContext, patient_id) -> ClinicalAccess:
    """What a clinician acting in `ctx` may read for this patient. Empty for non-clinicians."""
    if not ctx.is_clinician:
        return ClinicalAccess()
    access = ClinicalAccess(registered=is_registered(ctx, patient_id))
    for grant in effective_grants(ctx, patient_id):
        access.network_scopes.update(grant.scopes)
        access.grant_ids.append(grant.pk)
    return access


def visible_records(ctx: PracticeContext, patient_id, model: type[Model],
                    access: ClinicalAccess | None = None, *,
                    summary_view: bool = False) -> QuerySet:
    """Records of `model` for one patient that the acting user may see."""
    qs = model.objects.filter(patient_id=patient_id).filter(_status_filter(ctx.user))

    if ctx.is_clinician:
        access = access or clinical_access(ctx, patient_id)
        allowed = Q(pk__in=[])
        if access.any:
            # The organization's own records, written under a treatment relationship.
            allowed |= Q(organization=ctx.organization)
        network = Q(pk__in=[])
        for scope, condition in _scope_conditions(model, summary_view=summary_view).items():
            if scope in access.network_scopes:
                network |= condition
        # Network = other organizations or no organization (patient uploads).
        other_org = Q(organization__isnull=True) | ~Q(organization=ctx.organization)
        allowed |= other_org & network
        if access.registered:
            # Results of orders this organization placed come back to it.
            allowed |= _results_of_own_orders(model, ctx.organization)
        if model.__name__ == "Referral":
            # The referral letter itself is visible to its addressee.
            allowed |= _referral_addressee_q(ctx)
        return qs.filter(allowed)

    if ctx.is_diagnostic_staff:
        # Lab/imaging staff see what their organization produced, and orders addressed to it.
        allowed = Q(organization=ctx.organization)
        if model.__name__ == "ServiceRequest":
            allowed |= Q(performer_organization=ctx.organization)
        return qs.filter(allowed)

    return qs.none()


def _referral_addressee_q(ctx: PracticeContext) -> Q:
    return Q(target_practitioner=ctx.practitioner) | Q(
        target_practitioner__isnull=True, target_organization=ctx.organization)


def _results_of_own_orders(model: type[Model], organization) -> Q:
    name = model.__name__
    if name in ("LabReport", "ImagingReport"):
        return Q(service_request__organization=organization)
    if name == "ClinicalDocument":
        return (Q(lab_report__service_request__organization=organization)
                | Q(imaging_report__service_request__organization=organization))
    return Q(pk__in=[])


def can_author_for(ctx: PracticeContext, patient_id) -> bool:
    """Clinicians write records only for patients registered at their organization or
    with an effective grant (a treatment relationship)."""
    if ctx.is_clinician:
        return is_registered(ctx, patient_id) or effective_grants(ctx, patient_id).exists()
    if ctx.is_diagnostic_staff:
        from apps.diagnostics.models import ServiceRequest

        return is_registered(ctx, patient_id) or ServiceRequest.objects.filter(
            patient_id=patient_id, performer_organization=ctx.organization,
            status__in=VISIBLE_STATUSES).exists()
    return False


# ---------------------------------------------------------------- patient identity


def patients_visible_to_staff(ctx: PracticeContext) -> QuerySet[Patient]:
    """Patients whose *demographics* the acting staff member may see."""
    base = Patient.objects.exclude(status=PatientStatus.MERGED)
    q = Q(pk__in=[])
    if ctx.can_manage_patients or ctx.is_clinician:
        q |= Q(registrations__organization=ctx.organization, registrations__status="active")
    if ctx.is_clinician:
        grant_q = AccessGrant.objects.effective().filter(organization=ctx.organization)
        practitioner = ctx.practitioner
        grant_q = grant_q.filter(
            Q(practitioner__isnull=True) | Q(practitioner=practitioner)
        )
        q |= Q(pk__in=grant_q.values("patient_id"))
        from apps.referrals.models import Referral, ReferralState

        q |= Q(pk__in=Referral.objects.filter(
            _referral_addressee_q(ctx), status__in=VISIBLE_STATUSES,
            state__in=[ReferralState.SENT, ReferralState.ACCEPTED],
        ).values("patient_id"))
    if ctx.is_diagnostic_staff:
        from apps.diagnostics.models import FulfillmentStatus, ServiceRequest

        q |= Q(
            pk__in=ServiceRequest.objects.filter(
                performer_organization=ctx.organization,
                status__in=VISIBLE_STATUSES,
            ).exclude(fulfillment_status=FulfillmentStatus.CANCELLED).values("patient_id")
        )
    return base.filter(q).distinct()


# ---------------------------------------------------------------- patient self-service


def patient_ids_for_user(user, *, manage_sharing: bool = False) -> list:
    """The user's own patient record plus effective guardianships."""
    if not user.is_authenticated:
        return []
    ids = list(Patient.objects.filter(user=user).values_list("pk", flat=True))
    guardianships = PatientGuardian.objects.filter(guardian=user, revoked_at__isnull=True).filter(
        Q(valid_until__isnull=True) | Q(valid_until__gte=timezone.localdate())
    )
    if manage_sharing:
        guardianships = guardianships.filter(can_manage_sharing=True)
    else:
        guardianships = guardianships.filter(can_view_records=True)
    ids.extend(guardianships.values_list("patient_id", flat=True))
    return ids


def user_can_access_patient(user, patient_id, *, manage_sharing: bool = False) -> bool:
    try:
        wanted = uuid.UUID(str(patient_id))
    except ValueError:
        return False
    return wanted in patient_ids_for_user(user, manage_sharing=manage_sharing)


def patient_visible_records(user, patient_id, model: type[Model]) -> QuerySet:
    """Patients see finalized records only — never drafts."""
    if not user_can_access_patient(user, patient_id):
        return model.objects.none()
    return model.objects.filter(patient_id=patient_id, status__in=VISIBLE_STATUSES)
