"""Record lifecycle shared by every clinical record type (ADR-007)."""

from __future__ import annotations

import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.forms.models import model_to_dict
from django.utils import timezone
from django.utils.translation import gettext as _

from apps.access import policy
from apps.access.context import PracticeContext
from apps.audit import services as audit
from apps.core.exceptions import DomainError

from .base import ClinicalRecord, RecordSource, RecordStatus
from .models import RecordVersion

LOCKED = DomainError(
    _("هذا السجل معتمد ولا يمكن تعديله مباشرة. استخدم التصحيح الموثق."), code="record_locked",
    status_code=409,
)


def author_fields(ctx: PracticeContext, source: str = RecordSource.CLINICIAN) -> dict:
    """Provenance always comes from the verified context, never from the request body."""
    return {
        "organization": ctx.organization,
        "author": ctx.user,
        "practitioner": ctx.practitioner,
        "author_role": ctx.primary_role,
        "source": source,
    }


def ensure_can_author(ctx: PracticeContext, patient_id) -> None:
    if not policy.can_author_for(ctx, patient_id):
        raise DomainError(
            _("لا تملك علاقة علاجية مصرح بها مع هذا المريض. سجّل المريض في منشأتك أو احصل على "
              "موافقته."), code="no_treatment_relationship", status_code=403)


def ensure_is_author(ctx: PracticeContext, record: ClinicalRecord) -> None:
    """Only the original author, acting in the same organization, changes a record."""
    if record.author_id != ctx.user.pk or record.organization_id != ctx.organization.pk:
        raise DomainError(_("لا يمكنك تعديل سجل أنشأه شخص آخر أو منشأة أخرى."),
                          code="not_author", status_code=403)


def snapshot(record: ClinicalRecord, children: dict | None = None) -> dict:
    data = model_to_dict(record)
    data.update(children or {})
    return json.loads(json.dumps(data, cls=DjangoJSONEncoder))


@transaction.atomic
def create(ctx, model: type[ClinicalRecord], *, patient, data: dict, request=None,
           source: str = RecordSource.CLINICIAN, check_relationship: bool = True):
    if check_relationship:
        ensure_can_author(ctx, patient.pk)
    record = model.objects.create(patient=patient, **author_fields(ctx, source), **data)
    audit.record(audit.Action.RECORD_CREATE, request=request, ctx=ctx, target=record)
    return record


@transaction.atomic
def update_draft(ctx, record: ClinicalRecord, data: dict, request=None):
    ensure_is_author(ctx, record)
    if not record.is_draft:
        raise LOCKED
    for key, value in data.items():
        setattr(record, key, value)
    record.save()
    audit.record(audit.Action.RECORD_UPDATE_DRAFT, request=request, ctx=ctx, target=record,
                 metadata={"fields": sorted(data)})
    return record


@transaction.atomic
def finalize(ctx, record: ClinicalRecord, request=None):
    ensure_is_author(ctx, record)
    if not record.is_draft:
        raise DomainError(_("السجل معتمد مسبقاً."), code="already_final", status_code=409)
    record.status = RecordStatus.FINAL
    record.finalized_at = timezone.now()
    record.save(update_fields=["status", "finalized_at", "updated_at"])
    audit.record(audit.Action.RECORD_FINALIZE, request=request, ctx=ctx, target=record)
    return record


@transaction.atomic
def amend(ctx, record: ClinicalRecord, data: dict, reason: str, request=None,
          children: dict | None = None):
    """Documented correction: snapshot the current version, then apply changes."""
    ensure_is_author(ctx, record)
    if record.status not in (RecordStatus.FINAL, RecordStatus.AMENDED):
        raise DomainError(_("التصحيح متاح للسجلات المعتمدة فقط."), code="not_final",
                          status_code=409)
    if len((reason or "").strip()) < 3:
        raise DomainError(_("اكتب سبب التصحيح."), code="reason_required")
    record = type(record).objects.select_for_update().get(pk=record.pk)
    RecordVersion.objects.create(
        record_type=record._meta.label_lower, record_id=record.pk, version=record.version,
        snapshot=snapshot(record, children), changed_by=ctx.user, reason=reason[:300],
    )
    for key, value in data.items():
        setattr(record, key, value)
    record.version += 1
    record.status = RecordStatus.AMENDED
    record.amended_at = timezone.now()
    record.status_reason = reason[:300]
    record.save()
    audit.record(audit.Action.RECORD_AMEND, request=request, ctx=ctx, target=record,
                 metadata={"version": record.version, "fields": sorted(data)})
    return record


@transaction.atomic
def mark_entered_in_error(ctx, record: ClinicalRecord, reason: str, request=None):
    ensure_is_author(ctx, record)
    if len((reason or "").strip()) < 3:
        raise DomainError(_("اكتب سبب الإلغاء."), code="reason_required")
    if record.is_draft:
        # Drafts were never visible to anyone else: they may simply be discarded.
        audit.record(audit.Action.RECORD_ENTERED_IN_ERROR, request=request, ctx=ctx,
                     target=record, metadata={"discarded_draft": True})
        record.delete()
        return None
    RecordVersion.objects.create(
        record_type=record._meta.label_lower, record_id=record.pk, version=record.version,
        snapshot=snapshot(record), changed_by=ctx.user, reason=reason[:300],
    )
    record.status = RecordStatus.ENTERED_IN_ERROR
    record.status_reason = reason[:300]
    record.version += 1
    record.save(update_fields=["status", "status_reason", "version", "updated_at"])
    audit.record(audit.Action.RECORD_ENTERED_IN_ERROR, request=request, ctx=ctx, target=record)
    return record
