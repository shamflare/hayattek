from __future__ import annotations

from typing import TYPE_CHECKING, Any

from apps.core.middleware import client_ip

from .models import AuditEvent, AuditOutcome

if TYPE_CHECKING:
    from apps.access.context import PracticeContext


class Action:
    AUTH_LOGIN = "auth.login"
    AUTH_LOGIN_FAILED = "auth.login_failed"
    AUTH_LOGOUT = "auth.logout"
    AUTH_PASSWORD_CHANGED = "auth.password_changed"  # noqa: S105
    AUTH_MFA_CHANGED = "auth.mfa_changed"
    PATIENT_CREATE = "patient.create"
    PATIENT_VIEW = "patient.view"
    PATIENT_UPDATE = "patient.update"
    PATIENT_SEARCH = "patient.search"
    PATIENT_REGISTER = "patient.register"
    CARD_RESOLVE = "card.resolve"
    CARD_ISSUE = "card.issue"
    CARD_REVOKE = "card.revoke"
    RECORD_VIEW = "record.view"
    RECORD_CREATE = "record.create"
    RECORD_UPDATE_DRAFT = "record.update_draft"
    RECORD_FINALIZE = "record.finalize"
    RECORD_AMEND = "record.amend"
    RECORD_ENTERED_IN_ERROR = "record.entered_in_error"
    RECORD_PRINT = "record.print"
    DOCUMENT_UPLOAD = "document.upload"
    DOCUMENT_DOWNLOAD = "document.download"
    DOCUMENT_OCR_RUN = "document.ocr_run"
    DOCUMENT_OCR_VIEW = "document.ocr_view"
    DOCUMENT_OCR_CONVERT = "document.ocr_convert"
    DOCUMENT_SCAN_REJECTED = "document.scan_rejected"
    GRANT_CREATE = "grant.create"
    GRANT_REVOKE = "grant.revoke"
    ACCESS_REQUEST = "access.request"
    ACCESS_DECISION = "access.decision"
    ACCESS_DENIED = "access.denied"
    MEMBERSHIP_CHANGE = "membership.change"
    ORGANIZATION_CHANGE = "organization.change"
    PRACTITIONER_VERIFY = "practitioner.verify"
    EXPORT = "export"


def record(
    action: str,
    *,
    request=None,
    actor=None,
    ctx: PracticeContext | None = None,
    target: Any = None,
    target_type: str = "",
    target_id: str = "",
    patient_id=None,
    outcome: str = AuditOutcome.SUCCESS,
    metadata: dict | None = None,
) -> AuditEvent:
    """Write one audit event. Call inside the same transaction as the audited change."""
    if ctx is not None:
        actor = actor or ctx.user
    if actor is None and request is not None and getattr(request, "user", None):
        actor = request.user if request.user.is_authenticated else None
    if target is not None:
        target_type = target_type or target._meta.label_lower
        target_id = target_id or str(target.pk)
        if patient_id is None:
            patient_id = getattr(target, "patient_id", None)

    return AuditEvent.objects.create(
        actor_id=getattr(actor, "pk", None),
        membership_id=ctx.membership.pk if ctx and ctx.membership else None,
        organization_id=ctx.organization.pk if ctx and ctx.organization else None,
        action=action,
        outcome=outcome,
        target_type=target_type,
        target_id=target_id,
        patient_id=patient_id,
        ip_address=client_ip(request) if request is not None else None,
        user_agent=(request.headers.get("User-Agent", "")[:256] if request is not None else ""),
        request_id=getattr(request, "request_id", "") if request is not None else "",
        metadata=metadata or {},
    )
