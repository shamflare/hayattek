"""SMS provider interface. Choosing a real provider is a cost/legal decision for the owner
(ADR-014); development prints messages to the log."""

import logging

from django.conf import settings
from django.utils.module_loading import import_string

logger = logging.getLogger("hayat.sms")


class SmsProvider:
    def send(self, phone: str, message: str) -> None:
        raise NotImplementedError


class ConsoleSmsProvider(SmsProvider):
    sent: list[tuple[str, str]] = []  # inspected by tests

    def send(self, phone: str, message: str) -> None:
        ConsoleSmsProvider.sent.append((phone, message))
        # Only the last digits of the number are logged.
        logger.info("SMS to ***%s: %s", phone[-3:], message)


def get_sms_provider() -> SmsProvider:
    return import_string(settings.HAYAT["SMS_PROVIDER"])()
