from django.conf import settings
from django.contrib.auth import login, logout, update_session_auth_hash
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db import transaction
from django.utils.decorators import method_decorator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.utils.translation import gettext as _
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.audit import services as audit
from apps.core.exceptions import DomainError

from . import services
from .models import DeviceToken, User
from .serializers import (
    LoginSerializer,
    MeSerializer,
    MfaSetupSerializer,
    OtpSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileUpdateSerializer,
    TokenLoginSerializer,
    TokenResponseSerializer,
)

OkSerializer = inline_serializer("Ok", {"ok": serializers.BooleanField()})


class CsrfView(APIView):
    """Sets the CSRF cookie for the web app."""

    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []

    @extend_schema(responses=OkSerializer)
    @method_decorator(ensure_csrf_cookie)
    def get(self, request):
        return Response({"ok": True})


class LoginView(APIView):
    """Web login: creates an HttpOnly session cookie."""

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(request=LoginSerializer, responses=MeSerializer)
    def post(self, request):
        data = LoginSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user = services.authenticate_credentials(request, **data.validated_data)
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        audit.record(audit.Action.AUTH_LOGIN, request=request, actor=user,
                     metadata={"channel": "web"})
        return Response(MeSerializer(user).data)


class TokenLoginView(APIView):
    """Mobile login: returns an opaque device token (shown once)."""

    permission_classes = [permissions.AllowAny]
    authentication_classes: list = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(request=TokenLoginSerializer, responses=TokenResponseSerializer)
    def post(self, request):
        data = TokenLoginSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        device_name = data.validated_data.pop("device_name", "")
        user = services.authenticate_credentials(request, **data.validated_data)
        token, raw = DeviceToken.issue(user, device_name)
        audit.record(audit.Action.AUTH_LOGIN, request=request, actor=user,
                     metadata={"channel": "mobile", "token_prefix": token.prefix})
        return Response({"token": raw, "expires_at": token.expires_at,
                         "user": MeSerializer(user).data}, status=status.HTTP_201_CREATED)


class LogoutView(APIView):
    @extend_schema(request=None, responses=OkSerializer)
    def post(self, request):
        if isinstance(request.auth, DeviceToken):
            request.auth.revoke()
        audit.record(audit.Action.AUTH_LOGOUT, request=request)
        logout(request)
        return Response({"ok": True})


class MeView(APIView):
    @extend_schema(responses=MeSerializer)
    def get(self, request):
        return Response(MeSerializer(request.user).data)

    @extend_schema(request=ProfileUpdateSerializer, responses=MeSerializer)
    def patch(self, request):
        serializer = ProfileUpdateSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(MeSerializer(request.user).data)


class PasswordChangeView(APIView):
    @extend_schema(request=PasswordChangeSerializer, responses=OkSerializer)
    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = request.user
        with transaction.atomic():
            user.set_password(serializer.validated_data["new_password"])
            user.must_change_password = False
            user.save()
            # Sign out every other device.
            current = request.auth if isinstance(request.auth, DeviceToken) else None
            tokens = DeviceToken.objects.active().filter(user=user)
            if current:
                tokens = tokens.exclude(pk=current.pk)
            for token in tokens:
                token.revoke()
            audit.record(audit.Action.AUTH_PASSWORD_CHANGED, request=request)
        update_session_auth_hash(request, user)
        return Response({"ok": True})


class PasswordResetRequestView(APIView):
    """Always answers the same way, whether or not the account exists."""

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(request=PasswordResetRequestSerializer, responses=OkSerializer)
    def post(self, request):
        data = PasswordResetRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            user = User.objects.get_by_identifier(data.validated_data["identifier"])
        except User.DoesNotExist:
            user = None
        if user and user.is_active and user.email:
            send_reset_link(user)
        return Response({"ok": True})


def build_reset_link(user: User) -> str:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    base = settings.HAYAT["PUBLIC_BASE_URL"]
    return f"{base}/reset-password?uid={uid}&token={token}"


def send_reset_link(user: User) -> None:
    brand = settings.HAYAT["BRAND_NAME"]
    send_mail(
        subject=f"{brand} — إعادة تعيين كلمة المرور",
        message=(
            "لإعادة تعيين كلمة المرور افتح الرابط التالي (صالح لمرة واحدة):\n"
            f"{build_reset_link(user)}\n\nإن لم تطلب ذلك فتجاهل هذه الرسالة."
        ),
        from_email=None,
        recipient_list=[user.email],
    )


class PasswordResetConfirmView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(request=PasswordResetConfirmSerializer, responses=OkSerializer)
    def post(self, request):
        data = PasswordResetConfirmSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        invalid = DomainError(_("رابط إعادة التعيين غير صالح أو منتهي."), code="invalid_token")
        try:
            uid = force_str(urlsafe_base64_decode(data.validated_data["uid"]))
            user = User.objects.get(pk=uid)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            raise invalid from None
        if not default_token_generator.check_token(user, data.validated_data["token"]):
            raise invalid
        from django.contrib.auth.password_validation import validate_password

        validate_password(data.validated_data["new_password"], user)
        with transaction.atomic():
            user.set_password(data.validated_data["new_password"])
            user.must_change_password = False
            user.failed_login_count = 0
            user.locked_until = None
            user.save()
            for token in DeviceToken.objects.active().filter(user=user):
                token.revoke()
            audit.record(audit.Action.AUTH_PASSWORD_CHANGED, request=request, actor=user,
                         metadata={"via": "reset"})
        return Response({"ok": True})


class MfaSetupView(APIView):
    @extend_schema(request=None, responses=MfaSetupSerializer)
    def post(self, request):
        if request.user.mfa_enabled:
            raise DomainError(_("المصادقة الثنائية مفعلة مسبقاً."), code="mfa_already_enabled")
        return Response(services.begin_mfa_setup(request.user))


class MfaEnableView(APIView):
    @extend_schema(request=OtpSerializer, responses=MeSerializer)
    def post(self, request):
        data = OtpSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user = request.user
        if not services.verify_totp(user, data.validated_data["otp"]):
            raise DomainError(_("رمز التحقق غير صحيح."), code="invalid_otp")
        user.mfa_enabled = True
        user.save(update_fields=["mfa_enabled", "updated_at"])
        audit.record(audit.Action.AUTH_MFA_CHANGED, request=request, metadata={"enabled": True})
        return Response(MeSerializer(user).data)
