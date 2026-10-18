import hashlib
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone

from apps.core.arabic import normalize_syrian_phone
from apps.core.ids import random_token
from apps.core.models import BaseModel


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create(self, email=None, phone=None, password=None, **extra):
        email = self.normalize_email(email).lower() if email else None
        phone = normalize_syrian_phone(phone) or None
        if not email and not phone:
            raise ValueError("A user needs an email or a phone number.")
        user = self.model(email=email, phone=phone, **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_user(self, email=None, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create(email=email, password=password, **extra)

    def create_superuser(self, email, password, **extra):
        extra.update(is_staff=True, is_superuser=True, is_platform_admin=True)
        extra.setdefault("full_name", "مدير المنصة")
        return self._create(email=email, password=password, **extra)

    def get_by_identifier(self, identifier: str):
        identifier = (identifier or "").strip()
        if "@" in identifier:
            return self.get(email__iexact=identifier)
        return self.get(phone=normalize_syrian_phone(identifier))


class Language(models.TextChoices):
    AR = "ar", "العربية"
    EN = "en", "English"


class User(BaseModel, AbstractBaseUser, PermissionsMixin):
    """A login identity. Clinical identity lives in Practitioner, patient identity in Patient."""

    email = models.EmailField(unique=True, null=True, blank=True)
    phone = models.CharField(max_length=20, unique=True, null=True, blank=True)
    full_name = models.CharField(max_length=200)
    preferred_language = models.CharField(
        max_length=5, choices=Language.choices, default=Language.AR
    )

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False, help_text="Django admin access.")
    is_platform_admin = models.BooleanField(
        default=False, help_text="Platform operations. Grants NO access to patient records."
    )

    mfa_enabled = models.BooleanField(default=False)
    mfa_secret = models.CharField(max_length=64, blank=True)

    failed_login_count = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    password_changed_at = models.DateTimeField(null=True, blank=True)
    must_change_password = models.BooleanField(default=False)

    objects = UserManager()

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        ordering = ("full_name",)

    def __str__(self) -> str:
        return self.full_name or self.email or self.phone or str(self.pk)

    @property
    def is_locked(self) -> bool:
        return bool(self.locked_until and self.locked_until > timezone.now())

    def set_password(self, raw_password):
        super().set_password(raw_password)
        self.password_changed_at = timezone.now()


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class DeviceTokenQuerySet(models.QuerySet):
    def active(self):
        return self.filter(revoked_at__isnull=True, expires_at__gt=timezone.now())


class DeviceToken(BaseModel):
    """Opaque bearer token for the mobile app (ADR-003). Only the SHA-256 hash is stored."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name="device_tokens")
    key_hash = models.CharField(max_length=64, unique=True)
    prefix = models.CharField(max_length=8)
    device_name = models.CharField(max_length=100, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    objects = DeviceTokenQuerySet.as_manager()

    @classmethod
    def issue(cls, user, device_name: str = "") -> tuple["DeviceToken", str]:
        raw = random_token(32)
        ttl = settings.HAYAT["MOBILE_TOKEN_TTL_DAYS"]
        token = cls.objects.create(
            user=user,
            key_hash=hash_token(raw),
            prefix=raw[:8],
            device_name=device_name[:100],
            expires_at=timezone.now() + timedelta(days=ttl),
        )
        return token, raw

    def revoke(self) -> None:
        self.revoked_at = timezone.now()
        self.save(update_fields=["revoked_at", "updated_at"])
