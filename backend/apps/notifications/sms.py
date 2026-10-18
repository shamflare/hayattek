"""SMS provider interface. Choosing a real provider is a cost/legal decision for the owner
(ADR-014); development prints messages to the log. Callers never use a provider directly:
they go through the outbox (``apps.notifications.messaging.send_message``)."""

import logging

from django.conf import settings
from django.utils.module_loading import import_string

from .providers import SendResult

logger = logging.getLogger("hayat.sms")


class SmsProvider:
    name = "base"
    configured = True  # False => the outbox records `not_configured` without trying

    def send(self, phone: str, message: str) -> SendResult:
        raise NotImplementedError


class ConsoleSmsProvider(SmsProvider):
    """Development/tests only (production settings refuse it). Nothing leaves the machine."""

    name = "console"
    sent: list[tuple[str, str]] = []  # inspected by tests

    def send(self, phone: str, message: str) -> SendResult:
        ConsoleSmsProvider.sent.append((phone, message))
        # Only the last digits of the number are logged.
        logger.info("SMS to ***%s: %s", phone[-3:], message)
        return SendResult.sent(self.name)


class NotConfiguredSmsProvider(SmsProvider):
    """Production default until the owner picks a gateway: never pretends delivery."""

    name = "sms_not_configured"
    configured = False

    def send(self, phone: str, message: str) -> SendResult:
        return SendResult.not_configured(self.name)


class HttpSmsGatewayProvider(SmsProvider):
    """Skeleton for a real HTTP SMS gateway. DISABLED: no vendor chosen, no credentials.

    To enable after the owner's decision: implement ``send`` (POST to the vendor with a short
    timeout; map 2xx -> ``SendResult.sent(name, vendor_id)``, 4xx -> ``failed(retryable=False)``,
    5xx/timeouts -> ``failed(retryable=True)``), read the key from an environment variable
    (never commit it), flip ``configured`` and set ``HAYAT_SMS_PROVIDER`` to this class.
    """

    name = "http_gateway"
    configured = False

    def send(self, phone: str, message: str) -> SendResult:
        return SendResult.not_configured(self.name)


def get_sms_provider() -> SmsProvider:
    return import_string(settings.HAYAT["SMS_PROVIDER"])()
