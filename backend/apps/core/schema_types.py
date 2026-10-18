"""Small response shapes reused in OpenAPI so the generated TypeScript is precise."""

from drf_spectacular.utils import inline_serializer
from rest_framework import serializers

PatientBrief = inline_serializer("PatientBriefCard", {
    "full_name": serializers.CharField(),
    "age_years": serializers.IntegerField(allow_null=True),
    "sex": serializers.CharField(required=False),
    "health_number": serializers.CharField(),
})

DocumentBrief = inline_serializer("DocumentBrief", {
    "id": serializers.UUIDField(),
    "title": serializers.CharField(),
    "mime_type": serializers.CharField(),
    "scan_status": serializers.CharField(),
}, many=True)

RecordRef = inline_serializer("RecordRef", {
    "id": serializers.UUIDField(),
    "number": serializers.CharField(),
    "status": serializers.CharField(),
}, many=True)

ServiceRequestRef = inline_serializer("ServiceRequestRef", {
    "id": serializers.UUIDField(),
    "number": serializers.CharField(),
    "kind": serializers.CharField(),
    "status": serializers.CharField(),
    "fulfillment_status": serializers.CharField(),
}, many=True)

PractitionerRef = inline_serializer("PractitionerRef", {
    "id": serializers.UUIDField(),
    "display_name": serializers.CharField(),
    "specialty": serializers.CharField(),
    "verification_status": serializers.CharField(),
}, allow_null=True)

CurrentMedication = inline_serializer("CurrentMedication", {
    "name": serializers.CharField(),
    "prescription_id": serializers.UUIDField(),
    "prescribed_at": serializers.DateTimeField(),
    "prescriber": serializers.CharField(),
    "organization": serializers.CharField(allow_null=True),
    "ends_on": serializers.DateField(allow_null=True),
    "ongoing": serializers.BooleanField(),
}, many=True)

EncounterBrief = inline_serializer("EncounterBrief", {
    "id": serializers.UUIDField(),
    "occurred_at": serializers.DateTimeField(),
    "reason": serializers.CharField(),
    "assessment": serializers.CharField(),
    "status": serializers.CharField(),
    "author_name": serializers.CharField(),
    "organization_name": serializers.CharField(allow_null=True),
}, many=True)

LabReportBrief = inline_serializer("LabReportBrief", {
    "id": serializers.UUIDField(),
    "occurred_at": serializers.DateTimeField(),
    "title": serializers.CharField(),
    "status": serializers.CharField(),
    "abnormal_count": serializers.IntegerField(),
    "organization_name": serializers.CharField(allow_null=True),
}, many=True)

ReportedBrief = inline_serializer("ReportedBrief", {
    "id": serializers.UUIDField(),
    "kind": serializers.CharField(),
    "text": serializers.CharField(),
    "created_at": serializers.DateTimeField(),
}, many=True)

TimelineItem = inline_serializer("TimelineItem", {
    "type": serializers.CharField(),
    "id": serializers.UUIDField(),
    "occurred_at": serializers.DateTimeField(),
    "title": serializers.CharField(),
    "status": serializers.CharField(),
    "author_name": serializers.CharField(),
    "organization_name": serializers.CharField(allow_null=True),
    "source": serializers.CharField(),
}, many=True)

RecordVersionRow = inline_serializer("RecordVersionRow", {
    "version": serializers.IntegerField(),
    "reason": serializers.CharField(),
    "created_at": serializers.DateTimeField(),
    "changed_by": serializers.CharField(),
    "snapshot": serializers.DictField(),
}, many=True)

TrendSeries = inline_serializer("LabTrend", {
    "series": inline_serializer("LabTrendSeries", {
        "unit": serializers.CharField(),
        "points": inline_serializer("LabTrendPoint", {
            "occurred_at": serializers.DateTimeField(),
            "value": serializers.DecimalField(max_digits=14, decimal_places=4),
            "reference_low": serializers.DecimalField(max_digits=14, decimal_places=4,
                                                      allow_null=True),
            "reference_high": serializers.DecimalField(max_digits=14, decimal_places=4,
                                                       allow_null=True),
            "interpretation": serializers.CharField(),
            "report_id": serializers.UUIDField(),
            "lab": serializers.CharField(allow_null=True),
        }, many=True),
    }, many=True),
})
