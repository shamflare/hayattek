from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.access.context import IsPlatformAdmin

from .models import JoinRequest


class JoinRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = JoinRequest
        fields = ("id", "facility_name", "kind", "governorate", "contact_name", "phone", "email",
                  "message", "status", "created_at")
        read_only_fields = ("id", "status", "created_at")


class PublicJoinRequestView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_verify"

    @extend_schema(request=JoinRequestSerializer,
                   responses={201: inline_serializer("JoinOk", {"ok": serializers.BooleanField()})})
    def post(self, request):
        serializer = JoinRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"ok": True}, status=status.HTTP_201_CREATED)


class AdminJoinRequestViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin,
                              viewsets.GenericViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = JoinRequestSerializer
    queryset = JoinRequest.objects.all()
    http_method_names = ["get", "patch", "head", "options"]

    def get_serializer(self, *args, **kwargs):
        if self.action == "partial_update":
            kwargs["partial"] = True
            serializer = JoinRequestSerializer(*args, **kwargs)
            serializer.fields["status"].read_only = False
            return serializer
        return super().get_serializer(*args, **kwargs)
