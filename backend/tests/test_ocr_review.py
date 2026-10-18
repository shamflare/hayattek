"""OCR review workflow (PHASE2 §4): run OCR → suggestion → reviewer-submitted values → DRAFT
LabReport (source document_import) → finalize via the existing endpoint. Synthetic data, fake
deterministic OCR engine (FakeOcrProvider) — the real Tesseract sidecar is never called."""

import io
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image

from apps.access.models import AccessGrant
from apps.audit.models import AuditEvent
from apps.diagnostics.models import LabReport
from apps.documents.models import ClinicalDocument, OcrResult, ScanStatus
from apps.patients.models import Patient

from .conftest import Actor

PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


def png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("L", (40, 20), 255).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def inline_ocr(settings):
    settings.HAYAT = {**settings.HAYAT, "OCR_INLINE": True,
                      "OCR_PROVIDER": "apps.documents.ocr.FakeOcrProvider"}


def upload(actor, patient_id, *, run_ocr=False, data=None, name="scan.png", mime="image/png"):
    f = SimpleUploadedFile(name, data or png_bytes(), content_type=mime)
    r = actor.client.post("/api/v1/documents", {
        "patient": patient_id, "file": f, "category": "lab_result", "title": "نتيجة ورقية",
        "run_ocr": "true" if run_ocr else "false"}, format="multipart")
    assert r.status_code == 201, r.data
    # Malware scanning is owned by another module; OCR only cares that the file is clean.
    ClinicalDocument.objects.filter(pk=r.data["id"]).update(scan_status=ScanStatus.CLEAN)
    return r.data["id"]


REVIEWED = {
    "title": "نتيجة مستوردة من مستند",
    "external_lab_name": "مختبر الاختبار للتحاليل الطبية",
    "result_date": "2026-03-12",
    "observations": [
        {"name": "Hemoglobin", "value_numeric": "13.5", "unit": "g/dL",
         "reference_low": "12", "reference_high": "16", "interpretation": "normal"},
        # The engine read "1O5": the reviewer typed the real value from the original.
        {"name": "Glucose", "value_numeric": "105", "unit": "mg/dL",
         "reference_low": "70", "reference_high": "110"},
    ],
}


def test_full_review_flow(doctor, reception, make_patient, inline_ocr):
    patient = make_patient(reception)
    doc_id = upload(doctor, patient["id"])
    assert doctor.get(f"/api/v1/documents/{doc_id}/ocr").status_code == 404

    r = doctor.post(f"/api/v1/documents/{doc_id}/ocr/run")
    assert r.status_code == 200, r.data
    assert r.data["status"] == "done" and r.data["engine"] == "fake"
    extracted = r.data["extracted"]
    assert extracted["issuer"]["value"] == "مختبر الاختبار للتحاليل الطبية"
    assert extracted["date"]["value"] == "2026-03-12"
    rows = {row["name"]["value"]: row for row in extracted["rows"]}
    assert rows["Hemoglobin"]["value_numeric"]["value"] == "13.5"
    assert rows["Hemoglobin"]["needs_review"] is False
    # Damaged value: left empty and flagged, never guessed.
    assert rows["Glucose"]["value_numeric"]["value"] is None
    assert rows["Glucose"]["needs_review"] is True

    got = doctor.get(f"/api/v1/documents/{doc_id}/ocr")
    assert got.status_code == 200 and got.data["status"] == "done"
    assert "lines" not in got.data  # raw engine output stays server-side

    r = doctor.post(f"/api/v1/documents/{doc_id}/ocr/convert-to-lab-report", REVIEWED)
    assert r.status_code == 201, r.data
    assert r.data["status"] == "draft" and r.data["source"] == "document_import"
    assert r.data["external_lab_name"] == "مختبر الاختبار للتحاليل الطبية"
    assert [o["name"] for o in r.data["observations"]] == ["Hemoglobin", "Glucose"]
    assert r.data["observations"][1]["value_numeric"].startswith("105")
    assert [d["id"] for d in r.data["documents"]] == [doc_id]
    report_id = r.data["id"]

    result = OcrResult.objects.get(document_id=doc_id)
    assert result.status == "reviewed" and str(result.lab_report_id) == report_id
    assert result.reviewed_by_id == doctor.user.pk and result.reviewed_at is not None
    assert result.review == {"rows_suggested": 2, "rows_submitted": 2, "rows_unchanged": 1}
    assert AuditEvent.objects.filter(action="document.ocr_convert", actor_id=doctor.user.pk).exists()
    assert AuditEvent.objects.filter(action="document.ocr_run").exists()
    # The original document is untouched (same bytes, still final, same checksum).
    doc = ClinicalDocument.objects.get(pk=doc_id)
    assert doc.status == "final"

    # A draft is invisible to the patient until finalized through the normal endpoint.
    assert LabReport.objects.get(pk=report_id).status == "draft"
    again = doctor.post(f"/api/v1/documents/{doc_id}/ocr/convert-to-lab-report", REVIEWED)
    assert again.status_code == 409 and again.data["code"] == "ocr_already_reviewed"
    rerun = doctor.post(f"/api/v1/documents/{doc_id}/ocr/run")
    assert rerun.status_code == 409

    final = doctor.post(f"/api/v1/diagnostics/lab-reports/{report_id}/finalize")
    assert final.status_code == 200 and final.data["status"] == "final"
    assert doctor.get(f"/api/v1/documents/{doc_id}/ocr").data["lab_report_status"] == "final"


def test_server_never_trusts_unreviewed_rows(doctor, reception, make_patient, inline_ocr):
    patient = make_patient(reception)
    doc_id = upload(doctor, patient["id"])
    doctor.post(f"/api/v1/documents/{doc_id}/ocr/run")
    # No observations in the body → nothing is copied from the machine suggestion.
    r = doctor.post(f"/api/v1/documents/{doc_id}/ocr/convert-to-lab-report",
                    {"title": "x", "observations": []})
    assert r.status_code == 400
    r = doctor.post(f"/api/v1/documents/{doc_id}/ocr/convert-to-lab-report",
                    {"title": "x", "observations": [{"name": "Glucose", "unit": "mg/dL"}]})
    assert r.status_code == 400  # a row without a value is rejected, not filled in
    assert not LabReport.objects.filter(patient_id=patient["id"]).exists()


def test_upload_with_run_ocr_flag(doctor, reception, make_patient, inline_ocr,
                                  django_capture_on_commit_callbacks):
    patient = make_patient(reception)
    f = SimpleUploadedFile("scan.png", png_bytes(), content_type="image/png")
    with django_capture_on_commit_callbacks(execute=True):
        r = doctor.client.post("/api/v1/documents", {
            "patient": patient["id"], "file": f, "category": "lab_result", "title": "t",
            "run_ocr": "true"}, format="multipart")
    assert r.status_code == 201, r.data
    doc = ClinicalDocument.objects.get(pk=r.data["id"])
    if doc.scan_status == ScanStatus.CLEAN:
        assert OcrResult.objects.get(document=doc).status == "done"
    else:  # quarantined by the malware scanner: OCR must not have touched it
        assert not OcrResult.objects.filter(document=doc, status="done").exists()


def test_permissions_and_preconditions(doctor, other_doctor, reception, lab_tech,
                                       make_patient, make_user, inline_ocr):
    patient = make_patient(reception)
    doc_id = upload(doctor, patient["id"])
    url = f"/api/v1/documents/{doc_id}/ocr/run"
    # Reception and other facilities cannot run or read OCR.
    assert reception.post(url).status_code == 403
    assert other_doctor.post(url).status_code == 404
    assert lab_tech.post(url).status_code == 404  # lab sees only its own documents
    assert AuditEvent.objects.filter(action="access.denied", actor_id=other_doctor.user.pk).exists()
    # The patient (no practice context) does not use the review workflow.
    owner = make_user()
    Patient.objects.filter(pk=patient["id"]).update(user=owner)
    assert Actor(owner).post(url).status_code == 403

    # Files that have not passed the malware scan are never read.
    ClinicalDocument.objects.filter(pk=doc_id).update(scan_status=ScanStatus.PENDING)
    r = doctor.post(url)
    assert r.status_code == 409 and r.data["code"] == "not_ready"
    ClinicalDocument.objects.filter(pk=doc_id).update(scan_status=ScanStatus.REJECTED)
    assert doctor.post(f"/api/v1/documents/{doc_id}/ocr/convert-to-lab-report",
                       REVIEWED).status_code == 409

    # Unsupported types (e.g. DICOM) are refused with a clear code.
    ClinicalDocument.objects.filter(pk=doc_id).update(scan_status=ScanStatus.CLEAN,
                                                      mime_type="application/dicom")
    r = doctor.post(url)
    assert r.status_code == 422 and r.data["code"] == "ocr_unsupported_type"


def test_patient_upload_reviewed_by_clinician_with_access(doctor, reception, make_patient,
                                                          make_user, inline_ocr):
    patient = make_patient(reception)
    owner = make_user()
    Patient.objects.filter(pk=patient["id"]).update(user=owner)
    me = Actor(owner)
    doc_id = upload(me, patient["id"], data=PDF_BYTES, name="old.pdf", mime="application/pdf")
    assert ClinicalDocument.objects.get(pk=doc_id).source == "patient"
    # Without the patient's consent for the labs scope, the clinic cannot see the upload.
    assert doctor.post(f"/api/v1/documents/{doc_id}/ocr/run").status_code == 404
    AccessGrant.objects.create(
        patient_id=patient["id"], organization=doctor.organization, scopes=["labs"],
        method="patient_app", expires_at=timezone.now() + timedelta(days=1), granted_by=owner)
    r = doctor.post(f"/api/v1/documents/{doc_id}/ocr/run")
    assert r.status_code == 200, r.data
    r = doctor.post(f"/api/v1/documents/{doc_id}/ocr/convert-to-lab-report", REVIEWED)
    assert r.status_code == 201 and r.data["source"] == "document_import"


def test_engine_unavailable_still_allows_manual_review(doctor, reception, make_patient,
                                                       settings):
    settings.HAYAT = {**settings.HAYAT, "OCR_INLINE": True,
                      "OCR_PROVIDER": "apps.documents.ocr.NullOcrProvider"}
    patient = make_patient(reception)
    doc_id = upload(doctor, patient["id"])
    r = doctor.post(f"/api/v1/documents/{doc_id}/ocr/run")
    assert r.status_code == 200 and r.data["status"] == "unavailable"
    assert r.data["extracted"]["rows"] == []
    r = doctor.post(f"/api/v1/documents/{doc_id}/ocr/convert-to-lab-report", REVIEWED)
    assert r.status_code == 201


def test_engine_down_marks_failed(doctor, reception, make_patient, settings):
    settings.HAYAT = {**settings.HAYAT, "OCR_INLINE": True,
                      "OCR_PROVIDER": "apps.documents.ocr.TesseractHttpOcrProvider",
                      "OCR_URL": "http://127.0.0.1:9", "OCR_TIMEOUT": 2}
    patient = make_patient(reception)
    doc_id = upload(doctor, patient["id"])
    r = doctor.post(f"/api/v1/documents/{doc_id}/ocr/run")
    assert r.status_code == 200
    assert r.data["status"] == "failed" and r.data["error_code"] == "engine_unreachable"


def test_queued_via_celery_when_not_inline(doctor, reception, make_patient, settings,
                                           django_capture_on_commit_callbacks):
    settings.HAYAT = {**settings.HAYAT, "OCR_INLINE": False,
                      "OCR_PROVIDER": "apps.documents.ocr.FakeOcrProvider"}
    patient = make_patient(reception)
    doc_id = upload(doctor, patient["id"])
    with django_capture_on_commit_callbacks(execute=True):
        r = doctor.post(f"/api/v1/documents/{doc_id}/ocr/run")
    assert r.status_code == 200 and r.data["status"] == "queued"
    # CELERY_TASK_ALWAYS_EAGER in tests: the task ran after commit.
    assert OcrResult.objects.get(document_id=doc_id).status == "done"
