"""Platform administration of the medication catalog: imports, browse, deactivate, review of
medicines added by practitioners (§11). Platform administrators only."""

from django.contrib.postgres.search import TrigramSimilarity
from django.db.models import Count, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.access.context import IsPlatformAdmin
from apps.audit import services as audit
from apps.core.arabic import normalize_arabic
from apps.core.exceptions import DomainError

from . import catalog
from .models import CatalogImport, ImportStatus, Medication, MedicationFavorite

ACTION_CATALOG = "catalog.change"


class CatalogImportSerializer(serializers.ModelSerializer):
    imported_by_name = serializers.CharField(source="imported_by.full_name", default=None,
                                             read_only=True)

    class Meta:
        model = CatalogImport
        fields = ("id", "original_filename", "file_format", "sha256", "source_name",
                  "source_version", "source_date", "source_url", "license_text",
                  "license_confirmed", "is_synthetic", "status", "total_rows", "created_count",
                  "updated_count", "unchanged_count", "duplicate_count", "error_count",
                  "error_report", "preview", "imported_by_name", "committed_at", "created_at")
        read_only_fields = fields


class CatalogImportUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    source_name = serializers.CharField(max_length=200)
    source_version = serializers.CharField(max_length=60, required=False, allow_blank=True)
    source_date = serializers.DateField(required=False, allow_null=True)
    source_url = serializers.CharField(max_length=300, required=False, allow_blank=True)
    license_text = serializers.CharField(max_length=1000)
    license_confirmed = serializers.BooleanField()
    is_synthetic = serializers.BooleanField(default=False)

    def validate_file(self, value):
        name = (value.name or "").lower()
        if not (name.endswith(".csv") or name.endswith(".json")):
            raise serializers.ValidationError(_("الملف يجب أن يكون CSV أو JSON."))
        return value


class AdminMedicationSerializer(serializers.ModelSerializer):
    added_by_name = serializers.CharField(source="added_by_practitioner.display_name",
                                          default=None, read_only=True)
    merged_into_name = serializers.CharField(source="merged_into.__str__", default=None,
                                             read_only=True)
    favorites_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Medication
        fields = ("id", "name", "brand_name", "active_ingredient", "strength", "dosage_form",
                  "unit", "default_route", "is_active", "source", "source_reference",
                  "manufacturer", "country_of_registration", "registration_number",
                  "source_name", "source_version", "source_date", "imported_at", "external_id",
                  "is_synthetic", "review_status", "merged_into", "merged_into_name",
                  "added_by_name", "reviewed_at", "favorites_count", "created_at")
        read_only_fields = tuple(f for f in fields if f != "is_active")


class ReviewSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=[("keep", "keep"), ("merge", "merge")])
    target = serializers.UUIDField(required=False, allow_null=True)


class AdminCatalogImportViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin,
                                viewsets.GenericViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = CatalogImportSerializer
    parser_classes = [MultiPartParser, FormParser]
    lookup_value_regex = "[0-9a-f-]{36}"

    def get_queryset(self):
        return CatalogImport.objects.select_related("imported_by")

    @extend_schema(request={"multipart/form-data": CatalogImportUploadSerializer},
                   responses={201: CatalogImportSerializer})
    def create(self, request):
        """Upload + dry run. Nothing is written to the catalog until `commit`."""
        data = CatalogImportUploadSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        imp = catalog.preview_import(uploaded_file=data.validated_data.pop("file"),
                                     user=request.user, **data.validated_data)
        audit.record(ACTION_CATALOG, request=request, target=imp,
                     metadata={"op": "import_preview", "rows": imp.total_rows,
                               "errors": imp.error_count})
        return Response(CatalogImportSerializer(imp).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses=CatalogImportSerializer)
    @action(detail=True, methods=["post"])
    def commit(self, request, pk=None):
        imp = catalog.commit_import(self.get_object(), user=request.user)
        audit.record(ACTION_CATALOG, request=request, target=imp,
                     metadata={"op": "import_commit", "created": imp.created_count,
                               "updated": imp.updated_count, "duplicates": imp.duplicate_count,
                               "errors": imp.error_count})
        return Response(CatalogImportSerializer(imp).data)

    @extend_schema(request=None, responses=CatalogImportSerializer)
    @action(detail=True, methods=["post"])
    def discard(self, request, pk=None):
        imp = self.get_object()
        if imp.status != ImportStatus.PREVIEWED:
            raise DomainError(_("هذا الاستيراد ليس في مرحلة المعاينة."), code="not_previewed",
                              status_code=409)
        imp.status = ImportStatus.DISCARDED
        imp.save(update_fields=["status", "updated_at"])
        audit.record(ACTION_CATALOG, request=request, target=imp, metadata={"op": "discard"})
        return Response(CatalogImportSerializer(imp).data)


class AdminMedicationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin,
                             mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Browse/search the whole catalog; mark entries inactive; review unknown medicines."""

    permission_classes = [IsPlatformAdmin]
    serializer_class = AdminMedicationSerializer
    http_method_names = ["get", "patch", "post", "head", "options"]
    lookup_value_regex = "[0-9a-f-]{36}"

    @extend_schema(parameters=[
        OpenApiParameter("q", str), OpenApiParameter("source", str),
        OpenApiParameter("is_active", bool), OpenApiParameter("is_synthetic", bool),
        OpenApiParameter("review_status", str)])
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        qs = (Medication.objects.select_related("added_by_practitioner", "merged_into")
              .annotate(favorites_count=Coalesce(Subquery(
                  MedicationFavorite.objects.filter(medication=OuterRef("pk"))
                  .values("medication").annotate(n=Count("pk")).values("n")[:1]), 0))
              .order_by("name"))
        params = self.request.query_params
        if params.get("source"):
            qs = qs.filter(source__in=params["source"].split(","))
        for flag in ("is_active", "is_synthetic"):
            if params.get(flag) in ("true", "false"):
                qs = qs.filter(**{flag: params[flag] == "true"})
        if params.get("review_status"):
            qs = qs.filter(review_status=params["review_status"])
        q = normalize_arabic(params.get("q", ""))
        if q:
            qs = (qs.annotate(sim=TrigramSimilarity("search_text", q))
                  .filter(Q(search_text__icontains=q) | Q(sim__gt=0.25)
                          | Q(external_id=params.get("q", "").strip()))
                  .order_by("-sim", "name"))
        return qs

    def perform_update(self, serializer):
        med = serializer.save()
        audit.record(ACTION_CATALOG, request=self.request, target=med,
                     metadata={"op": "set_active", "is_active": med.is_active})

    @extend_schema(request=ReviewSerializer, responses=AdminMedicationSerializer)
    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        """Decide on a medicine a practitioner typed: keep it, or merge into a catalog entry."""
        data = ReviewSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        target = None
        if data.validated_data.get("target"):
            target = Medication.objects.filter(pk=data.validated_data["target"]).first()
        med = catalog.review_unknown_medication(
            medication=self.get_object(), decision=data.validated_data["decision"],
            user=request.user, target=target)
        audit.record(ACTION_CATALOG, request=request, target=med,
                     metadata={"op": "review", "decision": data.validated_data["decision"],
                               "target": str(target.pk) if target else None})
        return Response(self.get_serializer(self.get_queryset().get(pk=med.pk)).data)
