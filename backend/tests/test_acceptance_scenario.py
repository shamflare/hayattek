"""§20 — the end-to-end scenario, through the real API and database (no mocks)."""

from urllib.parse import parse_qs, urlparse

import pytest
from rest_framework.test import APIClient

from apps.diagnostics.models import LabTestType
from apps.medications.models import CatalogSource, Medication
from apps.organizations.models import Role
from apps.patients.models import Patient
from tests.conftest import PASSWORD, Actor

pytestmark = pytest.mark.django_db


def _ok(response, code=200):
    assert response.status_code == code, (response.status_code, getattr(response, "data", None))
    return response.data


def _session_login(identifier: str, password: str) -> APIClient:
    client = APIClient()
    _ok(client.post("/api/v1/auth/login", {"identifier": identifier, "password": password},
                    format="json"))
    return client


def test_full_acceptance_scenario(platform_admin, other_doctor, make_user):
    admin = platform_admin

    # 1. Platform admin registers a new medical center (and a lab).
    center = _ok(admin.post("/api/v1/admin/organizations", {
        "name": "مجمع الرقة الطبي التجريبي", "kind": "medical_center", "governorate": "raqqa",
        "city": "الرقة", "phone": "022000000", "print_footer": "يرجى مراجعة الطبيب عند اللزوم",
    }), 201)
    lab = _ok(admin.post("/api/v1/admin/organizations", {
        "name": "مختبر الفرات التجريبي", "kind": "laboratory", "governorate": "raqqa"}), 201)

    # 2. Admin adds a physician (pending) to the center, then verifies them.
    added = _ok(admin.post(f"/api/v1/admin/organizations/{center['id']}/members", {
        "full_name": "أحمد التجريبي", "email": "dr.ahmad@test.hayat", "roles": ["physician"],
        "practitioner": {"specialty": "internal_medicine", "display_name": "د. أحمد التجريبي",
                         "license_number": "TEST-123"},
    }), 201)
    assert added["user_created"] and added["setup_link"]
    pending = _ok(admin.get("/api/v1/admin/practitioners?verification_status=pending"))
    practitioner_id = next(p["id"] for p in pending["results"]
                           if p["user"]["email"] == "dr.ahmad@test.hayat")
    _ok(admin.post(f"/api/v1/admin/practitioners/{practitioner_id}/verification",
                   {"status": "verified"}))
    reception_added = _ok(admin.post(f"/api/v1/admin/organizations/{center['id']}/members", {
        "full_name": "موظفة استقبال تجريبية", "email": "desk@test.hayat",
        "roles": ["receptionist"]}), 201)
    lab_added = _ok(admin.post(f"/api/v1/admin/organizations/{lab['id']}/members", {
        "full_name": "فني مختبر تجريبي", "email": "lab@test.hayat", "roles": ["lab_staff"]}), 201)

    # 3. The doctor sets a password from the one-time link and signs in (real session).
    query = parse_qs(urlparse(added["setup_link"]).query)
    _ok(APIClient().post("/api/v1/auth/password/reset/confirm", {
        "uid": query["uid"][0], "token": query["token"][0], "new_password": PASSWORD},
        format="json"))
    doctor_client = _session_login("dr.ahmad@test.hayat", PASSWORD)
    me = _ok(doctor_client.get("/api/v1/auth/me"))
    assert me["practitioner"]["verification_status"] == "verified"
    doctor_membership = me["memberships"][0]["id"]
    doctor_client.credentials(HTTP_X_HAYAT_MEMBERSHIP=doctor_membership)

    from apps.accounts.models import User
    from apps.organizations.models import Membership

    reception = Actor(User.objects.get(email="desk@test.hayat"),
                      Membership.objects.get(pk=reception_added["membership"]["id"]))
    lab_tech = Actor(User.objects.get(email="lab@test.hayat"),
                     Membership.objects.get(pk=lab_added["membership"]["id"]))

    # 4-6. A first-time patient: reception creates the file -> health number + QR card.
    patient = _ok(reception.post("/api/v1/patients", {
        "first_name": "ليلى", "father_name": "محمود", "family_name": "التجريبية",
        "sex": "female", "birth_date": "1990-01-01", "birth_date_precision": "year",
        "phone": "0944555666"}), 201)
    pid = patient["id"]
    assert len(patient["health_number"].replace(" ", "")) == 10
    card = _ok(reception.get(f"/api/v1/patients/{pid}/card"))
    assert card["status"] == "active" and "/c/" in card["qr_url"]
    # Reception cannot see clinical data
    assert reception.get(f"/api/v1/clinical/summary?patient={pid}").status_code == 404

    # 7. The doctor opens the file (registered at the center -> own chart).
    opened = _ok(doctor_client.get(f"/api/v1/patients/{pid}"))
    assert opened["access"]["registered"] and opened["access"]["can_author"]

    # 8. Create a visit.
    visit = _ok(doctor_client.post("/api/v1/clinical/encounters", {
        "patient": pid, "reason": "ألم شرسوفي", "complaint": "ألم منذ أسبوع",
        "vitals": {"bp_systolic": 120, "bp_diastolic": 80, "heart_rate": 76},
        "assessment": "التهاب معدة"}, format="json"), 201)
    _ok(doctor_client.post("/api/v1/clinical/conditions", {
        "patient": pid, "encounter": visit["id"], "display": "التهاب معدة",
        "code": "K29.7"}, format="json"), 201)

    # 9. Prescription from the doctor's favorites (synthetic catalog).
    med_a = Medication.objects.create(name="دواء تجريبي أ", strength="20 mg",
                                      dosage_form="capsule", unit="كبسولة",
                                      source=CatalogSource.SYNTHETIC_TEST)
    med_b = Medication.objects.create(name="دواء تجريبي ب", strength="500 mg",
                                      dosage_form="tablet", unit="حبة",
                                      source=CatalogSource.SYNTHETIC_TEST)
    for med in (med_a, med_b):
        _ok(doctor_client.post("/api/v1/medications/favorites", {"medication_id": str(med.pk)},
                               format="json"), 201)
    favorites = _ok(doctor_client.get("/api/v1/medications/favorites"))
    assert len(favorites) == 2
    rx = _ok(doctor_client.post("/api/v1/prescriptions", {
        "patient": pid, "encounter": visit["id"], "diagnosis_text": "التهاب معدة",
        "items": [
            {"medication": str(med_a.pk), "dose_amount": "1", "schedule_type": "times_of_day",
             "times_of_day": ["morning"], "meal_relation": "before", "duration_value": 14,
             "duration_unit": "days", "quantity": "2", "quantity_unit": "علبة"},
            {"medication": str(med_b.pk), "dose_amount": "1", "schedule_type": "as_needed",
             "as_needed_reason": "عند الألم", "instructions": "لا تتجاوز 3 حبات يومياً"},
        ]}, format="json"), 201)
    assert rx["status"] == "draft" and len(rx["items"]) == 2
    assert rx["items"][0]["sig"].startswith("1 كبسولة صباحاً قبل الطعام")

    # 10. Finalize the visit and the prescription.
    _ok(doctor_client.post(f"/api/v1/clinical/encounters/{visit['id']}/finalize"))
    _ok(doctor_client.post(f"/api/v1/prescriptions/{rx['id']}/finalize"))

    # 11. Print data carries the doctor and the center's identity; public check reveals no meds.
    printed = _ok(doctor_client.get(f"/api/v1/prescriptions/{rx['id']}/print"))
    assert printed["organization"]["name"] == "مجمع الرقة الطبي التجريبي"
    assert printed["practitioner"]["display_name"] == "د. أحمد التجريبي"
    code = printed["verification"]["code"]
    public = _ok(APIClient().get(f"/api/v1/public/prescriptions/{code}"))
    assert public["valid"] and "items" not in public and "patient" not in str(public)

    # 12. Order a lab test at the laboratory.
    test_type = LabTestType.objects.create(code="TST-GLU", name_ar="سكر صيامي تجريبي",
                                           name_en="Test fasting glucose")
    order = _ok(doctor_client.post("/api/v1/diagnostics/requests", {
        "patient": pid, "kind": "lab", "encounter": visit["id"],
        "performer_organization": lab["id"],
        "items": [{"lab_test": str(test_type.pk)}]}, format="json"), 201)
    assert order["status"] == "final"

    # 13. The lab sees the order, issues a structured report and approves it.
    inbox = _ok(lab_tech.get("/api/v1/diagnostics/requests/incoming"))
    assert inbox["count"] == 1 and inbox["results"][0]["patient_brief"]["full_name"]
    report = _ok(lab_tech.post("/api/v1/diagnostics/lab-reports", {
        "patient": pid, "service_request": order["id"], "title": "سكر الدم",
        "observations": [{"test": str(test_type.pk), "name": "Glucose", "value_numeric": "92",
                          "unit": "mg/dL", "reference_low": "70", "reference_high": "100",
                          "interpretation": "normal"}]}), 201)
    _ok(lab_tech.post(f"/api/v1/diagnostics/lab-reports/{report['id']}/finalize"))
    # Lab staff cannot read the doctor's visit.
    assert lab_tech.get(f"/api/v1/clinical/encounters/{visit['id']}").status_code == 404
    # The ordering doctor receives the result.
    _ok(doctor_client.get(f"/api/v1/diagnostics/lab-reports/{report['id']}"))

    # 14. The patient sees the result in their own account.
    patient_user = make_user(email="layla@test.hayat", full_name="ليلى التجريبية")
    Patient.objects.filter(pk=pid).update(user=patient_user)
    patient_actor = Actor(patient_user)
    labs = _ok(patient_actor.get(f"/api/v1/diagnostics/lab-reports?patient={pid}"))
    assert labs["count"] == 1 and labs["results"][0]["observations"][0]["value_numeric"]
    # Drafts never reach the patient.
    draft = _ok(doctor_client.post("/api/v1/clinical/encounters",
                                   {"patient": pid, "reason": "مسودة"}, format="json"), 201)
    assert patient_actor.get(f"/api/v1/clinical/encounters/{draft['id']}").status_code == 404

    # 15-16. Patient visits a second doctor in a different facility; access is requested
    # and approved from the patient's account.
    assert other_doctor.get(f"/api/v1/patients/{pid}").status_code == 404
    health_number = Patient.objects.get(pk=pid).health_number
    identified = _ok(other_doctor.post("/api/v1/patients/identify",
                                       {"health_number": health_number}))
    assert not identified["access"]["can_view_clinical"]
    request = _ok(other_doctor.post("/api/v1/access/requests", {
        "health_number": health_number, "scopes": ["summary", "encounters", "prescriptions",
                                                    "labs"],
        "hours": 24, "channel": "patient_app"}), 201)
    pending = _ok(patient_actor.get("/api/v1/me/sharing/requests"))
    assert pending[0]["id"] == request["id"]
    _ok(patient_actor.post(f"/api/v1/me/sharing/requests/{request['id']}/decide",
                           {"approve": True, "scopes": ["summary", "encounters", "labs"]}))

    # 17. The second doctor sees the authorized history (not prescriptions: patient narrowed it).
    timeline = _ok(other_doctor.get(f"/api/v1/clinical/timeline?patient={pid}"))
    types = {item["type"] for item in timeline["items"]}
    assert "encounter" in types and "lab_report" in types and "prescription" not in types
    assert other_doctor.get(f"/api/v1/prescriptions/{rx['id']}").status_code == 404
    assert draft["id"] not in {i["id"] for i in timeline["items"]}

    # 18. The second doctor adds their own report without touching the first one.
    second_visit = _ok(other_doctor.post("/api/v1/clinical/encounters", {
        "patient": pid, "reason": "رأي ثانٍ", "assessment": "متابعة"}), 201)
    _ok(other_doctor.post(f"/api/v1/clinical/encounters/{second_visit['id']}/finalize"))
    assert other_doctor.post(f"/api/v1/clinical/encounters/{visit['id']}/amend",
                             {"reason": "x", "changes": {"assessment": "y"}}).status_code == 403

    # 19. Both visits appear in the patient's account.
    mine = _ok(patient_actor.get(f"/api/v1/clinical/encounters?patient={pid}"))
    assert {visit["id"], second_visit["id"]} <= {e["id"] for e in mine["results"]}

    # 20. The audit trail shows who accessed what.
    log = _ok(patient_actor.get(f"/api/v1/me/sharing/access-log?patient={pid}"))
    actions = {(row["organization_name"], row["action"]) for row in log["results"]}
    assert (other_doctor.organization.name, "record.view") in actions
    assert ("مجمع الرقة الطبي التجريبي", "record.create") in actions


def test_physician_role_requires_role_in_membership(make_actor, clinic):
    nurse = make_actor(clinic, [Role.NURSE])
    assert nurse.post("/api/v1/clinical/encounters", {"patient": "x"}).status_code == 403
