"""AIProcessingService: session lifecycle (docs/AI_SCRIBE.md).

created → uploaded → processing → ready (billed once) → approved
                              ↘ failed (not billed; retry allowed)
Starting a session checks ONLY the manual admin switch (apps.billing.services.ai_enabled),
never the doctor's balance (PHASE2 §19, §30).
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.translation import gettext as _

from apps.access.context import PracticeContext
from apps.audit import services as audit
from apps.billing import services as billing
from apps.clinical import records
from apps.clinical.models import Encounter
from apps.core.arabic import normalize_arabic
from apps.core.exceptions import DomainError
from apps.core.ids import random_code

from . import audio, providers, samples
from .models import ConsentMethod, ScribeMode, ScribeSession, SessionStatus


def _require_doctor(ctx: PracticeContext | None):
    if ctx is None or not ctx.is_clinician:
        raise DomainError(_("المساعد الذكي متاح للأطباء المعتمدين فقط."), code="forbidden",
                          status_code=403)


def ensure_enabled(ctx: PracticeContext) -> None:
    """Manual admin switch only. Debt is intentionally NOT checked here (postpaid)."""
    if not billing.ai_enabled(ctx.practitioner):
        raise DomainError(
            _("خدمة HayatTek AI غير مفعلة لحسابك. تواصل مع إدارة المنصة لتفعيلها."),
            code="ai_disabled", status_code=403)


@transaction.atomic
def start_session(ctx: PracticeContext, *, encounter: Encounter, mode: str, consent_method: str,
                  consent_note: str = "", client_key: str, request=None) -> ScribeSession:
    _require_doctor(ctx)
    ensure_enabled(ctx)
    existing = ScribeSession.objects.filter(practitioner=ctx.practitioner,
                                            client_key=client_key).first()
    if existing is not None:  # idempotent retry of the same "start" click
        return existing
    if encounter.author_id != ctx.user.pk or encounter.organization_id != ctx.organization.pk \
            or not encounter.is_draft:
        raise DomainError(_("يعمل المساعد على مسودة زيارة أنشأتها أنت في هذه المنشأة."),
                          code="invalid_encounter", status_code=409)
    if mode == ScribeMode.CONVERSATION and consent_method not in (ConsentMethod.VERBAL,
                                                                   ConsentMethod.WRITTEN):
        raise DomainError(_("تسجيل الحوار يتطلب موافقة المريض. اختر طريقة الموافقة أو استخدم "
                            "الإملاء أو الإدخال اليدوي."), code="consent_required")
    if mode == ScribeMode.DICTATION and consent_method not in ConsentMethod.values:
        consent_method = ConsentMethod.NOT_REQUIRED
    try:
        with transaction.atomic():
            session = ScribeSession.objects.create(
                encounter=encounter, patient=encounter.patient, organization=ctx.organization,
                practitioner=ctx.practitioner, author=ctx.user, mode=mode,
                consent_method=consent_method, consent_note=consent_note[:300],
                consent_at=timezone.now(), client_key=client_key[:64],
            )
    except IntegrityError:
        return ScribeSession.objects.get(practitioner=ctx.practitioner, client_key=client_key)
    audit.record("scribe.start", request=request, ctx=ctx, target=session,
                 metadata={"mode": mode, "consent": consent_method})
    return session


def _validate_and_store_audio(session: ScribeSession, data: bytes, *, is_sample: bool) -> None:
    if len(data) > audio.MAX_UPLOAD_BYTES:
        raise DomainError(_("التسجيل أكبر من الحد المسموح."), code="audio_too_large")
    info = audio.parse_wav(data)
    seconds = round(info.seconds)
    if seconds < 1:
        raise DomainError(_("التسجيل فارغ أو قصير جداً."), code="audio_too_short")
    if seconds > settings.HAYAT["AI_MAX_AUDIO_SECONDS"]:
        raise DomainError(_("التسجيل أطول من الحد المسموح."), code="audio_too_long")
    session.audio_sha256 = audio.sha256(data)
    session.audio_seconds = seconds
    session.audio_bytes = len(data)
    session.audio_is_sample = is_sample
    session.retention_until = timezone.now() + timedelta(
        days=settings.HAYAT["AI_AUDIO_RETENTION_DAYS"])
    session.audio_file.save(f"{session.pk.hex}.enc", ContentFile(audio.encrypt(data)), save=False)


@transaction.atomic
def upload_audio(ctx: PracticeContext, session: ScribeSession, data: bytes, *,
                 is_sample: bool = False, request=None) -> ScribeSession:
    session = ScribeSession.objects.select_for_update().get(pk=session.pk)
    _require_author(ctx, session)
    if session.status != SessionStatus.CREATED:
        if session.audio_sha256 and session.audio_sha256 == audio.sha256(data):
            return session  # same file re-sent after a network drop: idempotent
        raise DomainError(_("تم رفع تسجيل لهذه الجلسة مسبقاً."), code="already_uploaded",
                          status_code=409)
    _validate_and_store_audio(session, data, is_sample=is_sample)
    session.status = SessionStatus.UPLOADED
    session.save()
    audit.record("scribe.upload", request=request, ctx=ctx, target=session,
                 metadata={"seconds": session.audio_seconds, "sample": is_sample})
    transaction.on_commit(lambda: _enqueue(session.pk))
    return session


def _enqueue(session_id) -> None:
    from .tasks import process_session_task

    process_session_task.delay(str(session_id))


def _require_author(ctx: PracticeContext | None, session: ScribeSession) -> None:
    if ctx is None or session.author_id != ctx.user.pk \
            or session.organization_id != ctx.organization.pk:
        raise DomainError(_("الجلسة غير موجودة."), code="not_found", status_code=404)


def _context_for_extraction() -> dict:
    from apps.diagnostics.models import LabTestType
    from apps.medications.models import Medication

    catalog = {}
    for name, brand in Medication.objects.filter(is_active=True).values_list("name", "brand_name"):
        for label in (name, brand):
            if label:
                catalog[normalize_arabic(label)] = name
    lab_tests = {normalize_arabic(t.name_ar): {"id": str(t.pk), "code": t.code, "name": t.name_ar}
                 for t in LabTestType.objects.filter(is_active=True)}
    return {"catalog": catalog, "lab_tests": lab_tests}


def process_session(session_id) -> ScribeSession:
    """Idempotent: safe under task retries, duplicate deliveries and worker restarts."""
    with transaction.atomic():
        session = ScribeSession.objects.select_for_update().get(pk=session_id)
        if session.status in (SessionStatus.READY, SessionStatus.APPROVED,
                              SessionStatus.DISCARDED, SessionStatus.CREATED):
            return session
        if session.status == SessionStatus.PROCESSING and session.processing_started_at and \
                session.processing_started_at > timezone.now() - timedelta(minutes=10):
            return session  # another worker is on it
        session.status = SessionStatus.PROCESSING
        session.attempts += 1
        session.processing_started_at = timezone.now()
        session.error_code = ""
        session.save(update_fields=["status", "attempts", "processing_started_at", "error_code",
                                    "updated_at"])

    cost = Decimal("0")
    cost_actual = False
    try:
        with session.audio_file.open("rb") as fh:
            raw = audio.decrypt(fh.read())
        stt = providers.get_stt()
        transcript = stt.transcribe(raw, mode=session.mode)
        cost += transcript.cost
        cost_actual = transcript.cost_is_actual
        extractor = providers.get_extractor()
        result = extractor.extract(transcript, mode=session.mode, context=_context_for_extraction())
        cost += result.cost
        cost_actual = cost_actual and result.cost_is_actual
    except providers.ProviderError as exc:
        _fail(session, exc.code, cost + exc.cost)
        raise
    except Exception:
        _fail(session, "processing_error", cost)
        raise

    with transaction.atomic():
        session = ScribeSession.objects.select_for_update().get(pk=session_id)
        if session.status != SessionStatus.PROCESSING:
            return session
        session.transcript = {
            "language": transcript.language, "provider": transcript.provider,
            "diarization": transcript.diarization,
            "segments": [s.__dict__ for s in transcript.segments],
        }
        session.draft = {"fields": result.fields, "warnings": result.warnings,
                         "provider": result.provider}
        session.stt_provider = transcript.provider
        session.extraction_provider = result.provider
        session.is_mock = transcript.is_mock
        session.status = SessionStatus.READY
        session.ready_at = timezone.now()
        session.save()
        # Billed when the reviewable draft becomes available (PHASE2 §23) — exactly once.
        billing.charge_ai_session(
            session_id=session.pk, practitioner=session.practitioner,
            organization=session.organization, audio_seconds=session.audio_seconds,
            provider_cost=cost, provider_cost_is_actual=cost_actual)
    audit.record("scribe.ready", actor=session.author, target=session,
                 metadata={"seconds": session.audio_seconds, "attempt": session.attempts})
    return session


def _fail(session: ScribeSession, code: str, cost: Decimal) -> None:
    with transaction.atomic():
        ScribeSession.objects.filter(pk=session.pk, status=SessionStatus.PROCESSING).update(
            status=SessionStatus.FAILED, error_code=code[:40], updated_at=timezone.now())
        billing.record_failed_session(session_id=session.pk, practitioner=session.practitioner,
                                      organization=session.organization, provider_cost=cost)
    audit.record("scribe.failed", actor=session.author, target=session, metadata={"code": code})


@transaction.atomic
def retry(ctx: PracticeContext, session: ScribeSession, request=None) -> ScribeSession:
    session = ScribeSession.objects.select_for_update().get(pk=session.pk)
    _require_author(ctx, session)
    if session.status != SessionStatus.FAILED:
        raise DomainError(_("لا يمكن إعادة المحاولة إلا بعد فشل المعالجة."), code="not_failed",
                          status_code=409)
    session.status = SessionStatus.UPLOADED
    session.save(update_fields=["status", "updated_at"])
    audit.record("scribe.retry", request=request, ctx=ctx, target=session)
    transaction.on_commit(lambda: _enqueue(session.pk))
    return session


def use_sample(ctx: PracticeContext, session: ScribeSession, sample_id: str, request=None):
    if sample_id not in samples.SAMPLES:
        raise DomainError(_("تسجيل تجريبي غير معروف."), code="unknown_sample")
    return upload_audio(ctx, session, samples.build_wav(sample_id), is_sample=True,
                        request=request)


# ------------------------------------------------------------------ approval


TEXT_FIELDS = ("reason", "complaint", "history", "examination", "assessment", "plan",
               "follow_up_note")


@transaction.atomic
def approve(ctx: PracticeContext, session: ScribeSession, payload: dict, request=None):
    """Apply what the doctor reviewed. Only the payload (the doctor's edited values) is
    applied — never the raw AI draft. Prescriptions and orders are created as DRAFTS that
    the doctor finalizes through the normal editors (no automatic prescription approval)."""
    from apps.clinical.models import Allergy, Condition
    from apps.diagnostics.models import ServiceRequest
    from apps.medications.services import create_prescription

    session = ScribeSession.objects.select_for_update().get(pk=session.pk)
    _require_author(ctx, session)
    if session.status != SessionStatus.READY:
        raise DomainError(_("المسودة غير جاهزة للاعتماد أو اعتُمدت مسبقاً."), code="not_ready",
                          status_code=409)
    encounter = Encounter.objects.select_for_update().get(pk=session.encounter_id)
    if not encounter.is_draft:
        raise DomainError(_("الزيارة معتمدة مسبقاً؛ لا يمكن تطبيق المسودة عليها."),
                          code="encounter_final", status_code=409)

    changes = {k: payload[k] for k in TEXT_FIELDS if payload.get(k) is not None}
    if payload.get("vitals") is not None:
        changes["vitals"] = payload["vitals"]
    if payload.get("follow_up_date"):
        changes["follow_up_date"] = payload["follow_up_date"]
    note = _("أُعدّت المسودة بمساعدة HayatTek AI، وراجعها واعتمدها %(doc)s.") % {
        "doc": ctx.practitioner.display_name}
    changes["notes"] = "\n".join(p for p in [encounter.notes, note] if p)
    records.update_draft(ctx, encounter, changes, request=request)

    applied = {"encounter_fields": sorted(changes), "conditions": [], "allergies": [],
               "prescription": None, "service_requests": []}
    for d in payload.get("diagnoses", []):
        cond = records.create(ctx, Condition, patient=encounter.patient, request=request, data={
            "encounter": encounter, "display": d["display"][:300], "code": d.get("code", "")[:20],
            "category": d.get("category", "encounter_diagnosis"),
            "note": "مشتبه" if d.get("certainty") == "suspected" else ""})
        applied["conditions"].append(str(cond.pk))
    for a in payload.get("allergies", []):
        allergy = records.create(ctx, Allergy, patient=encounter.patient, request=request, data={
            "encounter": encounter, "substance": a["substance"][:200],
            "reaction": a.get("reaction", "")[:300], "severity": a.get("severity", "unknown")})
        applied["allergies"].append(str(allergy.pk))
    items = payload.get("prescription_items") or []
    if items:
        from apps.medications.serializers import PrescriptionItemSerializer

        ser = PrescriptionItemSerializer(data=items, many=True)
        ser.is_valid(raise_exception=True)
        rx = create_prescription(ctx, patient=encounter.patient, request=request, data={
            "encounter": encounter, "items": ser.validated_data, "diagnosis_text": "",
            "notes": ""})
        applied["prescription"] = str(rx.pk)  # stays DRAFT until the doctor finalizes it
    for order in payload.get("orders", []):
        from apps.diagnostics.models import ServiceRequestItem

        kind = order.get("kind")
        if kind not in ("lab", "imaging"):
            continue
        prefix = "LB" if kind == "lab" else "IM"
        number = f"{prefix}-{timezone.now():%y%m}-{random_code(6)}"
        sr = records.create(ctx, ServiceRequest, patient=encounter.patient, request=request, data={
            "kind": kind, "encounter": encounter, "number": number,
            "clinical_notes": order.get("note", "")[:500]})
        ServiceRequestItem.objects.create(
            request=sr, lab_test_id=order.get("lab_test") or None,
            modality=order.get("modality", ""), description=order.get("description", "")[:200])
        applied["service_requests"].append(str(sr.pk))

    session.status = SessionStatus.APPROVED
    session.approved_at = timezone.now()
    session.approved_by = ctx.user
    session.applied = applied
    session.save()
    audit.record("scribe.approve", request=request, ctx=ctx, target=session,
                 metadata={k: (len(v) if isinstance(v, list) else bool(v)) for k, v in applied.items()})
    if payload.get("finalize_encounter"):
        for child in (*Condition.objects.filter(encounter=encounter, author=ctx.user, status="draft"),
                      *Allergy.objects.filter(encounter=encounter, author=ctx.user, status="draft")):
            records.finalize(ctx, child, request=request)
        records.finalize(ctx, encounter, request=request)
    return session


@transaction.atomic
def discard(ctx: PracticeContext, session: ScribeSession, request=None) -> ScribeSession:
    session = ScribeSession.objects.select_for_update().get(pk=session.pk)
    _require_author(ctx, session)
    if session.status in (SessionStatus.APPROVED, SessionStatus.PROCESSING):
        raise DomainError(_("لا يمكن إلغاء هذه الجلسة الآن."), code="cannot_discard",
                          status_code=409)
    session.status = SessionStatus.DISCARDED
    session.save(update_fields=["status", "updated_at"])
    delete_audio(session, actor=ctx.user, request=request, reason="discarded")
    return session


def delete_audio(session: ScribeSession, *, actor=None, request=None, reason="") -> None:
    if session.audio_file and not session.audio_deleted_at:
        session.audio_file.delete(save=False)
        ScribeSession.objects.filter(pk=session.pk).update(audio_file="",
                                                           audio_deleted_at=timezone.now())
        audit.record("scribe.audio_deleted", request=request, actor=actor, target=session,
                     metadata={"reason": reason})
