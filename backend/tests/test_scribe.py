"""HayatTek AI scribe — PHASE2 §37 (+ billing link §23, privacy §18).

Uses the mock speech provider with synthetic Syrian-Arabic recordings and the real wallet.
"""

import uuid
from decimal import Decimal

import pytest

from apps.billing import services as billing
from apps.billing.models import AIUsageRecord, LedgerTransaction
from apps.clinical.models import Condition, Encounter
from apps.medications.models import Prescription
from apps.organizations.models import Role
from apps.scribe import samples
from apps.scribe.extraction import extract_fields, numerify
from apps.scribe.models import ScribeSession
from apps.scribe.providers import MockSpeechToText, Segment

pytestmark = pytest.mark.django_db


@pytest.fixture
def enabled_doctor(doctor, platform_admin):
    billing.set_ai_access(doctor.user.practitioner, enabled=True, actor=platform_admin.user)
    billing.set_custom_rate(doctor.user.practitioner, Decimal("0.10"), actor=platform_admin.user)
    return doctor


@pytest.fixture
def visit(enabled_doctor, reception, make_patient):
    patient = make_patient(reception)
    r = enabled_doctor.post("/api/v1/clinical/encounters", {"patient": patient["id"]})
    assert r.status_code == 201
    return r.data


def _start(actor, visit, mode="conversation", consent="verbal", key=None):
    return actor.post("/api/v1/scribe/sessions", {
        "encounter": visit["id"], "mode": mode, "consent_method": consent,
        "client_key": key or uuid.uuid4().hex})


def _run_sample(actor, visit, sample, capture, mode=None):
    mode = mode or samples.SAMPLES[sample]["mode"]
    consent = "verbal" if mode == "conversation" else "not_required"
    session = _start(actor, visit, mode=mode, consent=consent).data
    with capture(execute=True):
        r = actor.post(f"/api/v1/scribe/sessions/{session['id']}/sample", {"sample": sample})
    assert r.status_code == 200, r.data
    return actor.get(f"/api/v1/scribe/sessions/{session['id']}").data


# ------------------------------------------------------------------ extraction quality


def _segments(sample_id):
    return [Segment(id=f"s{i + 1}", speaker=s, speaker_confidence=0.95, start=a, end=b, text=t)
            for i, (s, a, b, t) in enumerate(samples.SAMPLES[sample_id]["segments"])]


def test_numerify_syrian_numbers():
    assert numerify("الضغط مية وخمسين على تسعين") == "الضغط 150 علي 90"
    assert numerify("الحرارة تمانية وتلاتين ونص") == "الحراره 38.5"
    assert "1000" in numerify("لألف ملغ")


@pytest.mark.parametrize("sample_id", list(samples.SAMPLES))
def test_extraction_matches_expected(sample_id):
    exp = samples.SAMPLES[sample_id]["expected"]
    fields, _ = extract_fields(_segments(sample_id), mode=samples.SAMPLES[sample_id]["mode"],
                               catalog={}, lab_tests={})
    for key, value in exp.get("vitals", {}).items():
        assert fields["vitals"][key]["value"] == value, key
    diagnoses = [(d["value"]["display"], d["value"]["certainty"]) for d in fields["diagnoses"]]
    for display, certainty in exp["diagnoses"]:
        assert any(display in got and c == certainty for got, c in diagnoses), diagnoses
    prescribed = fields["prescribed_medications"]
    assert [p["value"]["name"] for p in prescribed] == [n for n, _, _ in exp["prescribed"]]
    for p, (_, amount, unit) in zip(prescribed, exp["prescribed"], strict=True):
        assert p["value"]["dose_amount"] == amount and p["value"]["dose_unit"] == unit
    assert sorted(o["value"]["modality"] for o in fields["imaging_orders"]) == sorted(exp["imaging"])
    labs = [o["value"]["name"] for o in fields["lab_orders"]]
    for lab in exp["labs"]:
        assert any(lab in got for got in labs), labs
    if "follow_up_contains" in exp:
        assert exp["follow_up_contains"] in fields["follow_up"]["value"].replace("اسبوع", "أسبوع")
    for substance in exp.get("allergies", []):
        assert any(substance in a["value"]["substance"] for a in fields["allergies"])
    if exp.get("unnamed_current_medication"):
        assert any(m["value"]["name"] is None and m["needs_review"]
                   for m in fields["current_medications"])
    for name in exp.get("current_medications", []):
        assert any(m["value"]["name"] == name for m in fields["current_medications"])


def test_never_invents_dose_or_diagnosis():
    fields, _ = extract_fields(_segments("child_cough_no_dose"), mode="conversation",
                               catalog={}, lab_tests={})
    rx = fields["prescribed_medications"][0]
    assert rx["value"]["dose_amount"] is None and rx["needs_review"]
    assert "الجرعة" in rx["review_reason"]
    # Patient statements never become diagnoses.
    patient_only = [Segment("s1", "patient", 0.9, 0, 3, "التشخيص عندي سكري من زمان")]
    fields, _ = extract_fields(patient_only, mode="conversation", catalog={}, lab_tests={})
    assert fields["diagnoses"] == []


def test_unknown_speaker_is_flagged():
    segs = [Segment("s1", "unknown", 0.0, 0, 3, "غالباً صداع توتري")]
    fields, warnings = extract_fields(segs, mode="conversation", catalog={}, lab_tests={})
    assert fields["diagnoses"][0]["needs_review"] and warnings


# ------------------------------------------------------------------ end-to-end session flow


def test_full_session_bills_once_and_approval_creates_drafts(
        enabled_doctor, visit, django_capture_on_commit_callbacks):
    data = _run_sample(enabled_doctor, visit, "chest_pain_conversation",
                       django_capture_on_commit_callbacks)
    assert data["status"] == "ready" and data["is_mock"]
    assert data["transcript"]["segments"][0]["speaker"] == "doctor"
    assert data["billing"]["amount"] == "0.20"  # 80 s → 2 billable minutes × 0.10
    session = ScribeSession.objects.get(pk=data["id"])
    practitioner = enabled_doctor.user.practitioner
    assert billing.practitioner_wallet(practitioner).balance == Decimal("-0.20")

    # Reprocessing the same session (task redelivery) never bills again.
    from apps.scribe.services import process_session

    session.status = "uploaded"
    session.save()
    process_session(session.pk)
    assert AIUsageRecord.objects.filter(session_id=session.pk).count() == 1
    assert LedgerTransaction.objects.filter(kind="ai_usage").count() == 1

    fields = data["draft"]["fields"]
    r = enabled_doctor.post(f"/api/v1/scribe/sessions/{data['id']}/approve", {
        "reason": "ألم صدري", "complaint": fields["chief_complaint"]["value"],
        "assessment": "ذبحة صدرية مستقرة (مشتبه)", "plan": "تحاليل وتخطيط قلب",
        "vitals": {"bp_systolic": 150, "bp_diastolic": 90, "heart_rate": 86},
        "diagnoses": [{"display": "ذبحة صدرية مستقرة", "certainty": "suspected"}],
        "allergies": [{"substance": "البنسلين", "reaction": "طفح"}],
        "prescription_items": [{"medication_name": "Aspirin", "dose_amount": "100",
                                "dose_unit": "mg", "schedule_type": "times_per_day",
                                "times_per_day": 1, "meal_relation": "after"}],
        "orders": [{"kind": "imaging", "modality": "ecg"}],
        "finalize_encounter": False,
    })
    assert r.status_code == 200, r.data
    assert r.data["status"] == "approved"
    enc = Encounter.objects.get(pk=visit["id"])
    assert enc.complaint and enc.vitals["bp_systolic"] == 150
    assert "HayatTek AI" in enc.notes and practitioner.display_name in enc.notes
    assert enc.status == "draft"  # the doctor finalizes the visit explicitly
    rx = Prescription.objects.get(pk=r.data["applied"]["prescription"])
    assert rx.status == "draft"  # never auto-approved
    assert Condition.objects.filter(encounter=enc).count() == 1
    # Approving twice is refused; still a single charge.
    again = enabled_doctor.post(f"/api/v1/scribe/sessions/{data['id']}/approve", {})
    assert again.status_code == 409
    assert billing.practitioner_wallet(practitioner).balance == Decimal("-0.20")


def test_provider_failure_not_billed_then_retry_billed_once(
        enabled_doctor, visit, django_capture_on_commit_callbacks):
    MockSpeechToText.fail_next = ["provider_timeout"]
    data = _run_sample(enabled_doctor, visit, "diabetes_dictation",
                       django_capture_on_commit_callbacks, mode="dictation")
    assert data["status"] == "failed" and data["error_code"] == "provider_timeout"
    practitioner = enabled_doctor.user.practitioner
    assert billing.practitioner_wallet(practitioner).balance == Decimal("0")
    usage = AIUsageRecord.objects.get(session_id=data["id"])
    assert usage.status == "not_billable" and usage.provider_cost > 0
    with django_capture_on_commit_callbacks(execute=True):
        r = enabled_doctor.post(f"/api/v1/scribe/sessions/{data['id']}/retry")
    assert r.status_code == 200
    data = enabled_doctor.get(f"/api/v1/scribe/sessions/{data['id']}").data
    assert data["status"] == "ready" and data["attempts"] == 2
    assert billing.practitioner_wallet(practitioner).balance == Decimal("-0.10")


def test_consent_required_for_conversation(enabled_doctor, visit):
    r = _start(enabled_doctor, visit, mode="conversation", consent="not_required")
    assert r.status_code == 400 and r.data["code"] == "consent_required"
    assert _start(enabled_doctor, visit, mode="dictation", consent="not_required").status_code == 201


def test_start_is_idempotent(enabled_doctor, visit):
    key = uuid.uuid4().hex
    a = _start(enabled_doctor, visit, key=key).data
    b = _start(enabled_doctor, visit, key=key).data
    assert a["id"] == b["id"] and ScribeSession.objects.count() == 1


def test_access_control(enabled_doctor, visit, reception, other_doctor, platform_admin,
                        make_actor, clinic):
    session = _start(enabled_doctor, visit).data
    assert _start(reception, visit).status_code == 403
    assert reception.get(f"/api/v1/scribe/sessions/{session['id']}").status_code == 403
    assert other_doctor.get(f"/api/v1/scribe/sessions/{session['id']}").status_code == 404
    colleague = make_actor(clinic, [Role.PHYSICIAN])
    assert colleague.get(f"/api/v1/scribe/sessions/{session['id']}").status_code == 404
    assert platform_admin.get(f"/api/v1/scribe/sessions/{session['id']}").status_code == 403
    # Another doctor cannot attach a session to someone else's visit.
    billing.set_ai_access(colleague.user.practitioner, enabled=True, actor=None)
    assert _start(colleague, visit).status_code == 404


def test_postpaid_debt_never_blocks_but_manual_switch_does(
        enabled_doctor, visit, platform_admin, django_capture_on_commit_callbacks):
    practitioner = enabled_doctor.user.practitioner
    wallet = billing.practitioner_wallet(practitioner)
    billing.adjust(wallet, kind="manual_debit", amount=Decimal("1000"), reason="دين تجريبي",
                   actor=platform_admin.user)
    data = _run_sample(enabled_doctor, visit, "child_cough_no_dose",
                       django_capture_on_commit_callbacks)
    assert data["status"] == "ready"  # still served with $1000+ debt
    url = f"/api/v1/billing/admin/practitioners/{practitioner.pk}/ai-access"
    # In-flight policy: a session already started finishes and is billed once.
    pending = _start(enabled_doctor, visit).data
    platform_admin.post(url, {"enabled": False, "reason": "قرار إداري"})
    r = _start(enabled_doctor, visit)
    assert r.status_code == 403 and r.data["code"] == "ai_disabled"
    with django_capture_on_commit_callbacks(execute=True):
        enabled_doctor.post(f"/api/v1/scribe/sessions/{pending['id']}/sample",
                            {"sample": "child_cough_no_dose"})
    assert enabled_doctor.get(f"/api/v1/scribe/sessions/{pending['id']}").data["status"] == "ready"
    platform_admin.post(url, {"enabled": True})
    assert _start(enabled_doctor, visit).status_code == 201


def test_audio_encrypted_at_rest_and_deletable(enabled_doctor, visit,
                                                django_capture_on_commit_callbacks):
    data = _run_sample(enabled_doctor, visit, "child_cough_no_dose",
                       django_capture_on_commit_callbacks)
    session = ScribeSession.objects.get(pk=data["id"])
    with session.audio_file.open("rb") as fh:
        stored = fh.read()
    assert not stored.startswith(b"RIFF") and b"child_cough" not in stored
    played = enabled_doctor.get(f"/api/v1/scribe/sessions/{data['id']}/audio")
    assert played.status_code == 200 and played.content.startswith(b"RIFF")
    deleted = enabled_doctor.client.delete(f"/api/v1/scribe/sessions/{data['id']}/audio")
    assert deleted.status_code == 200 and deleted.data["audio_available"] is False
    assert enabled_doctor.get(f"/api/v1/scribe/sessions/{data['id']}/audio").status_code == 404


def test_invalid_and_interrupted_audio(enabled_doctor, visit, django_capture_on_commit_callbacks):
    from django.core.files.uploadedfile import SimpleUploadedFile

    session = _start(enabled_doctor, visit).data
    bad = SimpleUploadedFile("x.wav", b"not audio at all" * 10, content_type="audio/wav")
    r = enabled_doctor.client.post(f"/api/v1/scribe/sessions/{session['id']}/audio",
                                   {"file": bad}, format="multipart")
    assert r.status_code == 400 and r.data["code"] == "invalid_audio"
    # A recording cut off mid-stream (header claims more data than present) is accepted
    # with its real duration.
    wav = samples.build_wav("child_cough_no_dose")
    truncated = wav[: len(wav) // 2]
    with django_capture_on_commit_callbacks(execute=True):
        r = enabled_doctor.client.post(
            f"/api/v1/scribe/sessions/{session['id']}/audio",
            {"file": SimpleUploadedFile("a.wav", truncated, content_type="audio/wav")},
            format="multipart")
    assert r.status_code == 200, r.data
    assert 10 <= r.data["audio_seconds"] <= 14


def test_patient_cannot_reach_scribe(enabled_doctor, visit, make_user, reception):
    from tests.conftest import Actor

    patient_user = Actor(make_user())
    assert patient_user.get("/api/v1/scribe/status").status_code == 403
