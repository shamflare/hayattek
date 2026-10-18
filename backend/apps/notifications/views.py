from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Notification


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
