"""Delivery provider interfaces (SMS + email) and the result object they return.

Choosing a paid provider is the owner's decision (ADR-014, PHASE2 §5). Until one is configured
the production defaults are *NotConfigured* providers: they never pretend a message was
delivered, and callers surface that honestly (e.g. "use in-person verification").
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from django.conf import settings
from django.core.mail import EmailMessage
from django.utils.module_loading import import_string

logger = logging.getLogger("hayat.messaging")


@dataclass(frozen=True)
class SendResult:
    status: str  # "sent" | "failed" | "not_configured"
    provider: str = ""
    provider_message_id: str = ""
    error: str = ""  # short machine-readable reason, never message content or recipient
    retryable: bool = True

    @classmethod
    def sent(cls, provider: str, message_id: str = "") -> SendResult:
        return cls(status="sent", provider=provider, provider_message_id=message_id)

    @classmethod
    def failed(cls, provider: str, error: str, *, retryable: bool = True) -> SendResult:
        return cls(status="failed", provider=provider, error=error[:200], retryable=retryable)

    @classmethod
    def not_configured(cls, provider: str) -> SendResult:
        return cls(status="not_configured", provider=provider, retryable=False)


class EmailProvider:
    name = "base"
    configured = True

    def send(self, to: str, subject: str, body: str) -> SendResult:
        raise NotImplementedError


class DjangoEmailProvider(EmailProvider):
    """Uses Django's configured mail backend (SMTP in production, console/locmem in dev/tests)."""

    name = "django_mail"

    def send(self, to: str, subject: str, body: str) -> SendResult:
        sent = EmailMessage(subject=subject, body=body, to=[to]).send(fail_silently=False)
        if sent:
            return SendResult.sent(self.name)
        return SendResult.failed(self.name, "backend_returned_0")


class NotConfiguredEmailProvider(EmailProvider):
    """Production default while no SMTP account exists: records ``not_configured``."""

    name = "email_not_configured"
    configured = False

    def send(self, to: str, subject: str, body: str) -> SendResult:
        return SendResult.not_configured(self.name)


def get_email_provider() -> EmailProvider:
    return import_string(settings.HAYAT["EMAIL_PROVIDER"])()
