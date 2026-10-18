from datetime import timedelta

from django.shortcuts import get_object_or_404
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.core.exceptions import DomainError
from apps.organizations.models import Organization, OrganizationStatus
from apps.patients import services as patient_services
from apps.patients.models import Patient
from apps.practitioners.models import Practitioner

from . import policy, services
from .context import HasPracticeContext, IsClinician, require_practice_context
from .models import AccessGrant, AccessRequest, AccessRequestStatus, GrantMethod
from .serializers import (
    AccessLogEntrySerializer,
    AccessRequestCreateSerializer,
    AccessRequestSerializer,
    GrantSerializer,
    InPersonGrantSerializer,
    OtpVerifySerializer,
    PatientDecisionSerializer,
    PatientShareSerializer,
)


def _resolve_patient(request, ctx, data) -> Patient:
    if data.get("health_number") or data.get("card_token"):
        return patient_services.identify_presented_patient(
            ctx=ctx, request=request, health_number=data.get("health_number", ""),
            card_token=data.get("card_token", ""))
    return get_object_or_404(policy.patients_visible_to_staff(ctx), pk=data["patient_id"])


# ============================================================ facility side


class FacilityAccessViewSet(viewsets.GenericViewSet):
    """Clinicians obtain consent to read network records."""

    permission_classes = [IsClinician]
    serializer_class = AccessRequestSerializer

    @extend_schema(parameters=[OpenApiParameter("patient", str, required=True)],
                   responses=inline_serializer("PatientAccessState", {
                       "grants": GrantSerializer(many=True),
                       "requests": AccessRequestSerializer(many=True),
                   }))
    def list(self, request):
        ctx = require_practice_context(request)
        patient = get_object_or_404(policy.patients_visible_to_staff(ctx),
                                    pk=request.query_params.get("patient"))
        grants = AccessGrant.objects.filter(patient=patient, organization=ctx.organization
                                            ).select_related("organization", "practitioner")[:20]
        pending = AccessRequest.objects.filter(patient=patient, organization=ctx.organization,
                                               status=AccessRequestStatus.PENDING)
        return Response({"grants": GrantSerializer(grants, many=True).data,
                         "requests": AccessRequestSerializer(pending, many=True).data})

    @extend_schema(request=InPersonGrantSerializer, responses={201: GrantSerializer})
    @action(detail=False, methods=["post"], url_path="in-person")
    def in_person(self, request):
        ctx = require_practice_context(request)
        data = InPersonGrantSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        patient = _resolve_patient(request, ctx, data.validated_data)
        grant = services.grant_in_person(
            ctx=ctx, patient=patient, scopes=data.validated_data["scopes"],
            hours=data.validated_data["hours"], attestation=data.validated_data["attestation"],
            request=request)
        return Response(GrantSerializer(grant).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=AccessRequestCreateSerializer, responses={201: AccessRequestSerializer})
    @action(detail=False, methods=["post"])
    def requests(self, request):
        ctx = require_practice_context(request)
        data = AccessRequestCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        patient = _resolve_patient(request, ctx, data.validated_data)
        access_request = services.request_access(
            ctx=ctx, patient=patient, scopes=data.validated_data["scopes"],
            hours=data.validated_data["hours"], channel=data.validated_data["channel"],
            note=data.validated_data.get("note", ""), request=request)
        return Response(AccessRequestSerializer(access_request).data,
                        status=status.HTTP_201_CREATED)

    @extend_schema(request=OtpVerifySerializer, responses=GrantSerializer)
    @action(detail=False, methods=["post"], url_path=r"requests/(?P<request_id>[0-9a-f-]{36})/verify-otp")
    def verify_otp(self, request, request_id=None):
        ctx = require_practice_context(request)
        access_request = get_object_or_404(AccessRequest, pk=request_id,
                                           organization=ctx.organization)
        data = OtpVerifySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        grant = services.verify_otp(ctx=ctx, access_request=access_request,
                                    code=data.validated_data["otp"], request=request)
        return Response(GrantSerializer(grant).data)


# ============================================================ patient side


class MySharingViewSet(viewsets.GenericViewSet):
    """The patient (or guardian) manages who can see their records."""
    queryset = AccessGrant.objects.none()  # OpenAPI introspection only
    queryset = AccessRequest.objects.none()  # OpenAPI introspection only

    serializer_class = GrantSerializer

    def _patient_ids(self, manage=True):
        return policy.patient_ids_for_user(self.request.user, manage_sharing=manage)

    @extend_schema(responses=GrantSerializer(many=True))
    @action(detail=False, methods=["get"])
    def grants(self, request):
        qs = (AccessGrant.objects.filter(patient_id__in=self._patient_ids(manage=False))
              .select_related("organization", "practitioner", "patient"))
        if request.query_params.get("active") == "1":
            qs = qs.effective()
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(GrantSerializer(page, many=True).data)

    @extend_schema(request=PatientShareSerializer, responses={201: GrantSerializer})
    @grants.mapping.post
    def share(self, request):
        data = PatientShareSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        if not policy.user_can_access_patient(request.user, v["patient_id"], manage_sharing=True):
            raise DomainError(_("لا تملك صلاحية مشاركة هذا الملف."), code="forbidden",
                              status_code=403)
        organization = get_object_or_404(Organization, pk=v["organization_id"],
                                         status=OrganizationStatus.ACTIVE)
        practitioner = None
        if v.get("practitioner_id"):
            practitioner = get_object_or_404(
                Practitioner, pk=v["practitioner_id"], verification_status="verified",
                user__memberships__organization=organization, user__memberships__status="active")
        grant = services.create_grant(
            patient=Patient.objects.get(pk=v["patient_id"]), organization=organization,
            practitioner=practitioner, scopes=v["scopes"], method=GrantMethod.PATIENT_SHARE,
            purpose=v["purpose"], duration=timedelta(days=v["days"]), granted_by=request.user,
            request=request)
        return Response(GrantSerializer(grant).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses=GrantSerializer)
    @action(detail=False, methods=["post"], url_path=r"grants/(?P<grant_id>[0-9a-f-]{36})/revoke")
    def revoke(self, request, grant_id=None):
        grant = get_object_or_404(AccessGrant, pk=grant_id, patient_id__in=self._patient_ids())
        services.revoke_grant(grant=grant, user=request.user, request=request)
        return Response(GrantSerializer(grant).data)

    @extend_schema(responses=AccessRequestSerializer(many=True))
    @action(detail=False, methods=["get"], pagination_class=None)
    def requests(self, request):
        qs = AccessRequest.objects.filter(
            patient_id__in=self._patient_ids(), status=AccessRequestStatus.PENDING,
            otp_hash="",
        ).select_related("organization", "practitioner", "patient")
        return Response(AccessRequestSerializer(qs, many=True).data)

    @extend_schema(request=PatientDecisionSerializer, responses=inline_serializer(
        "DecisionResult", {"grant": GrantSerializer(allow_null=True)}))
    @action(detail=False, methods=["post"],
            url_path=r"requests/(?P<request_id>[0-9a-f-]{36})/decide")
    def decide(self, request, request_id=None):
        access_request = get_object_or_404(AccessRequest, pk=request_id,
                                           patient_id__in=self._patient_ids())
        data = PatientDecisionSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        grant = services.patient_decide(user=request.user, access_request=access_request,
                                        approve=data.validated_data["approve"],
                                        scopes=data.validated_data.get("scopes"),
                                        request=request)
        return Response({"grant": GrantSerializer(grant).data if grant else None})

    @extend_schema(parameters=[OpenApiParameter("patient", str, required=True)],
                   responses=AccessLogEntrySerializer(many=True))
    @action(detail=False, methods=["get"], url_path="access-log")
    def access_log(self, request):
        """Who accessed my file (§14). Excludes the patient's own actions."""
        patient_id = request.query_params.get("patient")
        if not policy.user_can_access_patient(request.user, patient_id):
            raise DomainError(_("غير مسموح."), code="forbidden", status_code=403)
        events = (AuditEvent.objects.filter(patient_id=patient_id)
                  .exclude(actor_id=request.user.pk)
                  .exclude(action__in=["patient.search"]))
        page = self.paginate_queryset(events)
        actors = {u.pk: u for u in User.objects.filter(pk__in={e.actor_id for e in page})
                  .select_related("practitioner")}
        orgs = dict(Organization.objects.filter(pk__in={e.organization_id for e in page})
                    .values_list("pk", "name"))
        rows = []
        for e in page:
            actor = actors.get(e.actor_id)
            practitioner = getattr(actor, "practitioner", None) if actor else None
            rows.append({
                "occurred_at": e.occurred_at, "action": e.action, "outcome": e.outcome,
                "actor_name": (practitioner.display_name if practitioner
                               else (actor.full_name if actor else None)),
                "organization_name": orgs.get(e.organization_id),
            })
        return self.get_paginated_response(rows)


class FacilityGrantsListView(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Effective grants held by the acting organization (e.g. 'shared with us' list)."""
    queryset = AccessGrant.objects.none()  # OpenAPI introspection only

    permission_classes = [HasPracticeContext]
    serializer_class = GrantSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        ctx = require_practice_context(self.request)
        if not ctx.is_clinician:
            return AccessGrant.objects.none()
        return AccessGrant.objects.effective().filter(organization=ctx.organization).select_related(
            "organization", "practitioner", "patient")

