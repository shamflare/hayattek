"""API for duplicate-file review: suspects, side-by-side compare, merge, reject, undo (§8)."""

from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.access.context import HasPracticeContext, require_practice_context
from apps.audit import services as audit
from apps.core.exceptions import DomainError

from . import merge
from .models import MergeCaseStatus, MergeEvidence, PatientMergeCase
from .serializers import PatientDetailSerializer, PatientListSerializer


class MergedPatientBriefSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    full_name = serializers.CharField()
    health_number = serializers.CharField(source="formatted_health_number")
    status = serializers.CharField()


class MergeCaseSerializer(serializers.ModelSerializer):
    source = MergedPatientBriefSerializer(read_only=True)
    target = MergedPatientBriefSerializer(read_only=True)
    reviewed_by_name = serializers.CharField(source="reviewed_by.full_name", default=None,
                                             read_only=True)
    reverted_by_name = serializers.CharField(source="reverted_by.full_name", default=None,
                                             read_only=True)
    moved_summary = serializers.SerializerMethodField()
    kept_summary = serializers.SerializerMethodField()
    can_revert = serializers.SerializerMethodField()

    class Meta:
        model = PatientMergeCase
        fields = ("id", "status", "source", "target", "reasons", "evidence_checks",
                  "evidence_notes", "decision_reason", "reviewed_by_name", "reviewer_role",
                  "reviewed_at", "reverted_by_name", "reverted_at", "revert_reason",
                  "revert_report", "moved_summary", "kept_summary", "can_revert", "created_at")
        read_only_fields = fields

    def _record(self, obj):
        return getattr(obj, "record", None) if obj.status != MergeCaseStatus.REJECTED else None

    def get_moved_summary(self, obj) -> dict[str, int]:
        record = self._record(obj)
        return {g["model"]: len(g["ids"]) for g in record.moved} if record else {}

    def get_kept_summary(self, obj) -> dict[str, int]:
        record = self._record(obj)
        return {g["model"]: len(g["ids"]) for g in record.kept_on_source} if record else {}

    def get_can_revert(self, obj) -> bool:
        ctx = self.context.get("ctx")
        return bool(ctx and merge.can_revert(ctx, obj))


class SuspectPairSerializer(serializers.Serializer):
    a = PatientListSerializer()
    b = PatientListSerializer()
    reasons = serializers.ListField(child=serializers.CharField())
    name_similarity = serializers.FloatField()
    score = serializers.FloatField()


class AdministrativeFactsSerializer(serializers.Serializer):
    facilities = serializers.IntegerField()
    has_account = serializers.BooleanField()
    guardians = serializers.IntegerField()
    active_cards = serializers.IntegerField()


class CompareSideSerializer(serializers.Serializer):
    patient = PatientDetailSerializer()
    facts = AdministrativeFactsSerializer()
    record_counts = serializers.DictField(child=serializers.IntegerField(), allow_null=True,
                                          help_text="Clinicians only (null for front desk).")


class CompareSerializer(serializers.Serializer):
    a = CompareSideSerializer()
    b = CompareSideSerializer()
    reasons = serializers.ListField(child=serializers.CharField())
    warnings = serializers.ListField(child=serializers.CharField())
    blockers = serializers.ListField(child=serializers.CharField())


class MergeRequestSerializer(serializers.Serializer):
    source = serializers.UUIDField(help_text="The duplicate file folded into the target.")
    target = serializers.UUIDField(help_text="The surviving file.")
    evidence_checks = serializers.ListField(
        child=serializers.ChoiceField(choices=MergeEvidence.choices), allow_empty=False)
    evidence_notes = serializers.CharField(max_length=1000)
    reason = serializers.CharField(max_length=500)
    confirm = serializers.BooleanField()

    def validate_confirm(self, value):
        if not value:
            raise serializers.ValidationError(_("يجب تأكيد الدمج صراحة."))
        return value


class RejectPairSerializer(serializers.Serializer):
    a = serializers.UUIDField()
    b = serializers.UUIDField()
    reason = serializers.CharField(max_length=500)


class RevertSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500)


class PatientMergeViewSet(viewsets.GenericViewSet):
    """Duplicate files of the acting facility. Receptionists and verified physicians only."""

    queryset = PatientMergeCase.objects.none()  # OpenAPI introspection only
    permission_classes = [HasPracticeContext]
    serializer_class = MergeCaseSerializer
    lookup_value_regex = "[0-9a-f-]{36}"

    @property
    def ctx(self):
        return require_practice_context(self.request)

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        return (PatientMergeCase.objects.filter(organization=self.ctx.organization)
                .select_related("source", "target", "reviewed_by", "reverted_by", "record"))

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if not getattr(self, "swagger_fake_view", False):
            context["ctx"] = self.ctx
        return context

    def _guard(self):
        if not merge.can_review_duplicates(self.ctx):
            raise DomainError(_("مراجعة الملفات المكررة متاحة لموظف الاستقبال أو الطبيب المعتمد."),
                              code="forbidden", status_code=403)

    @extend_schema(parameters=[OpenApiParameter("status", str)],
                   responses=MergeCaseSerializer(many=True))
    def list(self, request):
        """History of decisions taken at this facility (merges, rejections, undos)."""
        self._guard()
        qs = self.get_queryset()
        wanted = request.query_params.get("status")
        if wanted:
            qs = qs.filter(status__in=wanted.split(","))
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    def retrieve(self, request, pk=None):
        self._guard()
        case = self.get_queryset().filter(pk=pk).first()
        if case is None:
            raise DomainError(_("حالة الدمج غير موجودة."), code="not_found", status_code=404)
        return Response(self.get_serializer(case).data)

    @extend_schema(responses=SuspectPairSerializer(many=True))
    @action(detail=False, methods=["get"], pagination_class=None)
    def suspects(self, request):
        """Suspected duplicate pairs among patients registered at this facility only."""
        pairs = merge.suspected_duplicates(self.ctx)
        audit.record(audit.Action.PATIENT_SEARCH, request=request, ctx=self.ctx,
                     metadata={"op": "duplicate_suspects", "pairs": len(pairs)})
        return Response(SuspectPairSerializer(pairs, many=True).data)

    @extend_schema(parameters=[OpenApiParameter("a", str, required=True),
                               OpenApiParameter("b", str, required=True)],
                   responses=CompareSerializer)
    @action(detail=False, methods=["get"])
    def compare(self, request):
        """Side by side. Record counts are shown to clinicians only (front desk sees
        demographics and administrative facts)."""
        ctx = self.ctx
        self._guard()
        a, b = merge.get_pair(ctx, request.query_params.get("a"), request.query_params.get("b"))
        sides = {}
        for key, patient in (("a", a), ("b", b)):
            audit.record(audit.Action.PATIENT_VIEW, request=request, ctx=ctx, target=patient,
                         patient_id=patient.pk, metadata={"op": "duplicate_compare"})
            sides[key] = {
                "patient": patient,
                "facts": merge.administrative_facts(patient),
                "record_counts": merge.record_counts(ctx, patient) if ctx.is_clinician else None,
            }
        return Response(CompareSerializer({
            **sides, "reasons": merge.match_reasons(a, b),
            "warnings": merge.identity_warnings(a, b), "blockers": merge.identity_conflicts(a, b),
        }).data)

    @extend_schema(request=MergeRequestSerializer, responses={201: MergeCaseSerializer})
    def create(self, request):
        """Merge `source` into `target`. Explicit confirmation and identity evidence required."""
        data = MergeRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        case = merge.merge_patients(ctx=self.ctx, source_id=v["source"], target_id=v["target"],
                                    evidence_checks=v["evidence_checks"],
                                    evidence_notes=v["evidence_notes"], reason=v["reason"],
                                    request=request)
        case = self.get_queryset().get(pk=case.pk)
        return Response(self.get_serializer(case).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=RejectPairSerializer, responses={201: MergeCaseSerializer})
    @action(detail=False, methods=["post"])
    def reject(self, request):
        """Record that two similar files are different people (no longer suggested)."""
        data = RejectPairSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        case = merge.reject_pair(ctx=self.ctx, a_id=v["a"], b_id=v["b"], reason=v["reason"],
                                 request=request)
        return Response(self.get_serializer(case).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=RevertSerializer, responses=MergeCaseSerializer)
    @action(detail=True, methods=["post"])
    def revert(self, request, pk=None):
        """Undo a mistaken merge (same facility, within the undo window)."""
        self._guard()
        case = self.get_queryset().filter(pk=pk).first()
        if case is None:
            raise DomainError(_("حالة الدمج غير موجودة."), code="not_found", status_code=404)
        data = RevertSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        case = merge.revert_merge(case=case, reason=data.validated_data["reason"], ctx=self.ctx,
                                  request=request)
        case = self.get_queryset().get(pk=case.pk)
        return Response(self.get_serializer(case).data)
