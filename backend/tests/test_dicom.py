"""DICOM support (§7): upload → private store, authorized proxy, pseudonymization.

Orthanc is replaced by an in-memory fake at the client boundary (`apps.dicom.orthanc.get_client`);
the real HTTP client is unit-tested against a mocked urllib3 pool. A separate integration test
runs against a real Orthanc only when one is reachable. All images are synthetic.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile

import pydicom
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.audit.models import AuditEvent
from apps.dicom import orthanc as orthanc_mod
from apps.dicom.models import DicomInstance, DicomStudy, StudyStatus
from apps.dicom.orthanc import OrthancClient, OrthancConfig, OrthancError
from apps.dicom.synthetic import FAKE_PATIENT_NAME, make_series, make_zip
from apps.documents.models import ClinicalDocument, ScanStatus
from apps.patients.models import Patient
from tests.conftest import Actor

FAKE_URL = "http://orthanc.internal.test:8042"
FAKE_PASSWORD = "orthanc-secret-for-tests"
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64


class FakeResponse:
    def __init__(self, data: bytes):
        self._data = data
        self.released = False

    def stream(self, size):
        for i in range(0, len(self._data), size):
            yield self._data[i:i + size]

    def release_conn(self):
        self.released = True


class FakeOrthanc:
    """Mimics the subset of the Orthanc REST API the client uses (ids are SHA1-like)."""

    def __init__(self):
        self.received: list[pydicom.Dataset] = []
        self.instances: dict[str, dict] = {}
        self.render_calls: list[dict] = []
        self.fail = False

    @staticmethod
    def _id(*parts) -> str:
        return hashlib.sha1("|".join(parts).encode(), usedforsecurity=False).hexdigest()[:40]

    def store_instance(self, payload: bytes) -> dict:
        if self.fail:
            raise OrthancError("store_unreachable")
        ds = pydicom.dcmread(io.BytesIO(payload))
        self.received.append(ds)
        study = self._id(ds.PatientID, ds.StudyInstanceUID)
        series = self._id(study, ds.SeriesInstanceUID)
        instance = self._id(series, ds.SOPInstanceUID)
        self.instances[instance] = {"ds": ds, "study": study, "series": series}
        return {"ID": instance, "ParentStudy": study, "ParentSeries": series, "Status": "Success"}

    def study(self, study_id):
        ds = next(v["ds"] for v in self.instances.values() if v["study"] == study_id)
        series = sorted({v["series"] for v in self.instances.values() if v["study"] == study_id})
        return {"ID": study_id, "Series": series, "MainDicomTags": {
            "StudyInstanceUID": ds.StudyInstanceUID, "StudyDate": ds.StudyDate,
            "StudyDescription": ds.StudyDescription}}

    def series_with_instances(self, series_id):
        rows = [(k, v["ds"]) for k, v in self.instances.items() if v["series"] == series_id]
        ds = rows[0][1]
        # Orthanc does not guarantee order: return reversed to prove we sort by InstanceNumber.
        instances = [{"ID": k, "MainDicomTags": {"InstanceNumber": str(d.InstanceNumber)}}
                     for k, d in reversed(rows)]
        return ({"ID": series_id, "MainDicomTags": {
            "Modality": ds.Modality, "SeriesNumber": str(ds.SeriesNumber),
            "SeriesDescription": ds.SeriesDescription,
            "SeriesInstanceUID": ds.SeriesInstanceUID}}, instances)

    def rendered_frame(self, instance_id, frame, *, accept, window_center=None,
                       window_width=None, quality=None):
        self.render_calls.append({"id": instance_id, "frame": frame, "accept": accept,
                                  "wc": window_center, "ww": window_width})
        return FakeResponse(PNG)

    def delete_study(self, study_id):
        pass


@pytest.fixture
def fake_orthanc(monkeypatch, settings):
    settings.HAYAT = {**settings.HAYAT, "ORTHANC_URL": FAKE_URL, "ORTHANC_USERNAME": "hayat",
                      "ORTHANC_PASSWORD": FAKE_PASSWORD}
    fake = FakeOrthanc()
    monkeypatch.setattr(orthanc_mod, "get_client", lambda: fake)
    monkeypatch.setattr("apps.dicom.services.get_client", lambda: fake)
    monkeypatch.setattr("apps.dicom.views.get_client", lambda: fake)
    return fake


@pytest.fixture
def registered(reception, make_patient):
    return make_patient(reception)


def upload(actor, patient_id, payload: bytes, *, name="study.zip", capture=None, **extra):
    data = {"patient": patient_id, "file": SimpleUploadedFile(name, payload),
            "category": "ct", "title": "طبقي تجريبي", **extra}
    with capture(execute=True):
        return actor.client.post("/api/v1/dicom/studies", data, format="multipart")


def study_url(doc_id, suffix=""):
    return f"/api/v1/dicom/documents/{doc_id}{suffix}"


def first_frame_url(actor, doc_id):
    series = actor.get(study_url(doc_id, "/series")).data["results"][0]
    instances = actor.get(study_url(doc_id, f"/series/{series['id']}/instances")).data["results"]
    return study_url(doc_id, f"/instances/{instances[0]['id']}/rendered"), instances


# ------------------------------------------------------------------ upload → store


def test_zip_upload_pushes_pseudonymized_study_and_indexes_it(
        doctor, registered, fake_orthanc, django_capture_on_commit_callbacks):
    r = upload(doctor, registered["id"], make_zip(make_series(10)),
               capture=django_capture_on_commit_callbacks)
    assert r.status_code == 201, r.data
    assert r.data["mime_type"] == "application/zip"
    assert r.data["scan_status"] == ScanStatus.CLEAN

    study = DicomStudy.objects.get(document_id=r.data["id"])
    assert study.status == StudyStatus.STORED, study.error_code
    assert (study.series_count, study.instance_count, study.modalities) == (1, 10, "CT")
    assert study.study_description == "دراسة طبقي تجريبية"

    # Identity: never the name/ID from the file; a HAYAT pseudonym instead.
    assert len(fake_orthanc.received) == 10
    for ds in fake_orthanc.received:
        assert str(ds.PatientName) != FAKE_PATIENT_NAME
        assert ds.PatientID == study.pseudonym == f"HAYAT-{study.document_id.hex}"
        assert "PatientBirthDate" not in ds

    # API: ordered slices, paginated, no Orthanc identifiers.
    detail = doctor.get(study_url(r.data["id"]))
    assert detail.status_code == 200
    assert detail.data["status"] == "stored" and detail.data["diagnostic_use"] is False
    assert detail.data["patient"] == registered["id"]
    _, instances = first_frame_url(doctor, r.data["id"])
    assert [i["instance_number"] for i in instances] == list(range(1, 11))
    series_id = study.series.get().pk
    page = doctor.get(study_url(r.data["id"], f"/series/{series_id}/instances?page_size=4&page=3"))
    assert page.data["count"] == 10
    assert [i["instance_number"] for i in page.data["results"]] == [9, 10]
    body = json.dumps([detail.data, instances], default=str)
    for secret in (FAKE_URL, FAKE_PASSWORD, study.orthanc_study_id,
                   DicomInstance.objects.first().orthanc_id):
        assert secret not in body


def test_single_dcm_via_documents_api_is_pushed_too(
        doctor, registered, fake_orthanc, django_capture_on_commit_callbacks):
    payload = make_series(1)[0]
    with django_capture_on_commit_callbacks(execute=True):
        r = doctor.client.post("/api/v1/documents", {
            "patient": registered["id"], "file": SimpleUploadedFile("x.dcm", payload),
            "category": "xray", "title": "صورة"}, format="multipart")
    assert r.status_code == 201, r.data
    assert r.data["mime_type"] == "application/dicom"
    study = DicomStudy.objects.get(document_id=r.data["id"])
    assert study.status == StudyStatus.STORED and study.instance_count == 1


def test_pending_scan_is_pushed_only_when_clean(
        doctor, registered, fake_orthanc, monkeypatch, django_capture_on_commit_callbacks):
    from apps.documents.scanning import ScanVerdict, apply_verdict

    monkeypatch.setattr("apps.dicom.views.run_scan", lambda f: None)  # scanner down
    monkeypatch.setattr("apps.dicom.views.scan_document_task.apply_async", lambda *a, **k: None)
    r = upload(doctor, registered["id"], make_zip(make_series(3)),
               capture=django_capture_on_commit_callbacks)
    assert r.status_code == 201 and r.data["scan_status"] == "pending"
    study = DicomStudy.objects.get(document_id=r.data["id"])
    assert study.status == StudyStatus.PENDING and fake_orthanc.received == []
    assert doctor.get(study_url(r.data["id"], "/series")).status_code == 409

    document = ClinicalDocument.objects.get(pk=r.data["id"])
    with django_capture_on_commit_callbacks(execute=True):
        apply_verdict(document, ScanVerdict(clean=True, engine="test"))
    study.refresh_from_db()
    assert study.status == StudyStatus.STORED and len(fake_orthanc.received) == 3


def test_store_failure_keeps_upload_and_marks_study_failed(
        doctor, registered, fake_orthanc, django_capture_on_commit_callbacks):
    fake_orthanc.fail = True
    r = upload(doctor, registered["id"], make_zip(make_series(2)),
               capture=django_capture_on_commit_callbacks)
    assert r.status_code == 201
    detail = doctor.get(study_url(r.data["id"]))
    assert detail.data["status"] == "failed" and detail.data["error_code"] == "store_unreachable"
    assert doctor.get(study_url(r.data["id"], "/series")).status_code == 409


# ------------------------------------------------------------------ ZIP safety


def _zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return buf.getvalue()


@pytest.mark.parametrize("entries,code", [
    ({"../../evil.dcm": b"x"}, "invalid_dicom_archive"),
    ({"/abs/evil.dcm": b"x"}, "invalid_dicom_archive"),
    ({"a.dcm": b"MZ not dicom" * 20}, "invalid_dicom_archive"),
    ({"README.txt": b"hello"}, "invalid_dicom_archive"),
])
def test_unsafe_or_invalid_zip_is_rejected(doctor, registered, fake_orthanc, entries, code,
                                           django_capture_on_commit_callbacks):
    r = upload(doctor, registered["id"], _zip(entries),
               capture=django_capture_on_commit_callbacks)
    assert r.status_code == 400 and r.data["code"] == code
    assert not ClinicalDocument.objects.exists()


def test_zip_with_two_studies_or_too_many_files_is_rejected(
        doctor, registered, fake_orthanc, settings, django_capture_on_commit_callbacks):
    a, b = make_series(1), make_series(1)
    r = upload(doctor, registered["id"], _zip({"a.dcm": a[0], "b.dcm": b[0]}),
               capture=django_capture_on_commit_callbacks)
    assert r.status_code == 400 and r.data["code"] == "multiple_studies"

    settings.HAYAT = {**settings.HAYAT, "DICOM_ZIP_MAX_FILES": 3}
    r = upload(doctor, registered["id"], make_zip(make_series(5)),
               capture=django_capture_on_commit_callbacks)
    assert r.status_code == 400 and r.data["code"] == "invalid_dicom_archive"


def test_non_imaging_category_rejected(doctor, registered, fake_orthanc,
                                       django_capture_on_commit_callbacks):
    r = upload(doctor, registered["id"], make_zip(make_series(1)), category="medical_report",
               capture=django_capture_on_commit_callbacks)
    assert r.status_code == 400 and r.data["code"] == "invalid_category"


# ------------------------------------------------------------------ authorization


@pytest.fixture
def stored_doc(doctor, registered, fake_orthanc, django_capture_on_commit_callbacks):
    r = upload(doctor, registered["id"], make_zip(make_series(4)),
               capture=django_capture_on_commit_callbacks)
    assert r.status_code == 201
    return r.data


def test_other_facility_and_receptionist_get_404_everywhere(
        doctor, other_doctor, reception, stored_doc):
    frame_url, _ = first_frame_url(doctor, stored_doc["id"])
    series_id = DicomStudy.objects.get(document_id=stored_doc["id"]).series.get().pk
    urls = [study_url(stored_doc["id"]), study_url(stored_doc["id"], "/series"),
            study_url(stored_doc["id"], f"/series/{series_id}/instances"), frame_url]
    for actor in (other_doctor, reception):
        for url in urls:
            assert actor.get(url).status_code == 404, (url, actor)
    assert AuditEvent.objects.filter(action="access.denied",
                                     target_id=stored_doc["id"]).count() >= 8


def test_patient_sees_own_study_without_membership(stored_doc, registered, make_user,
                                                   fake_orthanc):
    owner = make_user()
    Patient.objects.filter(pk=registered["id"]).update(user=owner)
    me = Actor(owner)
    assert me.get(study_url(stored_doc["id"])).status_code == 200
    frame_url, _ = first_frame_url(me, stored_doc["id"])
    r = me.get(frame_url)
    assert r.status_code == 200 and b"".join(r.streaming_content) == PNG
    stranger = Actor(make_user())
    assert stranger.get(study_url(stored_doc["id"])).status_code == 404


def test_draft_imaging_report_attachment_hidden_until_final(
        doctor, registered, make_user, fake_orthanc, django_capture_on_commit_callbacks):
    owner = make_user()
    Patient.objects.filter(pk=registered["id"]).update(user=owner)
    report = doctor.post("/api/v1/diagnostics/imaging-reports", {
        "patient": registered["id"], "modality": "ct", "title": "طبقي صدر تجريبي",
        "findings": "تجريبي"})
    assert report.status_code == 201, report.data
    r = upload(doctor, registered["id"], make_zip(make_series(2)),
               imaging_report=report.data["id"], capture=django_capture_on_commit_callbacks)
    assert r.status_code == 201 and r.data["status"] == "draft"
    me = Actor(owner)
    assert me.get(study_url(r.data["id"])).status_code == 404
    assert doctor.get(study_url(r.data["id"])).status_code == 200  # the author
    assert doctor.post(f"/api/v1/diagnostics/imaging-reports/{report.data['id']}/finalize"
                       ).status_code == 200
    assert me.get(study_url(r.data["id"])).status_code == 200


def test_non_dicom_document_is_not_a_study(doctor, registered, fake_orthanc,
                                           django_capture_on_commit_callbacks):
    pdf = SimpleUploadedFile("r.pdf", b"%PDF-1.4\n%synthetic\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")
    with django_capture_on_commit_callbacks(execute=True):
        r = doctor.client.post("/api/v1/documents", {"patient": registered["id"], "file": pdf,
                                                     "category": "ct", "title": "pdf"},
                               format="multipart")
    assert r.status_code == 201
    assert doctor.get(study_url(r.data["id"])).status_code == 404
    assert not DicomStudy.objects.exists()


# ------------------------------------------------------------------ proxy


def test_rendered_frame_is_proxied_privately_and_audited_once(doctor, stored_doc, fake_orthanc):
    assert doctor.get(study_url(stored_doc["id"])).status_code == 200  # study open
    frame_url, _ = first_frame_url(doctor, stored_doc["id"])
    for preset in ("default", "lung", "bone"):
        r = doctor.get(f"{frame_url}?preset={preset}")
        assert r.status_code == 200
        assert r["Content-Type"] == "image/png"
        assert r["Cache-Control"] == "private, no-store"
        assert b"".join(r.streaming_content) == PNG
        headers = " ".join(f"{k}: {v}" for k, v in r.items())
        assert FAKE_URL not in headers and FAKE_PASSWORD not in headers
    assert [(c["wc"], c["ww"]) for c in fake_orthanc.render_calls] == [
        (None, None), (-600, 1500), (300, 2000)]
    r = doctor.get(f"{frame_url}?wc=50&ww=350&fmt=jpeg")
    assert r.status_code == 200 and fake_orthanc.render_calls[-1]["accept"] == "image/jpeg"
    # Exactly one view audit for the open, none per frame.
    assert AuditEvent.objects.filter(action="document.view_dicom",
                                     target_id=stored_doc["id"]).count() == 1

    assert doctor.get(f"{frame_url}?frame=1").status_code == 400  # single-frame instance
    assert doctor.get(f"{frame_url}?preset=nope").status_code == 400
    assert doctor.get(f"{frame_url}?wc=1&ww=0").status_code == 400


def test_instance_of_another_study_is_not_reachable(
        doctor, registered, stored_doc, fake_orthanc, django_capture_on_commit_callbacks):
    other = upload(doctor, registered["id"], make_zip(make_series(1)),
                   capture=django_capture_on_commit_callbacks).data
    foreign = DicomInstance.objects.get(series__study__document_id=other["id"])
    r = doctor.get(study_url(stored_doc["id"], f"/instances/{foreign.pk}/rendered"))
    assert r.status_code == 404


def test_store_error_does_not_leak_internals(doctor, stored_doc, fake_orthanc, monkeypatch):
    def boom(*a, **k):
        raise OrthancError("store_unreachable")

    monkeypatch.setattr(fake_orthanc, "rendered_frame", boom)
    frame_url, _ = first_frame_url(doctor, stored_doc["id"])
    r = doctor.get(frame_url)
    assert r.status_code == 502 and r.data["code"] == "store_unavailable"
    assert FAKE_URL not in json.dumps(r.data) and "orthanc" not in json.dumps(r.data).lower()


# ------------------------------------------------------------------ HTTP client


class _Pool:
    def __init__(self, status=200, data=b"{}"):
        self.calls = []
        self.status, self.data = status, data

    def request(self, method, url, **kw):
        self.calls.append((method, url, kw))
        resp = type("R", (), {})()
        resp.status, resp.data = self.status, self.data
        resp.release_conn = lambda: None
        return resp


def test_http_client_uses_basic_auth_and_hides_details_in_errors():
    pool = _Pool(data=json.dumps({"ID": "i", "ParentStudy": "s"}).encode())
    client = OrthancClient(OrthancConfig(url=FAKE_URL, username="hayat",
                                         password=FAKE_PASSWORD), http=pool)
    assert client.store_instance(b"DICM")["ParentStudy"] == "s"
    method, url, kw = pool.calls[0]
    assert (method, url) == ("POST", f"{FAKE_URL}/instances")
    assert kw["headers"]["authorization"].startswith("Basic ")
    assert kw["headers"]["Content-Type"] == "application/dicom"

    client.rendered_frame("abc", 0, accept="image/png", window_center=40, window_width=400)
    _, url, kw = pool.calls[-1]
    assert url == f"{FAKE_URL}/instances/abc/frames/0/rendered"
    assert kw["fields"] == {"window-center": "40", "window-width": "400"}

    failing = OrthancClient(OrthancConfig(url=FAKE_URL, username="hayat",
                                          password=FAKE_PASSWORD), http=_Pool(status=500))
    with pytest.raises(OrthancError) as exc:
        failing.study("x")
    assert str(exc.value) == "store_error"
    assert FAKE_URL not in str(exc.value) and FAKE_PASSWORD not in str(exc.value)

    with pytest.raises(OrthancError, match="store_not_configured"):
        OrthancClient(OrthancConfig(url="", username="", password=""))
