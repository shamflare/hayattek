from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from django.utils.translation import gettext as _
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler


class DomainError(exceptions.APIException):
    """Business-rule violation with a stable machine code and an Arabic message."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "domain_error"

    def __init__(self, message: str, code: str | None = None, status_code: int | None = None):
        super().__init__(detail=message, code=code or self.default_code)
        if status_code:
            self.status_code = status_code


class Conflict(DomainError):
    status_code = status.HTTP_409_CONFLICT
    default_code = "conflict"


def api_exception_handler(exc, context):
    """Uniform error body: {"code", "message", "fields"?}. Never leaks internals."""
    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(
            exc.message_dict if hasattr(exc, "error_dict") else exc.messages
        )
    elif isinstance(exc, Http404):
        exc = exceptions.NotFound(_("العنصر غير موجود أو لا تملك صلاحية الوصول إليه."))
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied()

    response = exception_handler(exc, context)
    if response is None:
        return None

    if isinstance(exc, exceptions.ValidationError):
        body = {
            "code": "validation_error",
            "message": _("يرجى مراجعة البيانات المدخلة."),
            "fields": response.data,
        }
    else:
        detail = response.data.get("detail", "") if isinstance(response.data, dict) else ""
        code = getattr(detail, "code", None) or getattr(exc, "default_code", "error")
        body = {"code": code, "message": str(detail) or _("حدث خطأ.")}
    return Response(body, status=response.status_code, headers=response.headers)
