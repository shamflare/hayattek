from django.utils import timezone
from drf_spectacular.utils import (
    OpenApiParameter,
    extend_schema,
    extend_schema_view,
    inline_serializer,
)
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.access.context import IsPlatformAdmin

from .models import Notification, OutboundMessage


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ("id", "kind", "title", "body", "link", "data", "read_at", "created_at")


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = Notification.objects.none()  # OpenAPI introspection only
    serializer_class = NotificationSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return self.queryset
        qs = Notification.objects.filter(user=self.request.user)
        if self.request.query_params.get("unread") == "1":
            qs = qs.filter(read_at__isnull=True)
        return qs

    @extend_schema(responses=inline_serializer("UnreadCount", {
        "unread": serializers.IntegerField()}))
    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        return Response({"unread": Notification.objects.filter(
            user=request.user, read_at__isnull=True).count()})

    @extend_schema(request=None, responses=inline_serializer("MarkedRead", {
        "updated": serializers.IntegerField()}))
    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        updated = Notification.objects.filter(user=request.user, read_at__isnull=True).update(
            read_at=timezone.now())
        return Response({"updated": updated})

    @extend_schema(request=None, responses=NotificationSerializer)
    @action(detail=True, methods=["post"], url_path="read")
    def mark_read(self, request, pk=None):
        notification = self.get_queryset().get(pk=pk)
        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=["read_at", "updated_at"])
        return Response(NotificationSerializer(notification).data)


# ------------------------------------------------------------------ platform admin: outbox


class OutboundMessageAdminSerializer(serializers.ModelSerializer):
    """Delivery metadata only: masked recipient, never the body (it may hold a code/link)."""

    class Meta:
        model = OutboundMessage
        fields = ("id", "channel", "purpose", "recipient_masked", "status", "attempts",
                  "max_attempts", "last_error", "provider", "provider_message_id",
                  "next_attempt_at", "sent_at", "created_at")
        read_only_fields = fields


@extend_schema_view(list=extend_schema(parameters=[
    OpenApiParameter("status", str), OpenApiParameter("channel", str),
    OpenApiParameter("purpose", str)]))
class AdminOutboundMessageViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Read-only delivery log for platform operators (PHASE2 §5 "متابعة حالة الإرسال")."""

    permission_classes = [IsPlatformAdmin]
    serializer_class = OutboundMessageAdminSerializer
    queryset = OutboundMessage.objects.none()  # OpenAPI introspection only

    def get_queryset(self):
        qs = OutboundMessage.objects.all().order_by("-created_at")
        params = self.request.query_params
        for field in ("status", "channel", "purpose"):
            if params.get(field):
                qs = qs.filter(**{field: params[field]})
        return qs

    @extend_schema(responses=inline_serializer("OutboundMessageStats", {
        "by_status": serializers.DictField(child=serializers.IntegerField()),
        "sms_provider": serializers.CharField(),
        "sms_configured": serializers.BooleanField(),
        "email_provider": serializers.CharField(),
        "email_configured": serializers.BooleanField(),
    }))
    @action(detail=False, methods=["get"])
    def stats(self, request):
        from django.db.models import Count

        from .providers import get_email_provider
        from .sms import get_sms_provider

        rows = OutboundMessage.objects.values("status").annotate(n=Count("id"))
        sms, email = get_sms_provider(), get_email_provider()
        return Response({"by_status": {r["status"]: r["n"] for r in rows},
                         "sms_provider": sms.name,
                         "sms_configured": bool(getattr(sms, "configured", True)),
                         "email_provider": email.name,
                         "email_configured": bool(getattr(email, "configured", True))})
