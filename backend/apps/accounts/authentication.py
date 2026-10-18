from django.utils import timezone
from django.utils.translation import gettext as _
from rest_framework import authentication, exceptions

from .models import DeviceToken, hash_token


class DeviceTokenAuthentication(authentication.BaseAuthentication):
    """`Authorization: Token <raw>` for the mobile app (ADR-003)."""

    keyword = "Token"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()
        if not header or header[0].lower() != self.keyword.lower().encode():
            return None
        if len(header) != 2:
            raise exceptions.AuthenticationFailed(_("ترويسة المصادقة غير صالحة."))
        raw = header[1].decode(errors="ignore")
        token = (
            DeviceToken.objects.active()
            .select_related("user")
            .filter(key_hash=hash_token(raw))
            .first()
        )
        if token is None or not token.user.is_active:
            raise exceptions.AuthenticationFailed(_("انتهت الجلسة. يرجى تسجيل الدخول مجدداً."))
        now = timezone.now()
        if not token.last_used_at or (now - token.last_used_at).total_seconds() > 300:
            DeviceToken.objects.filter(pk=token.pk).update(last_used_at=now)
        request.device_token = token
        return token.user, token

    def authenticate_header(self, request):
        return self.keyword


class CsrfEnforcedSessionAuthentication(authentication.SessionAuthentication):
    """Session auth for the web app; CSRF is always enforced for unsafe methods."""

    def authenticate_header(self, request):
        # Makes DRF answer 401 (not 403) for anonymous requests.
        return "Session"
