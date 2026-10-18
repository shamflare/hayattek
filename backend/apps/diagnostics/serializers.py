from rest_framework import serializers

from apps.clinical.api import RecordMetaSerializer

from .models import (
    ImagingReport,
    LabObservation,
    LabReport,
    LabTestType,
    ServiceRequest,
    ServiceRequestItem,
)


class LabTestTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LabTestType
        fields = ("id", "code", "name_ar", "name_en", "category", "specimen")


class ServiceRequestItemSerializer(serializers.ModelSerializer):
    lab_test_name = serializers.CharField(source="lab_test.name_en", read_only=True, default=None)
    lab_test_name_ar = serializers.CharField(source="lab_test.name_ar", read_only=True,
                                             default=None)

    class Meta:
        model = ServiceRequestItem
        fields = ("id", "lab_test", "lab_test_name", "lab_test_name_ar", "modality", "body_site",
                  "description")
        read_only_fields = ("id",)


class ServiceRequestSerializer(RecordMetaSerializer):
    items = ServiceRequestItemSerializer(many=True, read_only=True)
    performer_organization_name = serializers.CharField(
        source="performer_organization.name", read_only=True, default=None)
    patient_brief = serializers.SerializerMethodField()

    class Meta:
        model = ServiceRequest
        fields = (*RecordMetaSerializer.META_FIELDS, "kind", "encounter", "number", "priority",
                  "performer_organization", "performer_organization_name", "clinical_notes",
                  "fulfillment_status", "items", "patient_brief")
        read_only_fields = fields

    def get_patient_brief(self, obj) -> dict:
        p = obj.patient
        return {"full_name": p.full_name, "age_years": p.age_years, "sex": p.sex,
                "health_number": p.formatted_health_number}


class ServiceRequestWriteSerializer(serializers.ModelSerializer):
    patient = serializers.UUIDField(write_only=True)
    items = ServiceRequestItemSerializer(many=True)
    send_now = serializers.BooleanField(default=True, write_only=True)

    class Meta:
        model = ServiceRequest
        fields = ("patient", "kind", "encounter", "priority", "performer_organization",
                  "clinical_notes", "items", "send_now")
        extra_kwargs = {"encounter": {"required": False},
                        "performer_organization": {"required": False}}

    def validate(self, attrs):
        items = attrs.get("items") or []
        if not items:
            raise serializers.ValidationError({"items": "أضف بنداً واحداً على الأقل."})
        kind = attrs.get("kind")
        for item in items:
            if kind == "lab" and not (item.get("lab_test") or item.get("description")):
                raise serializers.ValidationError({"items": "حدد التحليل المطلوب."})
            if kind == "imaging" and not item.get("modality"):
                raise serializers.ValidationError({"items": "حدد نوع التصوير."})
        performer = attrs.get("performer_organization")
        if performer is not None and performer.status != "active":
            raise serializers.ValidationError({"performer_organization": "الجهة غير فعالة."})
        return attrs


class LabObservationSerializer(serializers.ModelSerializer):
    class Meta:
        model = LabObservation
        fields = ("id", "position", "test", "name", "value_numeric", "value_text", "unit",
                  "reference_low", "reference_high", "reference_text", "interpretation",
                  "method")
        read_only_fields = ("id",)
        extra_kwargs = {"position": {"required": False}}

    def validate(self, attrs):
        if attrs.get("value_numeric") is None and not attrs.get("value_text"):
            raise serializers.ValidationError({"value_numeric": "أدخل قيمة النتيجة."})
        return attrs


class LabReportSerializer(RecordMetaSerializer):
    observations = LabObservationSerializer(many=True, read_only=True)
    documents = serializers.SerializerMethodField()

    class Meta:
        model = LabReport
        fields = (*RecordMetaSerializer.META_FIELDS, "service_request", "title",
                  "specimen_collected_at", "conclusion", "external_lab_name", "observations",
                  "documents")
        read_only_fields = fields

    def get_documents(self, obj) -> list[dict]:
        return [{"id": str(d.pk), "title": d.title, "mime_type": d.mime_type}
                for d in obj.documents.exclude(status="entered_in_error")]


class LabReportWriteSerializer(serializers.ModelSerializer):
    patient = serializers.UUIDField(write_only=True)
    observations = LabObservationSerializer(many=True, required=False)

    class Meta:
        model = LabReport
        fields = ("patient", "service_request", "title", "occurred_at", "specimen_collected_at",
                  "conclusion", "external_lab_name", "observations")
        extra_kwargs = {"service_request": {"required": False}}


class ImagingReportSerializer(RecordMetaSerializer):
    documents = serializers.SerializerMethodField()

    class Meta:
        model = ImagingReport
        fields = (*RecordMetaSerializer.META_FIELDS, "service_request", "modality", "body_site",
                  "title", "findings", "impression", "documents")
        read_only_fields = fields

    def get_documents(self, obj) -> list[dict]:
        return [{"id": str(d.pk), "title": d.title, "mime_type": d.mime_type}
                for d in obj.documents.exclude(status="entered_in_error")]


class ImagingReportWriteSerializer(serializers.ModelSerializer):
    patient = serializers.UUIDField(write_only=True)

    class Meta:
        model = ImagingReport
        fields = ("patient", "service_request", "modality", "body_site", "title", "findings",
                  "impression", "occurred_at")
        extra_kwargs = {"service_request": {"required": False}}


class FulfillmentSerializer(serializers.Serializer):
    fulfillment_status = serializers.ChoiceField(choices=["received", "in_progress", "cancelled"])
