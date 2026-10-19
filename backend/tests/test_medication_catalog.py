"""Medication catalog import, validation, duplicates and unknown-medication review (§11)."""

from pathlib import Path

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.audit.models import AuditEvent
from apps.medications.catalog import dedupe_key, map_dosage_form, map_route, normalize_strength
from apps.medications.models import CatalogImport, CatalogSource, Medication, MedicationFavorite

pytestmark = pytest.mark.django_db

SAMPLE = Path(__file__).resolve().parent.parent / "apps/medications/samples/synthetic_catalog_sample.csv"
LICENSE = "عينة اصطناعية من إعداد فريق التطوير، لا تمثل أدوية حقيقية"


def _upload(actor, content: bytes, name="catalog.csv", **extra):
    data = {"file": SimpleUploadedFile(name, content, content_type="text/csv"),
            "source_name": "مصدر اختباري", "source_version": "2026.1",
            "license_text": LICENSE, "license_confirmed": "true", "is_synthetic": "true",
            **extra}
    return actor.client.post("/api/v1/admin/catalog/imports", data, format="multipart")


@pytest.mark.parametrize(("raw", "expected"), [
    ("500MG", "500 mg"), ("٢٥٠ ملغ", "250 mg"), ("0,5 g", "0.5 g"), ("120mg/5ml", "120 mg/5 ml"),
    ("1 ٪", "1%"), ("100 mcg", "100 mcg"), ("1000 iu", "1000 IU"), ("", ""),
    ("20 mg + 10 mg", "20 mg + 10 mg"), ("5.0 mg/ml", "5 mg/ml"), ("غير مفهوم 3x", "غير مفهوم 3x"),
])
def test_strength_normalisation(raw, expected):
    assert normalize_strength(raw) == expected


def test_form_route_mapping_and_dedupe_key():
    assert map_dosage_form("مضغوطات") == "tablet"
    assert map_dosage_form("Film-coated tablet") == "tablet"
    assert map_dosage_form("بخاخ أنفي") == "nasal_spray"
    assert map_dosage_form("nasal_spray") == "nasal_spray"
    assert map_dosage_form("مجهول") is None
    assert map_route("PO") == "oral" and map_route("عضلي") == "im"
    assert dedupe_key("صنف ألفا", "500MG", "tablet", "شركة") == \
        dedupe_key("صنف الفا", "500 mg", "tablet", "شركة")
    assert dedupe_key("صنف ألفا", "500 mg", "tablet") != dedupe_key("صنف ألفا", "250 mg", "tablet")


def test_dry_run_reports_without_touching_catalog(platform_admin):
    before = Medication.objects.count()
    r = _upload(platform_admin, SAMPLE.read_bytes(), "synthetic_catalog_sample.csv")
    assert r.status_code == 201, r.data
    assert r.data["status"] == "previewed"
    assert (r.data["total_rows"], r.data["created_count"], r.data["duplicate_count"],
            r.data["error_count"]) == (12, 10, 1, 1)
    assert r.data["error_report"][0]["row"] == 13 and r.data["error_report"][0]["field"] == \
        "dosage_form"
    actions = {row["row"]: row["action"] for row in r.data["preview"]}
    assert actions[12] == "duplicate" and actions[13] == "error" and actions[2] == "create"
    assert Medication.objects.count() == before


def test_commit_then_reimport_updates_and_detects_unchanged(platform_admin):
    imp = _upload(platform_admin, SAMPLE.read_bytes()).data
    r = platform_admin.post(f"/api/v1/admin/catalog/imports/{imp['id']}/commit")
    assert r.status_code == 200, r.data
    assert r.data["status"] == "committed" and r.data["created_count"] == 10
    med = Medication.objects.get(external_id="SYN-0003")
    assert (med.strength, med.dosage_form, med.default_route, med.unit) == \
        ("250 mg", "capsule", "oral", "كبسولة")
    assert med.is_synthetic and med.source == CatalogSource.SYNTHETIC_TEST
    assert med.source_name == "مصدر اختباري" and med.source_version == "2026.1"
    assert med.imported_at is not None and str(med.catalog_import_id) == imp["id"]
    assert med.manufacturer == "مختبرات وهمية للتطوير"
    # Committing twice is refused.
    assert platform_admin.post(f"/api/v1/admin/catalog/imports/{imp['id']}/commit"
                               ).status_code == 409
    # Same file again: nothing new; a changed row is an update matched by external id.
    changed = SAMPLE.read_text(encoding="utf-8").replace("SYN-0003,صنف اصطناعي بيتا,BETA-SYN,,٢٥٠ ملغ",
                                                         "SYN-0003,صنف اصطناعي بيتا,BETA-SYN,,500 ملغ")
    again = _upload(platform_admin, changed.encode()).data
    assert (again["created_count"], again["updated_count"], again["unchanged_count"]) == (0, 1, 9)
    platform_admin.post(f"/api/v1/admin/catalog/imports/{again['id']}/commit")
    assert Medication.objects.get(external_id="SYN-0003").strength == "500 mg"
    assert Medication.objects.filter(external_id="SYN-0003").count() == 1
    assert AuditEvent.objects.filter(action="catalog.change").count() >= 3


def test_same_entry_from_another_source_is_a_duplicate(platform_admin):
    csv_body = "name,strength,dosage_form,manufacturer\nصنف اختبار,10mg,tablet,شركة س\n"
    first = _upload(platform_admin, csv_body.encode(), is_synthetic="false",
                    source_name="مصدر أ").data
    platform_admin.post(f"/api/v1/admin/catalog/imports/{first['id']}/commit")
    second = _upload(platform_admin, "name,strength,dosage_form,manufacturer\n"
                     "صنف إختبار,10 MG,مضغوطات,شركة س\n".encode(), is_synthetic="false",
                     source_name="مصدر ب").data
    assert second["duplicate_count"] == 1 and second["created_count"] == 0


def test_validation_and_declaration_rules(platform_admin):
    assert _upload(platform_admin, b"name,dosage_form\n", license_confirmed="false"
                   ).data["code"] == "license_required"
    assert _upload(platform_admin, b"name,dosage_form\n", license_text="قصير").status_code == 400
    assert _upload(platform_admin, b"foo,bar\n1,2\n").data["code"] == "missing_columns"
    assert _upload(platform_admin, b"\xff\xfe\x00bad").data["code"] == "bad_encoding"
    r = platform_admin.client.post("/api/v1/admin/catalog/imports", {
        "file": SimpleUploadedFile("x.exe", b"MZ"), "source_name": "س", "license_text": LICENSE,
        "license_confirmed": "true"}, format="multipart")
    assert r.status_code == 400
    bad = _upload(platform_admin, "name,dosage_form,route\n,tablet,\nصنف,حبوب,طائر\n"
                  "صنف ج,tablet,\n".encode()).data
    assert bad["error_count"] == 2 and bad["created_count"] == 1
    assert {e["field"] for e in bad["error_report"]} == {"name", "route"}
    json_body = b'{"items": [{"name": "\xd8\xb5\xd9\x86\xd9\x81 json", "dosage_form": "syrup"}]}'
    j = _upload(platform_admin, json_body, name="c.json").data
    assert j["file_format"] == "json" and j["created_count"] == 1
    # Discard.
    d = platform_admin.post(f"/api/v1/admin/catalog/imports/{j['id']}/discard")
    assert d.data["status"] == "discarded"
    assert platform_admin.post(f"/api/v1/admin/catalog/imports/{j['id']}/commit"
                               ).status_code == 409


def test_only_platform_admin_manages_catalog(doctor, reception):
    for actor in (doctor, reception):
        assert _upload(actor, SAMPLE.read_bytes()).status_code == 403
        assert actor.get("/api/v1/admin/catalog/imports").status_code == 403
        assert actor.get("/api/v1/admin/catalog/medications").status_code == 403
    assert not CatalogImport.objects.exists()


def test_synthetic_hidden_from_search_when_disabled(platform_admin, doctor, settings):
    synthetic = Medication.objects.create(name="دواء تجريبي — خافض", strength="200 mg",
                                          dosage_form="tablet",
                                          source=CatalogSource.SYNTHETIC_TEST)
    real = Medication.objects.create(name="دواء مستورد — خافض", strength="200 mg",
                                     dosage_form="tablet", source=CatalogSource.IMPORTED,
                                     source_name="مصدر مرخص")
    ids = {m["id"] for m in doctor.get("/api/v1/medications/catalog?q=خافض").data["results"]}
    assert {str(synthetic.pk), str(real.pk)} <= ids
    settings.HAYAT = {**settings.HAYAT, "CATALOG_INCLUDE_SYNTHETIC": False}
    ids = {m["id"] for m in doctor.get("/api/v1/medications/catalog?q=خافض").data["results"]}
    assert ids == {str(real.pk)}
    # Deactivated entries disappear from prescribing search.
    r = platform_admin.patch(f"/api/v1/admin/catalog/medications/{real.pk}", {"is_active": False})
    assert r.status_code == 200 and r.data["is_active"] is False
    assert doctor.get("/api/v1/medications/catalog?q=خافض").data["results"] == []


def test_practitioner_medication_is_private_until_published(platform_admin, doctor,
                                                           other_doctor, make_actor, clinic):
    colleague = make_actor(clinic, ["physician"])  # same clinic, still isolated
    own = doctor.post("/api/v1/medications/catalog", {"name": "دواء خاص بالطبيب",
                                                      "strength": "10 mg",
                                                      "dosage_form": "tablet"})
    assert own.status_code == 201 and own.data["is_private"] is True
    med_id = own.data["id"]

    def found(actor):
        return med_id in {m["id"] for m in
                          actor.get("/api/v1/medications/catalog?q=خاص بالطبيب").data["results"]}

    assert found(doctor)
    assert not found(other_doctor) and not found(colleague)
    # Not usable by id either: favorites, templates, prescriptions.
    assert other_doctor.post("/api/v1/medications/favorites",
                             {"medication_id": med_id}).status_code == 404
    item = {"medication": med_id, "schedule_type": "custom", "instructions": "حسب الحاجة"}
    assert colleague.post("/api/v1/medications/templates",
                          {"name": "قالب", "items": [item]}).status_code == 400
    assert doctor.post("/api/v1/medications/templates",
                       {"name": "قالب", "items": [item]}).status_code == 201
    # Published by the platform administrator → shared with everyone.
    platform_admin.post(f"/api/v1/admin/catalog/medications/{med_id}/review", {"decision": "keep"})
    assert found(other_doctor) and found(colleague)


def test_unknown_medication_review_keep_and_merge_with_favorites(platform_admin, doctor):
    catalog_entry = Medication.objects.create(name="صنف معتمد", strength="5 mg",
                                              dosage_form="tablet", source=CatalogSource.IMPORTED)
    typed = doctor.post("/api/v1/medications/catalog", {"name": "صنف كتبه الطبيب",
                                                        "strength": "5mg",
                                                        "dosage_form": "tablet"})
    assert typed.status_code == 201, typed.data
    other = doctor.post("/api/v1/medications/catalog", {"name": "صنف آخر",
                                                        "dosage_form": "syrup"}).data
    fav = doctor.post("/api/v1/medications/favorites", {"medication_id": typed.data["id"]})
    assert fav.status_code == 201
    pending = platform_admin.get("/api/v1/admin/catalog/medications?review_status=pending").data
    assert {m["id"] for m in pending["results"]} == {typed.data["id"], other["id"]}
    assert pending["results"][0]["added_by_name"]
    # Keep one.
    kept = platform_admin.post(f"/api/v1/admin/catalog/medications/{other['id']}/review",
                               {"decision": "keep"})
    assert kept.data["review_status"] == "accepted" and kept.data["is_active"] is True
    # Merge requires a valid target.
    assert platform_admin.post(f"/api/v1/admin/catalog/medications/{typed.data['id']}/review",
                               {"decision": "merge"}).status_code == 400
    merged = platform_admin.post(f"/api/v1/admin/catalog/medications/{typed.data['id']}/review",
                                 {"decision": "merge", "target": str(catalog_entry.pk)})
    assert merged.status_code == 200, merged.data
    assert merged.data["review_status"] == "merged" and merged.data["is_active"] is False
    assert merged.data["merged_into"] == catalog_entry.pk or \
        str(merged.data["merged_into"]) == str(catalog_entry.pk)
    # The doctor's favorite now points to the catalog entry and still works.
    favorites = doctor.get("/api/v1/medications/favorites").data
    assert [f["medication"]["id"] for f in favorites] == [str(catalog_entry.pk)]
    assert MedicationFavorite.objects.count() == 1
    # Imported entries are not "unknown medications".
    assert platform_admin.post(f"/api/v1/admin/catalog/medications/{catalog_entry.pk}/review",
                               {"decision": "keep"}).data["code"] == "not_unknown"
