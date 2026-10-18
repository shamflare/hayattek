"""The privacy guarantees of SECURITY_MODEL.md, as executable checks (§21)."""

import uuid
from datetime import timedelta

import pytest
from django.db import DatabaseError, connection, transaction
from django.utils import timezone

from apps.access.models import AccessGrant
from apps.audit.models import AuditEvent
from apps.organizations.models import Role

pytestmark = pytest.mark.django_db


def _visit(actor, patient_id, **extra):
    r = actor.post("/api/v1/clinical/encounters", {"patient": patient_id, "reason": "صداع",
                                                    "assessment": "توتر", **extra})
    assert r.status_code == 201, r.data
    return r.data


def _finalize(actor, kind, record_id):
    r = actor.post(f"/api/v1/{kind}/{record_id}/finalize")
    assert r.status_code == 200, r.data
    return r.data


def test_anonymous_requests_are_rejected(client):
    assert client.get("/api/v1/patients").status_code in (401, 403)
    assert client.get("/api/v1/auth/me").status_code in (401, 403)


def test_membership_header_must_belong_to_user(doctor, other_doctor, make_patient, reception):
    patient = make_patient(reception)
    # other_doctor forges doctor's membership id
    other_doctor.client.credentials(HTTP_X_HAYAT_MEMBERSHIP=str(doctor.membership.pk))
    assert other_doctor.get(f"/api/v1/patients/{patient['id']}").status_code == 403


def test_receptionist_cannot_read_clinical_data(reception, doctor, make_patient):
    patient = make_patient(reception)
    encounter = _visit(doctor, patient["id"])
    _finalize(doctor, "clinical/encounters", encounter["id"])

    # Demographics: yes. Clinical: no.
    assert reception.get(f"/api/v1/patients/{patient['id']}").status_code == 200
    assert reception.get(f"/api/v1/clinical/encounters/{encounter['id']}").status_code == 404
    listing = reception.get(f"/api/v1/clinical/encounters?patient={patient['id']}")
    assert listing.status_code == 200 and listing.data["count"] == 0
    assert reception.get(f"/api/v1/clinical/summary?patient={patient['id']}").status_code == 404
    # Nor may they write.
    r = reception.post("/api/v1/clinical/encounters", {"patient": patient["id"], "reason": "x"})
    assert r.status_code == 403


def test_org_admin_has_no_patient_access(make_actor, clinic, reception, doctor, make_patient):
    admin = make_actor(clinic, [Role.ORG_ADMIN])
    patient = make_patient(reception)
    assert admin.get(f"/api/v1/patients/{patient['id']}").status_code == 404
    assert admin.get("/api/v1/patients").data["count"] == 0


def test_platform_admin_cannot_read_records(platform_admin, reception, doctor, make_patient):
    patient = make_patient(reception)
    encounter = _visit(doctor, patient["id"])
    _finalize(doctor, "clinical/encounters", encounter["id"])
    assert platform_admin.get(f"/api/v1/clinical/encounters/{encounter['id']}").status_code == 404
    assert platform_admin.get(f"/api/v1/patients/{patient['id']}").status_code == 403


def test_cross_facility_isolation_without_grant(doctor, other_doctor, reception, make_patient):
    patient = make_patient(reception)
    encounter = _visit(doctor, patient["id"])
    _finalize(doctor, "clinical/encounters", encounter["id"])

    # Changing the ID in the URL (BOLA/IDOR) must not reveal anything.
    assert other_doctor.get(f"/api/v1/patients/{patient['id']}").status_code == 404
    assert other_doctor.get(f"/api/v1/clinical/encounters/{encounter['id']}").status_code == 404
    r = other_doctor.get(f"/api/v1/clinical/encounters?patient={patient['id']}")
    assert r.data["count"] == 0
    # The denied attempt is audited.
    assert AuditEvent.objects.filter(action="access.denied", actor_id=other_doctor.user.pk,
                                     outcome="denied").exists()


def test_random_ids_return_404(doctor):
    assert doctor.get(f"/api/v1/clinical/encounters/{uuid.uuid4()}").status_code == 404
    assert doctor.get(f"/api/v1/prescriptions/{uuid.uuid4()}").status_code == 404
    assert doctor.get(f"/api/v1/documents/{uuid.uuid4()}").status_code == 404


def test_grant_scopes_are_respected_and_expire(doctor, other_doctor, reception, make_patient):
    patient = make_patient(reception)
    encounter = _visit(doctor, patient["id"])
    _finalize(doctor, "clinical/encounters", encounter["id"])

    from apps.patients.models import Patient

    p = Patient.objects.get(pk=patient["id"])
    # In-person grant for prescriptions only: encounters stay hidden.
    r = other_doctor.post("/api/v1/access/in-person", {
        "health_number": p.health_number, "scopes": ["prescriptions"], "hours": 2,
        "attestation": "عرض البطاقة والهوية"})
    assert r.status_code == 201, r.data
    assert other_doctor.get(f"/api/v1/clinical/encounters/{encounter['id']}").status_code == 404

    # Widen scope: encounters become visible.
    other_doctor.post("/api/v1/access/in-person", {
        "health_number": p.health_number, "scopes": ["encounters"], "hours": 2,
        "attestation": "عرض البطاقة والهوية"})
    assert other_doctor.get(f"/api/v1/clinical/encounters/{encounter['id']}").status_code == 200

    # After expiry nothing leaks.
    AccessGrant.objects.filter(patient=p).update(
        starts_at=timezone.now() - timedelta(hours=5), expires_at=timezone.now() - timedelta(hours=1))
    assert other_doctor.get(f"/api/v1/clinical/encounters/{encounter['id']}").status_code == 404
    assert other_doctor.get(f"/api/v1/patients/{patient['id']}").status_code == 404


def test_patient_revocation_cuts_access(doctor, other_doctor, reception, make_patient, make_user):
    from apps.patients.models import Patient

    patient = make_patient(reception)
    p = Patient.objects.get(pk=patient["id"])
    owner = make_user(email="patient-owner@test.hayat")
    p.user = owner
    p.save()
    encounter = _visit(doctor, patient["id"])
    _finalize(doctor, "clinical/encounters", encounter["id"])

    grant = other_doctor.post("/api/v1/access/in-person", {
        "card_token": p.cards.get(status="active").token, "scopes": ["encounters"], "hours": 2,
        "attestation": "تحقق حضوري"}).data
    assert other_doctor.get(f"/api/v1/clinical/encounters/{encounter['id']}").status_code == 200

    from tests.conftest import Actor

    me = Actor(owner)
    assert me.post(f"/api/v1/me/sharing/grants/{grant['id']}/revoke").status_code == 200
    assert other_doctor.get(f"/api/v1/clinical/encounters/{encounter['id']}").status_code == 404


def test_doctor_cannot_modify_another_doctors_record(doctor, make_actor, clinic, reception,
                                                      make_patient):
    colleague = make_actor(clinic, [Role.PHYSICIAN])
    patient = make_patient(reception)
    encounter = _visit(doctor, patient["id"])
    # Draft of doctor A is invisible to colleague B.
    assert colleague.get(f"/api/v1/clinical/encounters/{encounter['id']}").status_code == 404
    _finalize(doctor, "clinical/encounters", encounter["id"])
    # Final record: visible to B (same facility), but B cannot amend or void it.
    assert colleague.get(f"/api/v1/clinical/encounters/{encounter['id']}").status_code == 200
    r = colleague.post(f"/api/v1/clinical/encounters/{encounter['id']}/amend",
                       {"reason": "تعديل", "changes": {"assessment": "غير ذلك"}})
    assert r.status_code == 403
    r = colleague.post(f"/api/v1/clinical/encounters/{encounter['id']}/entered-in-error",
                       {"reason": "خطأ"})
    assert r.status_code == 403


def test_finalized_record_requires_documented_amendment(doctor, reception, make_patient):
    patient = make_patient(reception)
    encounter = _visit(doctor, patient["id"])
    _finalize(doctor, "clinical/encounters", encounter["id"])
    r = doctor.patch(f"/api/v1/clinical/encounters/{encounter['id']}", {"assessment": "تغيير"})
    assert r.status_code == 409
    r = doctor.post(f"/api/v1/clinical/encounters/{encounter['id']}/amend",
                    {"reason": "تصحيح خطأ إملائي", "changes": {"assessment": "توتر عصبي"}})
    assert r.status_code == 200
    assert r.data["status"] == "amended" and r.data["version"] == 2
    versions = doctor.get(f"/api/v1/clinical/encounters/{encounter['id']}/versions").data
    assert versions[0]["snapshot"]["assessment"] == "توتر"


def test_unverified_physician_cannot_write(make_actor, clinic, reception, make_patient):
    pending = make_actor(clinic, [Role.PHYSICIAN], verified=False)
    patient = make_patient(reception)
    r = pending.post("/api/v1/clinical/encounters", {"patient": patient["id"], "reason": "x"})
    assert r.status_code == 403


def test_suspended_organization_blocks_context(doctor, clinic, reception, make_patient):
    patient = make_patient(reception)
    clinic.status = "suspended"
    clinic.save()
    assert doctor.get(f"/api/v1/patients/{patient['id']}").status_code == 403


def test_multi_facility_doctor_context(make_actor, clinic, other_clinic, make_user, make_patient):
    """One practitioner identity, records attributed to the facility chosen in context."""
    user = make_user()
    at_clinic = make_actor(clinic, [Role.PHYSICIAN], user=user)
    at_other = make_actor(other_clinic, [Role.PHYSICIAN], user=user)
    assert at_clinic.membership.pk != at_other.membership.pk
    patient = make_patient(at_clinic)
    enc = _visit(at_clinic, patient["id"])
    assert str(enc["organization"]) == str(clinic.pk)
    # The same doctor acting for the other facility sees nothing without consent.
    assert at_other.get(f"/api/v1/clinical/encounters/{enc['id']}").status_code == 404


def test_audit_log_is_append_only_in_database(doctor):
    event = AuditEvent.objects.create(action="test.event")
    with pytest.raises(RuntimeError):
        event.save()
    with pytest.raises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("UPDATE audit_auditevent SET action='x' WHERE id=%s", [event.pk])
    with pytest.raises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("DELETE FROM audit_auditevent WHERE id=%s", [event.pk])
