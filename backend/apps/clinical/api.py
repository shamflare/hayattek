"""Shared API plumbing for clinical record endpoints.

The same endpoint serves staff (with X-Hayat-Membership) and patients/guardians
(without it). Querysets always come from apps.access.policy.
"""

from __future__ import annotations

import uuid

from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.access import policy
from apps.access.context import resolve_practice_context
from apps.audit import services as audit
from apps.audit.models import AuditOutcome
from apps.core.exceptions import DomainError
from apps.patients.models import Patient

from . import records
from .base import RecordStatus

NOT_FOUND = DomainError(_("السجل غير موجود أو لا تملك صلاحية الوصول إليه."), code="not_found",
                        status_code=404)

ReasonSerializer = inline_serializer("Reason", {"reason": serializers.CharField(max_length=300)})


class RecordMetaSerializer(serializers.ModelSerializer):
    """Provenance fields every clinical record exposes."""

    organization_name = serializers.CharField(source="organization.name", read_only=True,
                                              default=None)
    author_name = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_amend = serializers.SerializerMethodField()

    META_FIELDS = ("id", "patient", "organization", "organization_name", "author_name",
                   "author_role", "status", "source", "occurred_at", "finalized_at", "version",
                   "amended_at", "status_reason", "created_at", "can_edit", "can_amend")
    META_READ_ONLY = ("organization", "status", "source", "finalized_at", "version",
                      "amended_at", "status_reason", "created_at")

    def get_author_name(self, obj) -> str:
        if obj.practitioner_id:
            return obj.practitioner.display_name
        return obj.author.full_name

    def _is_author(self, obj) -> bool:
        ctx = self.context.get("ctx")
        return bool(ctx and obj.author_id == ctx.user.pk
                    and obj.organization_id == ctx.organization.pk)

    def get_can_edit(self, obj) -> bool:
        return obj.status == RecordStatus.DRAFT and self._is_author(obj)

    def get_can_amend(self, obj) -> bool:
        return obj.status in (RecordStatus.FINAL, RecordStatus.AMENDED) and self._is_author(obj)


def _parse_uuid(value) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        return None


class ClinicalRecordViewSet(viewsets.GenericViewSet):
    """Base for record endpoints: list/retrieve/create/update(draft)/finalize/amend/void."""

    model = None
    read_serializer_class = None
    write_serializer_class = None
    amend_serializer_class = None
    select_related = ("organization", "author", "practitioner")
    prefetch_related: tuple = ()
    lookup_value_regex = "[0-9a-f-]{36}"

    def get_queryset(self):
        # Real querysets are built per patient via the policy engine; this only serves
        # OpenAPI introspection.
        return self.model.objects.none()

    # ---------------------------------------------------------------- helpers
    @property
    def ctx(self):
        return resolve_practice_context(self.request)

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "ctx": self.ctx}

    def get_serializer_class(self):
        if self.action in ("create", "partial_update"):
            return self.write_serializer_class
        if self.action == "amend":
            return self.amend_serializer_class or self.write_serializer_class
        return self.read_serializer_class

    def records_for_patient(self, patient_id):
        if self.ctx is not None:
            qs = policy.visible_records(self.ctx, patient_id, self.model)
        else:
            qs = policy.patient_visible_records(self.request.user, patient_id, self.model)
        return qs.select_related(*self.select_related).prefetch_related(*self.prefetch_related)

    def get_record(self, pk, *, for_update=False):
        pk = _parse_uuid(pk)
        row = self.model.objects.filter(pk=pk).values("patient_id").first() if pk else None
        record = (self.records_for_patient(row["patient_id"]).filter(pk=pk).first()
                  if row else None)
        if record is None:
            audit.record(audit.Action.ACCESS_DENIED, request=self.request, ctx=self.ctx,
                         outcome=AuditOutcome.DENIED, target_type=self.model._meta.label_lower,
                         target_id=str(pk), patient_id=row["patient_id"] if row else None)
            raise NOT_FOUND
        return record

    def require_clinician_ctx(self):
        ctx = self.ctx
        if ctx is None or not (ctx.is_clinician or self.allow_diagnostic_authors(ctx)):
            raise DomainError(_("هذه العملية متاحة للأطباء المعتمدين فقط."), code="forbidden",
                              status_code=403)
        return ctx

    def allow_diagnostic_authors(self, ctx) -> bool:
        return False

    def get_patient_for_write(self, patient_id) -> Patient:
        """Writers must already see the patient; otherwise it 'does not exist' for them."""
        ctx = self.ctx
        patient = (policy.patients_visible_to_staff(ctx).filter(pk=_parse_uuid(patient_id)).first()
                   if ctx else None)
        if patient is None:
            raise DomainError(_("المريض غير موجود أو لا تملك صلاحية الوصول إليه."),
                              code="not_found", status_code=404)
        return patient

    def children_snapshot(self, record) -> dict:
        return {}

    # ---------------------------------------------------------------- endpoints
    @extend_schema(parameters=[OpenApiParameter("patient", str, required=True)])
    def list(self, request):
        patient_id = _parse_uuid(request.query_params.get("patient"))
        if patient_id is None:
            raise DomainError(_("حدد المريض."), code="patient_required")
        qs = self.filter_list(self.records_for_patient(patient_id)).order_by("-occurred_at")
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(
            self.get_serializer(page, many=True).data)

    def filter_list(self, qs):
        return qs

    def retrieve(self, request, pk=None):
        record = self.get_record(pk)
        audit.record(audit.Action.RECORD_VIEW, request=request, ctx=self.ctx, target=record)
        return Response(self.get_serializer(record).data)

    def create(self, request):
        ctx = self.require_clinician_ctx()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        patient = self.get_patient_for_write(data.pop("patient", None))
        record = self.perform_create_record(ctx, patient, data)
        return Response(self.read_serializer_class(record, context=self.get_serializer_context()
                                                   ).data, status=status.HTTP_201_CREATED)

    def perform_create_record(self, ctx, patient, data):
        return records.create(ctx, self.model, patient=patient, data=data, request=self.request)

    def partial_update(self, request, pk=None):
        ctx = self.require_clinician_ctx()
        record = self.get_record(pk)
        serializer = self.get_serializer(record, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        data.pop("patient", None)
        record = self.perform_update_draft(ctx, record, data)
        return Response(self.read_serializer_class(record, context=self.get_serializer_context()
                                                   ).data)

    def perform_update_draft(self, ctx, record, data):
        return records.update_draft(ctx, record, data, request=self.request)

    @extend_schema(request=None)
    @action(detail=True, methods=["post"])
    def finalize(self, request, pk=None):
        ctx = self.require_clinician_ctx()
        record = self.perform_finalize(ctx, self.get_record(pk))
        return Response(self.read_serializer_class(record, context=self.get_serializer_context()
                                                   ).data)

    def perform_finalize(self, ctx, record):
        return records.finalize(ctx, record, request=self.request)

    @action(detail=True, methods=["post"])
    def amend(self, request, pk=None):
        ctx = self.require_clinician_ctx()
        record = self.get_record(pk)
        reason = request.data.get("reason", "")
        serializer = self.get_serializer(record, data=request.data.get("changes", {}),
                                         partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        data.pop("patient", None)
        record = self.perform_amend(ctx, record, data, reason)
        return Response(self.read_serializer_class(record, context=self.get_serializer_context()
                                                   ).data)

    def perform_amend(self, ctx, record, data, reason):
        return records.amend(ctx, record, data, reason, request=self.request,
                             children=self.children_snapshot(record))

    @extend_schema(request=ReasonSerializer)
    @action(detail=True, methods=["post"], url_path="entered-in-error")
    def entered_in_error(self, request, pk=None):
        ctx = self.require_clinician_ctx()
        record = records.mark_entered_in_error(ctx, self.get_record(pk),
                                               request.data.get("reason", ""),
                                               request=request)
        if record is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(self.read_serializer_class(record, context=self.get_serializer_context()
                                                   ).data)

    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        from .models import RecordVersion

        record = self.get_record(pk)
        rows = RecordVersion.objects.filter(record_type=record._meta.label_lower,
                                            record_id=record.pk).select_related("changed_by")
        return Response([{"version": v.version, "reason": v.reason, "created_at": v.created_at,
                          "changed_by": v.changed_by.full_name, "snapshot": v.snapshot}
                         for v in rows])
