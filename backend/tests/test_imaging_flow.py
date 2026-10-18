"""Imaging order → imaging center report (draft → final) → visibility and print (§10)."""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.diagnostics.models import ServiceRequest
from apps.organizations.models import OrganizationKind, Role
from apps.patients.models import Patient
from tests.conftest import Actor

pytestmark = pytest.mark.django_db

PNG_BYTES = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02"
             b"\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00"
             b"\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")


@pytest.fixture
def imaging_center(make_org):
    return make_org(kind=OrganizationKind.IMAGING_CENTER, name="مركز تصوير تجريبي")


@pytest.fixture
def radiographer(make_actor, imaging_center):
    return make_actor(imaging_center, [Role.IMAGING_STAFF])


def test_imaging_report_lifecycle_visibility_attachments_and_print(
        doctor, other_doctor, reception, radiographer, imaging_center, make_patient, make_user):
    patient = make_patient(reception)
    owner = make_user()
    Patient.objects.filter(pk=patient["id"]).update(user=owner)
    me = Actor(owner)

    # 1. The doctor orders a chest X-ray at the imaging center.
    order = doctor.post("/api/v1/diagnostics/requests", {
        "patient": patient["id"], "kind": "imaging", "performer_organization": str(imaging_center.pk),
        "items": [{"modality": "xray", "body_site": "الصدر"}], "clinical_notes": "سعال مزمن"})
    assert order.status_code == 201, order.data
    assert order.data["status"] == "final"

    # 2. It arrives in the imaging center inbox.
    inbox = radiographer.get("/api/v1/diagnostics/requests/incoming").data["results"]
    assert [r["id"] for r in inbox] == [order.data["id"]]
    # The imaging center sees the minimal identity of the patient it received an order for.
    assert radiographer.get(f"/api/v1/patients/{patient['id']}").status_code == 200

    # 3. Draft report linked to the order, then edited.
    draft = radiographer.post("/api/v1/diagnostics/imaging-reports", {
        "patient": patient["id"], "service_request": order.data["id"], "modality": "xray",
        "body_site": "الصدر", "title": "صورة صدر بسيطة", "findings": "مسودة أولى"})
    assert draft.status_code == 201, draft.data
    rid = draft.data["id"]
    assert draft.data["status"] == "draft" and draft.data["source"] == "imaging"
    edited = radiographer.patch(f"/api/v1/diagnostics/imaging-reports/{rid}", {
        "findings": "الساحتان الرئويتان صافيتان.", "impression": "صورة صدر طبيعية."})
    assert edited.status_code == 200 and edited.data["findings"].startswith("الساحتان")

    # 4. Attachment on the draft follows the draft.
    image = SimpleUploadedFile("chest.png", PNG_BYTES, content_type="image/png")
    doc = radiographer.client.post("/api/v1/documents", {
        "patient": patient["id"], "file": image, "category": "xray", "title": "صورة الصدر",
        "imaging_report": rid}, format="multipart")
    assert doc.status_code == 201, doc.data
    assert doc.data["status"] == "draft"
    doc_id = doc.data["id"]

    # 5. Nobody but the author sees the draft (404, not 403), nor can it be printed.
    for actor in (me, doctor, other_doctor):
        assert actor.get(f"/api/v1/diagnostics/imaging-reports/{rid}").status_code == 404
        assert actor.get(f"/api/v1/documents/{doc_id}").status_code == 404
    assert radiographer.get(f"/api/v1/diagnostics/imaging-reports/{rid}/print").status_code == 409

    # 6. Finalize: order completed, report + attachment released together.
    final = radiographer.post(f"/api/v1/diagnostics/imaging-reports/{rid}/finalize")
    assert final.status_code == 200 and final.data["status"] == "final"
    assert ServiceRequest.objects.get(pk=order.data["id"]).fulfillment_status == "completed"
    for actor in (me, doctor):
        r = actor.get(f"/api/v1/diagnostics/imaging-reports/{rid}")
        assert r.status_code == 200, r.data
        assert r.data["service_request"] is not None and str(r.data["service_request"]) == \
            order.data["id"]
        assert [d["id"] for d in r.data["documents"]] == [doc_id]
        assert actor.get(f"/api/v1/documents/{doc_id}").status_code == 200
    listing = doctor.get(f"/api/v1/diagnostics/imaging-reports?patient={patient['id']}")
    assert [r["id"] for r in listing.data["results"]] == [rid]

    # 7. An unrelated doctor sees neither the report nor its attachment.
    assert other_doctor.get(f"/api/v1/diagnostics/imaging-reports/{rid}").status_code == 404
    assert other_doctor.get(f"/api/v1/diagnostics/imaging-reports/{rid}/print").status_code == 404
    assert other_doctor.get(f"/api/v1/documents/{doc_id}").status_code == 404
    assert other_doctor.get(f"/api/v1/documents/{doc_id}/download").status_code == 404

    # 8. Print shows the facility, the author and the ordering doctor.
    for actor in (radiographer, doctor):
        p = actor.get(f"/api/v1/diagnostics/imaging-reports/{rid}/print")
        assert p.status_code == 200, p.data
        assert p.data["organization"]["name"] == imaging_center.name
        assert p.data["author"]["name"] == radiographer.user.full_name
        assert p.data["order"]["number"] == order.data["number"]
        assert p.data["report"]["impression"] == "صورة صدر طبيعية."
        assert p.data["report"]["attachments"] == 1
