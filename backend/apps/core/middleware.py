import contextvars
import uuid

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class RequestIdMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        incoming = request.headers.get("X-Request-ID", "")
        rid = incoming if 8 <= len(incoming) <= 64 and incoming.isalnum() else uuid.uuid4().hex
        token = request_id_var.set(rid)
        request.request_id = rid
        try:
            response = self.get_response(request)
        finally:
            request_id_var.reset(token)
        response["X-Request-ID"] = rid
        return response


def client_ip(request) -> str | None:
    # Behind a trusted reverse proxy in production, nginx sets X-Real-IP.
    return request.META.get("HTTP_X_REAL_IP") or request.META.get("REMOTE_ADDR")
