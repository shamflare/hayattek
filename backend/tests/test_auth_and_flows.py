import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.accounts.models import DeviceToken
from apps.core.arabic import normalize_arabic, normalize_syrian_phone
from apps.core.ids import luhn_is_valid
from apps.medications.models import PrescriptionItem
from apps.medications.sig import render_sig
from apps.notifications.sms import ConsoleSmsProvider
from apps.patients.models import Patient
from tests.conftest import PASSWORD, Actor

pytestmark = pytest.mark.django_db

PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


# ------------------------------------------------------------------ authentication


def test_login_lockout_after_failed_attempts(make_user):
    user = make_user(email="lock@test.hayat")
    client = APIClient()
    for _ in range(5):
        r = client.post("/api/v1/auth/login", {"identifier": user.email, "password": "wrong"},
                        format="json")
        assert r.status_code == 400
    r = client.post("/api/v1/auth/login", {"identifier": user.email, "password": PASSWORD},
                    format="json")
    assert r.status_code == 403 and r.data["code"] == "account_locked"


def test_unknown_and_wrong_password_look_identical(make_user):
    make_user(email="exists@test.hayat")
    client = APIClient()
    a = client.post("/api/v1/auth/login", {"identifier": "nobody@test.hayat", "password": "x"},
                    format="json")
    b = client.post("/api/v1/auth/login", {"identifier": "exists@test.hayat", "password": "x"},
                    format="json")
    assert a.status_code == b.status_code and a.data == b.data


def test_login_by_syrian_phone(make_user):
    make_user(email=None, phone="0991234567")
    r = APIClient().post("/api/v1/auth/login", {"identifier": "+963 991 234 567",
                                                 "password": PASSWORD}, format="json")
    assert r.status_code == 200


def test_mobile_token_issue_use_and_revoke(make_user):
    user = make_user()
    client = APIClient()
    r = client.post("/api/v1/auth/token", {"identifier": user.email, "password": PASSWORD,
                                           "device_name": "Test phone"}, format="json")
    assert r.status_code == 201
    raw = r.data["token"]
    # Only the hash is stored.
    assert not DeviceToken.objects.filter(key_hash=raw).exists()
    client.credentials(HTTP_AUTHORIZATION=f"Token {raw}")
    assert client.get("/api/v1/auth/me").status_code == 200
    assert client.post("/api/v1/auth/logout").status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401


def test_password_reset_does_not_reveal_accounts():
    r = APIClient().post("/api/v1/auth/password/reset", {"identifier": "ghost@test.hayat"},
                         format="json")
    assert r.status_code == 200 and r.data == {"ok": True}


def test_mfa_enrollment_and_login(make_user):
    import pyotp

    user = make_user(email="mfa@test.hayat")
    me = Actor(user)
    secret = me.post("/api/v1/auth/mfa/setup").data["secret"]
    assert me.post("/api/v1/auth/mfa/enable", {"otp": pyotp.TOTP(secret).now()}).status_code == 200
    client = APIClient()
    r = client.post("/api/v1/auth/login", {"identifier": user.email, "password": PASSWORD},
                    format="json")
    assert r.status_code == 401 and r.data["code"] == "mfa_required"
    r = client.post("/api/v1/auth/login", {"identifier": user.email, "password": PASSWORD,
                                           "otp": pyotp.TOTP(secret).now()}, format="json")
    assert r.status_code == 200


# ------------------------------------------------------------------ identity


def test_health_number_is_random_with_check_digit(reception, make_patient):
    a = make_patient(reception)
    b = make_patient(reception, first_name="رامي", phone="0933999888")
    na, nb = (Patient.objects.get(pk=x["id"]).health_number for x in (a, b))
    assert na != nb and luhn_is_valid(na) and luhn_is_valid(nb) and len(na) == 10
    # Not derived from the phone.
    assert "933000111" not in na


def test_duplicate_detection_and_acknowledgement(reception, make_patient):
    make_patient(reception)
    data = {"first_name": "سامي", "father_name": "خالد", "family_name": "التجريبي",
            "birth_date": "1985-06-01"}
    r = reception.post("/api/v1/patients", data)
    assert r.status_code == 409 and r.data["candidates"]
    assert reception.post("/api/v1/patients", {**data, "acknowledge_duplicates": True}
                          ).status_code == 201


def test_card_revocation_and_public_scan(reception, doctor, make_patient):
    patient = make_patient(reception)
    p = Patient.objects.get(pk=patient["id"])
    old_token = p.cards.get(status="active").token
    public = APIClient().get(f"/api/v1/public/cards/{old_token}")
    assert public.data == {"valid": True, "brand": "حياة"}  # no personal data
    r = reception.post(f"/api/v1/patients/{p.pk}/card", {"reason": "فقدان البطاقة"})
    assert r.status_code == 201
    assert doctor.post("/api/v1/patients/identify", {"card_token": old_token}).status_code == 404
    new_token = p.cards.get(status="active").token
    assert doctor.post("/api/v1/patients/identify", {"card_token": new_token}).status_code == 200
    p.refresh_from_db()
    assert p.health_number == Patient.objects.get(pk=p.pk).health_number


def test_registering_network_patient_requires_presented_identifier(reception, make_actor,
                                                                   other_clinic, make_patient):
    from apps.organizations.models import Role

    other_desk = make_actor(other_clinic, [Role.RECEPTIONIST])
    patient = make_patient(reception)
    p = Patient.objects.get(pk=patient["id"])
    assert other_desk.post("/api/v1/patients/register", {"health_number": "1234567890"}
                           ).status_code == 404
    r = other_desk.post("/api/v1/patients/register", {"health_number": p.health_number})
    assert r.status_code == 200 and r.data["access"]["registered"]


# ------------------------------------------------------------------ consent by OTP


def test_otp_consent_flow(reception, doctor, other_doctor, make_patient):
    patient = make_patient(reception)
    p = Patient.objects.get(pk=patient["id"])
    ConsoleSmsProvider.sent.clear()
    req = other_doctor.post("/api/v1/access/requests", {
        "health_number": p.health_number, "scopes": ["summary"], "hours": 4, "channel": "otp"})
    assert req.status_code == 201
    phone, message = ConsoleSmsProvider.sent[-1]
    assert phone == "+963933000111"
    code = "".join(ch for ch in message if ch.isdigit())[-6:]
    bad = other_doctor.post(f"/api/v1/access/requests/{req.data['id']}/verify-otp",
                            {"otp": "000000" if code != "000000" else "111111"})
    assert bad.status_code == 400
    good = other_doctor.post(f"/api/v1/access/requests/{req.data['id']}/verify-otp",
                             {"otp": code})
    assert good.status_code == 200 and good.data["scopes"] == ["summary"]
    # Single use.
    again = other_doctor.post(f"/api/v1/access/requests/{req.data['id']}/verify-otp",
                              {"otp": code})
    assert again.status_code == 400


def test_in_person_grant_requires_card_or_number(other_doctor, reception, make_patient):
    patient = make_patient(reception)
    r = other_doctor.post("/api/v1/access/in-person", {
        "patient_id": patient["id"], "scopes": ["summary"], "hours": 2, "attestation": "حضور"})
    assert r.status_code == 400


# ------------------------------------------------------------------ documents


def test_document_upload_validation_and_permissions(doctor, other_doctor, reception,
                                                    make_patient):
    patient = make_patient(reception)
    fake = SimpleUploadedFile("evil.pdf", b"MZ\x90\x00 not a pdf", content_type="application/pdf")
    r = doctor.client.post("/api/v1/documents", {"patient": patient["id"], "file": fake,
                                                 "category": "medical_report", "title": "x"},
                           format="multipart")
    assert r.status_code == 400 and r.data["code"] == "unsupported_type"

    pdf = SimpleUploadedFile("report.pdf", PDF_BYTES, content_type="application/pdf")
    r = doctor.client.post("/api/v1/documents", {"patient": patient["id"], "file": pdf,
                                                 "category": "medical_report",
                                                 "title": "تقرير تجريبي"}, format="multipart")
    assert r.status_code == 201, r.data
    doc_id = r.data["id"]
    assert r.data["mime_type"] == "application/pdf"
    download = doctor.get(f"/api/v1/documents/{doc_id}/download")
    assert download.status_code == 200
    assert b"".join(download.streaming_content) == PDF_BYTES
    assert other_doctor.get(f"/api/v1/documents/{doc_id}/download").status_code == 404
    assert reception.get(f"/api/v1/documents/{doc_id}/download").status_code == 404


def test_patient_can_upload_own_document(reception, make_patient, make_user):
    patient = make_patient(reception)
    owner = make_user()
    Patient.objects.filter(pk=patient["id"]).update(user=owner)
    me = Actor(owner)
    pdf = SimpleUploadedFile("old.pdf", PDF_BYTES, content_type="application/pdf")
    r = me.client.post("/api/v1/documents", {"patient": patient["id"], "file": pdf,
                                             "category": "lab_result", "title": "تحليل قديم"},
                       format="multipart")
    assert r.status_code == 201 and r.data["source"] == "patient"


# ------------------------------------------------------------------ helpers


def test_arabic_normalisation():
    assert normalize_arabic("أحمد عبد الله") == normalize_arabic("احمد عبدالله")
    assert normalize_arabic("فاطمة") == normalize_arabic("فاطمه")
    assert normalize_syrian_phone("٠٩٣٣ ١٢٣ ٤٥٦") == "+963933123456"


@pytest.mark.parametrize(("item", "expected"), [
    ({"dose_amount": 1, "dose_unit": "حبة", "schedule_type": "times_of_day",
      "times_of_day": ["evening", "morning"], "meal_relation": "after", "duration_value": 7,
      "duration_unit": "days"}, "1 حبة صباحاً ومساءً بعد الطعام لمدة 7 أيام"),
    ({"dose_amount": "0.5", "dose_unit": "حبة", "schedule_type": "every_days",
      "interval_days": 2}, "نصف حبة يوماً بعد يوم"),
    ({"schedule_type": "weekly", "weekdays": ["sat", "tue"], "duration_unit": "ongoing"},
     "أيام السبت، الثلاثاء بشكل مستمر"),
    ({"schedule_type": "custom", "instructions": "حسب جدول التدرج المرفق"},
     "حسب جدول التدرج المرفق"),
])
def test_sig_rendering(item, expected):
    assert render_sig(PrescriptionItem(medication_name="x", **item)) == expected


def test_prescription_validation_rejects_incomplete_schedule(doctor, reception, make_patient):
    patient = make_patient(reception)
    r = doctor.post("/api/v1/prescriptions", {"patient": patient["id"], "items": [
        {"medication_name": "دواء", "schedule_type": "times_of_day", "times_of_day": []}]})
    assert r.status_code == 400


def test_public_join_request_and_admin_listing(platform_admin, doctor):
    r = APIClient().post("/api/v1/public/join-requests", {
        "facility_name": "عيادة تجريبية", "kind": "clinic", "contact_name": "طبيب تجريبي",
        "phone": "0933000000"}, format="json")
    assert r.status_code == 201
    assert platform_admin.get("/api/v1/admin/join-requests").data["count"] == 1
    assert doctor.get("/api/v1/admin/join-requests").status_code == 403


def test_search_by_name_number_and_phone(reception, make_patient):
    patient = make_patient(reception, first_name="ريم", father_name="اختبار42", phone="0944123456")
    p = Patient.objects.get(pk=patient["id"])
    for q in ("ريم", "اختبار42", p.health_number[:6], "0944123456", "٠٩٤٤١٢٣٤٥٦"):
        ids = [r["id"] for r in reception.get("/api/v1/patients", data={"q": q}).data["results"]]
        assert str(p.pk) in [str(i) for i in ids], q


def test_reception_activates_patient_account_and_links_guardian(reception, other_doctor,
                                                                make_patient):
    from apps.patients.models import PatientGuardian

    parent = make_patient(reception, first_name="أب", phone="0933111222")
    child = make_patient(reception, first_name="طفل", phone="", birth_date="2020-05-01")
    ConsoleSmsProvider.sent.clear()
    r = reception.post(f"/api/v1/patients/{parent['id']}/account", {})
    assert r.status_code == 201
    assert ConsoleSmsProvider.sent and "/reset-password?" in ConsoleSmsProvider.sent[-1][1]
    parent_obj = Patient.objects.get(pk=parent["id"])
    assert parent_obj.user is not None and not parent_obj.user.has_usable_password()
    # Second activation is refused.
    assert reception.post(f"/api/v1/patients/{parent['id']}/account", {}).status_code == 409
    # A facility where the patient is not registered cannot do it.
    assert other_doctor.post(f"/api/v1/patients/{parent['id']}/account", {}).status_code in (403, 404)

    r = reception.post(f"/api/v1/patients/{child['id']}/guardians", {
        "guardian_health_number": parent_obj.health_number, "relationship": "parent"})
    assert r.status_code == 201, r.data
    g = PatientGuardian.objects.get(patient_id=child["id"])
    assert str(g.valid_until) == "2038-05-01"
    # The parent now sees the child's file from their own account.
    me = Actor(parent_obj.user)
    assert me.get(f"/api/v1/me/patients/{child['id']}").status_code == 200
    wards = me.get("/api/v1/auth/me").data["wards"]
    assert [w["id"] for w in wards] == [child["id"]] or [str(w["id"]) for w in wards] == [child["id"]]
