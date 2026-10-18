"""Integration with a REAL Orthanc (docker compose service `orthanc`). Skipped when unreachable.

Configure with ORTHANC_TEST_URL / ORTHANC_TEST_USERNAME / ORTHANC_TEST_PASSWORD (defaults: the
dev container on 127.0.0.1:58042 with its dev-only credentials). Synthetic images only.
"""

from __future__ import annotations

import os

import pytest
import urllib3
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.dicom.models import DicomStudy, StudyStatus
from apps.dicom.orthanc import OrthancClient, OrthancConfig
from apps.dicom.synthetic import FAKE_PATIENT_NAME, make_series, make_zip

URL = os.environ.get("ORTHANC_TEST_URL", "http://127.0.0.1:58042")
USER = os.environ.get("ORTHANC_TEST_USERNAME", "hayat")
PASSWORD = os.environ.get("ORTHANC_TEST_PASSWORD", "hayat_orthanc_dev_password")


def _reachable() -> bool:
    try:
        r = urllib3.PoolManager().request(
            "GET", f"{URL}/system", headers=urllib3.make_headers(basic_auth=f"{USER}:{PASSWORD}"),
            timeout=2.0, retries=False)
        return r.status == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _reachable(), reason="Orthanc not reachable")


def test_upload_synthetic_study_to_real_orthanc_and_fetch_rendered_frame(
        doctor, reception, make_patient, settings, django_capture_on_commit_callbacks):
    settings.HAYAT = {**settings.HAYAT, "ORTHANC_URL": URL, "ORTHANC_USERNAME": USER,
                      "ORTHANC_PASSWORD": PASSWORD}
    patient = make_patient(reception)
    with django_capture_on_commit_callbacks(execute=True):
        r = doctor.client.post("/api/v1/dicom/studies", {
            "patient": patient["id"], "category": "ct", "title": "طبقي تجريبي (تكامل)",
            "file": SimpleUploadedFile("s.zip", make_zip(make_series(6)))}, format="multipart")
    assert r.status_code == 201, r.data
    study = DicomStudy.objects.get(document_id=r.data["id"])
    assert study.status == StudyStatus.STORED, study.error_code
    assert (study.series_count, study.instance_count) == (1, 6)

    client = OrthancClient(OrthancConfig(url=URL, username=USER, password=PASSWORD))
    try:
        # The store holds the pseudonym, not the name written in the synthetic file.
        tags = client.get_json(f"/studies/{study.orthanc_study_id}")["PatientMainDicomTags"]
        assert tags["PatientID"] == study.pseudonym
        assert FAKE_PATIENT_NAME not in tags.get("PatientName", "")

        series = doctor.get(f"/api/v1/dicom/documents/{r.data['id']}/series").data["results"]
        inst = doctor.get(f"/api/v1/dicom/documents/{r.data['id']}/series/{series[0]['id']}"
                          "/instances").data["results"]
        assert [i["instance_number"] for i in inst] == [1, 2, 3, 4, 5, 6]
        base = f"/api/v1/dicom/documents/{r.data['id']}/instances/{inst[2]['id']}/rendered"
        png = doctor.get(base)
        assert png.status_code == 200
        assert b"".join(png.streaming_content).startswith(b"\x89PNG")
        jpeg = doctor.get(f"{base}?preset=bone&fmt=jpeg")
        assert jpeg.status_code == 200
        assert b"".join(jpeg.streaming_content).startswith(b"\xff\xd8")
    finally:
        client.delete_study(study.orthanc_study_id)
