"""Platform administration (/admin/*) and organization self-management (/org/*)."""

from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.access.context import (
    HasPracticeContext,
    IsOrgAdmin,
    IsPlatformAdmin,
    require_practice_context,
)
from apps.accounts.models import User
from apps.audit import services as audit
from apps.audit.models import AuditEvent
from apps.practitioners.models import Practitioner

from . import services
from .models import (
    Department,
    Membership,
    Organization,
    OrganizationKind,
    OrganizationStatus,
    Subscription,
    SubscriptionPlan,
)
from .serializers import (
    DepartmentSerializer,
    MemberCreateResponseSerializer,
    MemberCreateSerializer,
    MembershipSerializer,
    MembershipUpdateSerializer,
    OrganizationSerializer,
    OrgSelfSerializer,
    PractitionerSerializer,
    PublicOrganizationSerializer,
    PublicPractitionerSerializer,
    StatusChangeSerializer,
    SubscriptionPlanSerializer,
    SubscriptionSerializer,
    UserSummarySerializer,
)


def _member_create_response(result) -> Response:
    return Response(
        {
            "membership": MembershipSerializer(result.membership).data,
            "user_created": result.user_created,
            "setup_link": result.setup_link,
        },
        status=status.HTTP_201_CREATED,
    )


# ============================================================ platform admin


class AdminOrganizationViewSet(viewsets.ModelViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = OrganizationSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    search_fields = ("name",)

    def get_queryset(self):
        qs = Organization.objects.annotate(
            member_count=Count("memberships", filter=Q(memberships__status="active"))
        ).order_by("name")
        params = self.request.query_params
        if params.get("kind"):
            qs = qs.filter(kind=params["kind"])
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("q"):
            qs = qs.filter(name__icontains=params["q"])
        return qs

    def perform_create(self, serializer):
        org = serializer.save(created_by=self.request.user, status=OrganizationStatus.ACTIVE)
        audit.record(audit.Action.ORGANIZATION_CHANGE, request=self.request, target=org,
                     metadata={"op": "create"})

    def perform_update(self, serializer):
        org = serializer.save()
        audit.record(audit.Action.ORGANIZATION_CHANGE, request=self.request, target=org,
                     metadata={"op": "update"})

    @extend_schema(request=StatusChangeSerializer, responses=OrganizationSerializer)
    @action(detail=True, methods=["post"], url_path="set-status")
    def set_status(self, request, pk=None):
        data = StatusChangeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        org = services.set_organization_status(
            self.get_object(), data.validated_data["status"], actor=request.user, request=request
        )
        return Response(OrganizationSerializer(org).data)

    @extend_schema(responses=MembershipSerializer(many=True))
    @action(detail=True, methods=["get"])
    def members(self, request, pk=None):
        qs = Membership.objects.filter(organization=self.get_object()).select_related(
            "user", "user__practitioner")
        return Response(MembershipSerializer(qs, many=True).data)

    @extend_schema(request=MemberCreateSerializer, responses={201: MemberCreateResponseSerializer})
    @members.mapping.post
    def add_member(self, request, pk=None):
        data = MemberCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        result = services.add_member(organization=self.get_object(), added_by=request.user,
                                     request=request, **data.validated_data)
        return _member_create_response(result)


class AdminPractitionerViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin,
                               viewsets.GenericViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = PractitionerSerializer

    def get_queryset(self):
        qs = Practitioner.objects.select_related("user").order_by("-created_at")
        params = self.request.query_params
        if params.get("verification_status"):
            qs = qs.filter(verification_status=params["verification_status"])
        if params.get("q"):
            qs = qs.filter(display_name__icontains=params["q"])
        return qs

    @extend_schema(request=StatusChangeSerializer, responses=PractitionerSerializer)
    @action(detail=True, methods=["post"])
    def verification(self, request, pk=None):
        data = StatusChangeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        practitioner = services.set_practitioner_verification(
            self.get_object(), data.validated_data["status"], actor=request.user,
            notes=data.validated_data.get("notes", ""), request=request,
        )
        return Response(PractitionerSerializer(practitioner).data)


class AdminUserViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = UserSummarySerializer

    def get_queryset(self):
        qs = User.objects.order_by("full_name")
        q = self.request.query_params.get("q")
        if q:
            qs = qs.filter(Q(full_name__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q))
        return qs

    @extend_schema(request=inline_serializer("UserActive", {"is_active": serializers.BooleanField()}),
                   responses=UserSummarySerializer)
    @action(detail=True, methods=["post"], url_path="set-active")
    def set_active(self, request, pk=None):
        user = self.get_object()
        if user == request.user:
            return Response({"code": "self", "message": "لا يمكنك تعطيل حسابك."}, status=400)
        user.is_active = bool(request.data.get("is_active"))
        user.save(update_fields=["is_active", "updated_at"])
        audit.record(audit.Action.MEMBERSHIP_CHANGE, request=request, target=user,
                     metadata={"op": "set_active", "is_active": user.is_active})
        return Response(UserSummarySerializer(user).data)


class AdminPlanViewSet(viewsets.ModelViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = SubscriptionPlanSerializer
    queryset = SubscriptionPlan.objects.all()
    http_method_names = ["get", "post", "patch", "head", "options"]


class AdminSubscriptionViewSet(viewsets.ModelViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = SubscriptionSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = Subscription.objects.select_related("plan", "organization")
        org = self.request.query_params.get("organization")
        return qs.filter(organization_id=org) if org else qs


AuditEventSerializer = inline_serializer(
    "AuditEventRow",
    {
        "id": serializers.UUIDField(),
        "occurred_at": serializers.DateTimeField(),
        "actor_id": serializers.UUIDField(allow_null=True),
        "organization_id": serializers.UUIDField(allow_null=True),
        "action": serializers.CharField(),
        "outcome": serializers.CharField(),
        "target_type": serializers.CharField(),
        "target_id": serializers.CharField(),
        "patient_id": serializers.UUIDField(allow_null=True),
        "ip_address": serializers.CharField(allow_null=True),
    },
)


class AdminAuditViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Security log for platform operators. Contains identifiers only, no clinical content."""

    permission_classes = [IsPlatformAdmin]

    def get_serializer_class(self):
        return AuditEventSerializer

    def get_queryset(self):
        qs = AuditEvent.objects.all()
        params = self.request.query_params
        for field in ("action", "outcome", "organization_id", "actor_id", "patient_id"):
            if params.get(field):
                qs = qs.filter(**{field: params[field]})
        return qs

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        rows = [
            {f: getattr(e, f) for f in ("id", "occurred_at", "actor_id", "organization_id",
                                        "action", "outcome", "target_type", "target_id",
                                        "patient_id", "ip_address")}
            for e in page
        ]
        return self.get_paginated_response(rows)


class AdminStatsView(APIView):
    """Aggregate, non-identifying operational numbers."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses=inline_serializer("AdminStats", {
        "organizations_by_kind": serializers.DictField(child=serializers.IntegerField()),
        "organizations_active": serializers.IntegerField(),
        "practitioners_verified": serializers.IntegerField(),
        "practitioners_pending": serializers.IntegerField(),
        "patients_total": serializers.IntegerField(),
        "encounters_last_30_days": serializers.IntegerField(),
        "prescriptions_last_30_days": serializers.IntegerField(),
        "denied_access_last_7_days": serializers.IntegerField(),
    }))
    def get(self, request):
        from apps.clinical.models import Encounter
        from apps.medications.models import Prescription
        from apps.patients.models import Patient

        now = timezone.now()
        by_kind = dict(
            Organization.objects.values_list("kind").annotate(n=Count("id")).values_list("kind", "n")
        )
        return Response({
            "organizations_by_kind": {k: by_kind.get(k, 0) for k in OrganizationKind.values},
            "organizations_active": Organization.objects.filter(status="active").count(),
            "practitioners_verified": Practitioner.objects.filter(
                verification_status="verified").count(),
            "practitioners_pending": Practitioner.objects.filter(
                verification_status="pending").count(),
            "patients_total": Patient.objects.count(),
            "encounters_last_30_days": Encounter.objects.filter(
                occurred_at__gte=now - timedelta(days=30)).count(),
            "prescriptions_last_30_days": Prescription.objects.filter(
                occurred_at__gte=now - timedelta(days=30)).count(),
            "denied_access_last_7_days": AuditEvent.objects.filter(
                outcome="denied", occurred_at__gte=now - timedelta(days=7)).count(),
        })


# ============================================================ organization self-management


class OrgProfileView(APIView):
    permission_classes = [IsOrgAdmin]

    @extend_schema(responses=OrgSelfSerializer)
    def get(self, request):
        return Response(OrgSelfSerializer(require_practice_context(request).organization).data)

    @extend_schema(request=OrgSelfSerializer, responses=OrgSelfSerializer)
    def patch(self, request):
        org = require_practice_context(request).organization
        serializer = OrgSelfSerializer(org, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        audit.record(audit.Action.ORGANIZATION_CHANGE, request=request,
                     ctx=require_practice_context(request), target=org, metadata={"op": "update"})
        return Response(serializer.data)


class OrgMemberViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsOrgAdmin]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_serializer_class(self):
        return MembershipUpdateSerializer if self.action == "partial_update" else MembershipSerializer

    def get_queryset(self):
        ctx = require_practice_context(self.request)
        return Membership.objects.filter(organization=ctx.organization).select_related(
            "user", "user__practitioner").order_by("user__full_name")

    @extend_schema(request=MemberCreateSerializer, responses={201: MemberCreateResponseSerializer})
    def create(self, request):
        ctx = require_practice_context(request)
        data = MemberCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        result = services.add_member(organization=ctx.organization, added_by=request.user,
                                     request=request, **data.validated_data)
        return _member_create_response(result)

    def perform_update(self, serializer):
        ctx = require_practice_context(self.request)
        membership = serializer.save()
        audit.record(audit.Action.MEMBERSHIP_CHANGE, request=self.request, ctx=ctx,
                     target=membership, metadata={"op": "update", "roles": membership.roles,
                                                  "status": membership.status})


class OrgDepartmentViewSet(viewsets.ModelViewSet):
    permission_classes = [IsOrgAdmin]
    serializer_class = DepartmentSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return Department.objects.filter(organization=require_practice_context(self.request).organization)

    def perform_create(self, serializer):
        serializer.save(organization=require_practice_context(self.request).organization)


# ============================================================ directory (for referrals / routing)


class DirectoryOrganizationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [HasPracticeContext]
    serializer_class = PublicOrganizationSerializer

    def get_queryset(self):
        qs = Organization.objects.filter(status=OrganizationStatus.ACTIVE)
        params = self.request.query_params
        if params.get("kind"):
            qs = qs.filter(kind__in=params["kind"].split(","))
        if params.get("q"):
            qs = qs.filter(name__icontains=params["q"])
        return qs


class DirectoryPractitionerViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [HasPracticeContext]
    serializer_class = PublicPractitionerSerializer

    def get_queryset(self):
        qs = Practitioner.objects.filter(verification_status="verified")
        params = self.request.query_params
        if params.get("organization"):
            qs = qs.filter(user__memberships__organization_id=params["organization"],
                           user__memberships__status="active")
        if params.get("specialty"):
            qs = qs.filter(specialty=params["specialty"])
        if params.get("q"):
            qs = qs.filter(display_name__icontains=params["q"])
        return qs.distinct()
