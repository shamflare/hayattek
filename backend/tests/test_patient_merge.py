"""Duplicate patient files: human-reviewed merge and exact undo (§8, ADR-019)."""

from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone

from apps.access.models import AccessGrant
from apps.audit.models import AuditEvent
from apps.clinical.models import Encounter
from apps.documents.models import ClinicalDocument
from apps.organizations.models import Role
from apps.patients.merge import patient_foreign_keys
from apps.patients.models import (
    HealthCard,
    Patient,
    PatientGuardian,
    PatientMergeCase,
    PatientRegistration,
)
from tests.conftest import Actor

pytestmark = pytest.mark.django_db

PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
EVIDENCE = {"evidence_checks": ["national_id_document", "health_card"],
            "evidence_notes": "تحققت من الهوية الشخصية والبطاقة الصحية بحضور المريض",
            "reason": "ملف مكرر أُنشئ بالخطأ في زيارة سابقة", "confirm": True}


def _visit(actor, patient_id, reason="صداع"):
    r = actor.post("/api/v1/clinical/encounters", {"patient": patient_id, "reason": reason,
                                                    "assessment": "توتر"})
    assert r.status_code == 201, r.data
    assert actor.post(f"/api/v1/clinical/encounters/{r.data['id']}/finalize").status_code == 200
    return r.data


@pytest.fixture
def world(reception, doctor, other_doctor, make_actor, other_clinic, make_patient):
    """Two files of the same synthetic person at `clinic` with records, a grant, a guardian,
    an app account and a registration at a second facility on the duplicate."""
    keep = make_patient(reception)  # older file: survives
    dup = make_patient(reception, first_name="سامى", family_name="التجريبى")
    a, b = Patient.objects.get(pk=keep["id"]), Patient.objects.get(pk=dup["id"])
    keep_visit = _visit(doctor, keep["id"], "زيارة الملف الأصلي")
    dup_visit = _visit(doctor, dup["id"], "زيارة الملف المكرر")
    pdf = SimpleUploadedFile("r.pdf", PDF_BYTES, content_type="application/pdf")
    doc = doctor.client.post("/api/v1/documents", {"patient": dup["id"], "file": pdf,
                                                   "category": "other", "title": "مستند"},
                             format="multipart")
    assert doc.status_code == 201, doc.data
    # The duplicate is also registered at another facility, which has an in-person grant.
    other_desk = make_actor(other_clinic, [Role.RECEPTIONIST])
    assert other_desk.post("/api/v1/patients/register", {"health_number": b.health_number}
                           ).status_code == 200
    assert other_doctor.post("/api/v1/access/in-person", {
        "health_number": b.health_number, "scopes": ["encounters"], "hours": 2,
        "attestation": "عرض البطاقة"}).status_code == 201
    # App account on the duplicate; a parent (own file + account) is its guardian.
    assert reception.post(f"/api/v1/patients/{dup['id']}/account",
                          {"email": "dup-owner@test.hayat"}).status_code == 201
    parent = make_patient(reception, first_name="والد", father_name="", family_name="مختلف",
                          phone="0944999888", birth_date="1960-01-01")
    assert reception.post(f"/api/v1/patients/{parent['id']}/account",
                          {"email": "parent@test.hayat"}).status_code == 201
    assert reception.post(f"/api/v1/patients/{dup['id']}/guardians", {
        "guardian_health_number": Patient.objects.get(pk=parent["id"]).health_number,
        "relationship": "caregiver"}).status_code == 201
    b.refresh_from_db()
    return {"a": a, "b": b, "keep_visit": keep_visit, "dup_visit": dup_visit,
            "doc_id": doc.data["id"], "other_desk": other_desk,
            "parent": Patient.objects.get(pk=parent["id"])}


def test_fk_discovery_covers_every_patient_table():
    labels = {(m._meta.label_lower, f.name) for m, f in patient_foreign_keys()}
    for expected in ("clinical.encounter", "clinical.condition", "clinical.allergy",
                     "medications.prescription", "diagnostics.servicerequest",
                     "diagnostics.labreport", "diagnostics.imagingreport",
                     "documents.clinicaldocument", "referrals.referral", "access.accessgrant",
                     "access.accessrequest", "patients.patientregistration",
                     "patients.patientguardian", "patients.patientreportedinfo",
                     "patients.correctionrequest"):
        assert (expected, "patient") in labels, expected
    # Identifier history stays on the merged file; bookkeeping is never re-pointed.
    assert ("patients.healthcard", "patient") not in labels
    assert not any(label.startswith("patients.patientmerge") for label, _ in labels)


def test_suspects_are_listed_with_reasons_and_stay_inside_the_facility(
        world, reception, make_actor, other_clinic, make_patient):
    pairs = reception.get("/api/v1/patient-merges/suspects")
    assert pairs.status_code == 200
    pair = next(p for p in pairs.data if {p["a"]["id"], p["b"]["id"]}
                == {str(world["a"].pk), str(world["b"].pk)})
    assert "same_phone_birth_year" in pair["reasons"]
    assert "similar_name_birth_year" in pair["reasons"]
    assert pair["a"]["id"] == str(world["a"].pk)  # older file suggested as survivor
    # Another facility only sees pairs among its own registered patients.
    other_desk = world["other_desk"]
    make_patient(other_desk)  # same person data, registered only at the other facility
    other_pairs = other_desk.get("/api/v1/patient-merges/suspects").data
    for p in other_pairs:
        assert str(world["a"].pk) not in (p["a"]["id"], p["b"]["id"])
    # Roles without patient access cannot list.
    admin = make_actor(reception.organization, [Role.ORG_ADMIN])
    assert admin.get("/api/v1/patient-merges/suspects").status_code == 403


def test_compare_shows_counts_to_clinicians_only(world, reception, doctor):
    url = f"/api/v1/patient-merges/compare?a={world['a'].pk}&b={world['b'].pk}"
    desk = reception.get(url)
    assert desk.status_code == 200, desk.data
    assert desk.data["a"]["record_counts"] is None
    assert desk.data["b"]["patient"]["full_name"]
    assert desk.data["b"]["facts"]["has_account"] is True
    clin = doctor.get(url)
    assert clin.data["b"]["record_counts"]["encounters"] == 1
    assert clin.data["blockers"] == []


def test_merge_moves_everything_and_old_identifiers_resolve(world, reception, doctor,
                                                            other_doctor):
    a, b = world["a"], world["b"]
    old_card = HealthCard.objects.get(patient=b, status="active")
    b_user = b.user
    r = reception.post("/api/v1/patient-merges", {"source": str(b.pk), "target": str(a.pk),
                                                  **EVIDENCE})
    assert r.status_code == 201, r.data
    assert r.data["status"] == "merged" and r.data["can_revert"] is True
    a.refresh_from_db()
    b.refresh_from_db()
    assert b.status == "merged" and b.merged_into_id == a.pk
    # Records, documents, grants, guardians, registrations followed.
    assert Encounter.objects.get(pk=world["dup_visit"]["id"]).patient_id == a.pk
    assert ClinicalDocument.objects.get(pk=world["doc_id"]).patient_id == a.pk
    assert AccessGrant.objects.filter(patient=a).count() == 1
    assert PatientGuardian.objects.get(guardian=world["parent"].user).patient_id == a.pk
    assert PatientRegistration.objects.filter(
        patient=a, organization=world["other_desk"].organization).exists()
    # Unique (patient, organization): the duplicate's own registration here stays on it.
    assert PatientRegistration.objects.filter(patient=b,
                                              organization=reception.organization).exists()
    assert r.data["kept_summary"] == {"patients.patientregistration": 1}
    # The app account moved; the patient sees the full history from their account.
    assert a.user_id == b_user.pk and b.user_id is None
    me = Actor(b_user)
    assert me.get(f"/api/v1/me/patients/{a.pk}").status_code == 200
    # The guardian now acts for the surviving file.
    assert Actor(world["parent"].user).get(f"/api/v1/me/patients/{a.pk}").status_code == 200
    # Old health number and old card resolve to the surviving file.
    for payload in ({"health_number": b.health_number}, {"card_token": old_card.token}):
        found = reception.post("/api/v1/patients/identify", payload)
        assert found.status_code == 200 and found.data["patient"]["id"] == str(a.pk)
    # The merged file disappears from listings; its URL no longer opens.
    assert reception.get(f"/api/v1/patients/{b.pk}").status_code == 404
    # The other facility's grant now covers the surviving file.
    assert other_doctor.get(f"/api/v1/clinical/encounters/{world['dup_visit']['id']}"
                            ).status_code == 200
    # Audited for both files, with the reviewer.
    events = AuditEvent.objects.filter(action="patient.merge", actor_id=reception.user.pk)
    assert {str(e.patient_id) for e in events} == {str(a.pk), str(b.pk)}
    # The pair is no longer suggested.
    assert all(str(b.pk) not in (p["a"]["id"], p["b"]["id"])
               for p in reception.get("/api/v1/patient-merges/suspects").data)


def test_merge_refused_without_evidence_role_or_registration(world, reception, make_actor,
                                                             other_doctor, clinic):
    a, b = world["a"], world["b"]
    body = {"source": str(b.pk), "target": str(a.pk), **EVIDENCE}
    weak = {**body, "evidence_checks": ["patient_confirmed"]}
    assert reception.post("/api/v1/patient-merges", weak).data["code"] == "insufficient_evidence"
    assert reception.post("/api/v1/patient-merges", {**body, "confirm": False}).status_code == 400
    assert reception.post("/api/v1/patient-merges", {**body, "evidence_notes": "ok"}
                          ).status_code == 400
    for roles in ([Role.ORG_ADMIN], [Role.NURSE], [Role.LAB_STAFF]):
        assert make_actor(clinic, roles).post("/api/v1/patient-merges", body).status_code == 403
    unverified = make_actor(clinic, [Role.PHYSICIAN], verified=False)
    assert unverified.post("/api/v1/patient-merges", body).status_code == 403
    # A facility where only one of the files is registered cannot merge them.
    assert other_doctor.post("/api/v1/patient-merges", body).status_code == 404
    assert world["other_desk"].post("/api/v1/patient-merges", body).status_code == 404
    # Conflicting identity blocks the merge.
    Patient.objects.filter(pk=b.pk).update(sex="female")
    r = reception.post("/api/v1/patient-merges", body)
    assert r.status_code == 409 and r.data["code"] == "identity_conflict"
    assert Patient.objects.get(pk=b.pk).status == "active"
    assert not PatientMergeCase.objects.filter(status="merged").exists()


def test_doctor_can_merge_and_undo_restores_exactly(world, reception, doctor):
    a, b = world["a"], world["b"]
    b_user_id = b.user_id
    case = doctor.post("/api/v1/patient-merges", {"source": str(b.pk), "target": str(a.pk),
                                                  **EVIDENCE})
    assert case.status_code == 201, case.data
    # After the merge a new visit is written on the surviving file.
    later = _visit(doctor, str(a.pk), "زيارة بعد الدمج")
    r = reception.post(f"/api/v1/patient-merges/{case.data['id']}/revert",
                       {"reason": "تبين أنهما شخصان مختلفان"})
    assert r.status_code == 200, r.data
    assert r.data["status"] == "reverted"
    a.refresh_from_db()
    b.refresh_from_db()
    assert b.status == "active" and b.merged_into_id is None
    assert b.user_id == b_user_id and a.user_id is None
    assert Encounter.objects.get(pk=world["dup_visit"]["id"]).patient_id == b.pk
    assert Encounter.objects.get(pk=world["keep_visit"]["id"]).patient_id == a.pk
    assert ClinicalDocument.objects.get(pk=world["doc_id"]).patient_id == b.pk
    assert AccessGrant.objects.get().patient_id == b.pk
    assert PatientGuardian.objects.get(guardian=world["parent"].user).patient_id == b.pk
    assert PatientRegistration.objects.filter(
        patient=b, organization=world["other_desk"].organization).exists()
    # Records created after the merge stay on the target and are listed for review.
    assert Encounter.objects.get(pk=later["id"]).patient_id == a.pk
    after = r.data["revert_report"]["created_after_merge"]
    assert any(g["model"] == "clinical.encounter" and later["id"] in g["ids"] for g in after)
    assert AuditEvent.objects.filter(action="patient.merge_revert").count() == 2
    # Twice is refused.
    assert reception.post(f"/api/v1/patient-merges/{case.data['id']}/revert",
                          {"reason": "مرة ثانية"}).status_code == 409


def test_undo_window_facility_isolation_and_platform_path(world, reception, platform_admin):
    a, b = world["a"], world["b"]
    case = reception.post("/api/v1/patient-merges", {"source": str(b.pk), "target": str(a.pk),
                                                     **EVIDENCE}).data
    # Another facility cannot see or undo it.
    other = world["other_desk"]
    assert other.get(f"/api/v1/patient-merges/{case['id']}").status_code == 404
    assert other.post(f"/api/v1/patient-merges/{case['id']}/revert",
                      {"reason": "محاولة"}).status_code == 404
    # Outside the window the facility cannot undo; platform support can (audited).
    PatientMergeCase.objects.filter(pk=case["id"]).update(
        reviewed_at=timezone.now() - timedelta(days=45))
    r = reception.post(f"/api/v1/patient-merges/{case['id']}/revert", {"reason": "متأخر جداً"})
    assert r.status_code == 409 and r.data["code"] == "undo_window_expired"
    assert reception.get(f"/api/v1/patient-merges/{case['id']}").data["can_revert"] is False
    call_command("revert_patient_merge", case["id"], by=platform_admin.user.email,
                 reason="طلب دعم موثق")
    b.refresh_from_db()
    assert b.status == "active"
    assert AuditEvent.objects.filter(action="patient.merge_revert",
                                     actor_id=platform_admin.user.pk).exists()


def test_rejecting_a_pair_hides_it_and_is_listed_in_history(world, reception):
    a, b = world["a"], world["b"]
    r = reception.post("/api/v1/patient-merges/reject", {"a": str(a.pk), "b": str(b.pk),
                                                         "reason": "توأمان بأسماء متقاربة"})
    assert r.status_code == 201 and r.data["status"] == "rejected"
    pairs = reception.get("/api/v1/patient-merges/suspects").data
    assert not any({p["a"]["id"], p["b"]["id"]} == {str(a.pk), str(b.pk)} for p in pairs)
    history = reception.get("/api/v1/patient-merges").data["results"]
    assert history[0]["id"] == r.data["id"]
