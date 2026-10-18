"""Medication catalog import: validation, normalisation, duplicate detection (§11, ADR-028).

Flow: upload → `preview_import` (dry run, nothing written to the catalog) → the platform
administrator reviews counts/errors → `commit_import` applies the same plan in one transaction.
No real drug database ships with the code; only a synthetic sample under `samples/`.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from dataclasses import dataclass, field
from datetime import date

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from django.utils.translation import gettext as _

from apps.core.arabic import normalize_arabic, normalize_digits
from apps.core.exceptions import DomainError

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_ROWS = 20_000
MAX_REPORTED_ERRORS = 500
MAX_PREVIEW_ROWS = 100

# ---------------------------------------------------------------- vocabularies

FORM_ALIASES = {
    "tablet": ["tablet", "tablets", "tab", "tabs", "film coated tablet", "film-coated tablet",
               "coated tablet", "مضغوطات", "مضغوطة", "مضغوط", "أقراص", "قرص", "حبوب", "حبة",
               "ملبسات"],
    "capsule": ["capsule", "capsules", "cap", "caps", "كبسولات", "كبسولة", "كبسول"],
    "syrup": ["syrup", "شراب"],
    "suspension": ["suspension", "oral suspension", "معلق", "معلق فموي"],
    "drops": ["drops", "drop", "eye drops", "ear drops", "oral drops", "قطرة", "قطرات", "نقط"],
    "injection": ["injection", "inj", "ampoule", "ampule", "vial", "حقن", "حقنة", "أمبولة",
                  "امبولات", "فيال"],
    "cream": ["cream", "كريم"],
    "ointment": ["ointment", "مرهم"],
    "gel": ["gel", "جل", "هلام"],
    "inhaler": ["inhaler", "inhalation aerosol", "metered dose inhaler", "mdi", "بخاخ استنشاق",
                "بخاخ", "بخاخ ربو"],
    "nasal_spray": ["nasal spray", "nasal_spray", "بخاخ أنفي", "بخاخ انفي"],
    "suppository": ["suppository", "suppositories", "supp", "تحاميل", "تحميلة"],
    "sachet": ["sachet", "sachets", "granules", "powder for oral solution", "أكياس", "كيس",
               "ظروف"],
    "patch": ["patch", "transdermal patch", "لصاقة", "لصاقات"],
    "effervescent": ["effervescent", "effervescent tablet", "فوار", "أقراص فوارة"],
    "other": ["other", "أخرى", "اخرى"],
}

ROUTE_ALIASES = {
    "oral": ["oral", "po", "by mouth", "فموي", "عن طريق الفم", "فمويا"],
    "sublingual": ["sublingual", "sl", "تحت اللسان"],
    "topical": ["topical", "cutaneous", "dermal", "موضعي", "جلدي"],
    "iv": ["iv", "intravenous", "وريدي"],
    "im": ["im", "intramuscular", "عضلي"],
    "sc": ["sc", "subcutaneous", "تحت الجلد"],
    "inhalation": ["inhalation", "inhaled", "استنشاق", "استنشاقي"],
    "nasal": ["nasal", "intranasal", "أنفي", "انفي"],
    "ophthalmic": ["ophthalmic", "eye", "عيني"],
    "otic": ["otic", "ear", "أذني", "اذني"],
    "rectal": ["rectal", "pr", "شرجي"],
    "vaginal": ["vaginal", "pv", "مهبلي"],
    "other": ["other", "أخرى", "اخرى"],
}

DEFAULT_ROUTE_BY_FORM = {
    "cream": "topical", "ointment": "topical", "gel": "topical", "patch": "topical",
    "inhaler": "inhalation", "nasal_spray": "nasal", "suppository": "rectal",
    "injection": "im",
}

DEFAULT_UNIT_BY_FORM = {
    "tablet": "حبة", "capsule": "كبسولة", "syrup": "مل", "suspension": "مل", "drops": "نقطة",
    "injection": "أمبولة", "inhaler": "بخة", "nasal_spray": "بخة", "suppository": "تحميلة",
    "sachet": "كيس", "patch": "لصاقة", "effervescent": "حبة", "cream": "دهنة",
    "ointment": "دهنة", "gel": "دهنة",
}

HEADER_ALIASES = {
    "name": ["name", "trade_name", "trade name", "الاسم", "الاسم التجاري"],
    "brand_name": ["brand_name", "brand", "العلامة التجارية"],
    "active_ingredient": ["active_ingredient", "active ingredient", "generic", "inn",
                          "المادة الفعالة"],
    "strength": ["strength", "التركيز", "العيار"],
    "dosage_form": ["dosage_form", "form", "dosage form", "الشكل الدوائي", "الشكل"],
    "route": ["route", "default_route", "طريق الإعطاء", "الطريق"],
    "unit": ["unit", "dose_unit", "وحدة الجرعة"],
    "manufacturer": ["manufacturer", "company", "الشركة المصنعة", "الشركة"],
    "country_of_registration": ["country_of_registration", "country", "بلد التسجيل"],
    "registration_number": ["registration_number", "reg_no", "رقم التسجيل"],
    "external_id": ["external_id", "id", "code", "المعرف", "الرمز"],
}

UNIT_ALIASES = {
    "mg": ["mg", "milligram", "milligrams", "ملغ", "مغ", "ملغم", "مللغ", "ملغرام"],
    "g": ["g", "gm", "gram", "grams", "غ", "غرام", "جرام"],
    "mcg": ["mcg", "µg", "μg", "ug", "microgram", "ميكروغرام", "مكغ", "ميكغ"],
    "ml": ["ml", "milliliter", "millilitre", "مل", "ملل", "ميلي"],
    "l": ["l", "liter", "litre", "لتر"],
    "IU": ["iu", "i.u.", "وحدة دولية", "وحدة"],
    "%": ["%", "٪"],
    "mmol": ["mmol"],
    "mEq": ["meq"],
}

_FORM_LOOKUP = {normalize_arabic(a): k for k, v in FORM_ALIASES.items() for a in v}
_ROUTE_LOOKUP = {normalize_arabic(a): k for k, v in ROUTE_ALIASES.items() for a in v}
_HEADER_LOOKUP = {normalize_arabic(a): k for k, v in HEADER_ALIASES.items() for a in v}
_UNIT_LOOKUP = {normalize_arabic(a): k for k, v in UNIT_ALIASES.items() for a in v}
_AMOUNT = re.compile(r"^\s*(\d+(?:\.\d+)?)?\s*(.*?)\s*$")

FIELD_LIMITS = {"name": 200, "brand_name": 200, "active_ingredient": 300, "strength": 60,
                "unit": 30, "manufacturer": 200, "country_of_registration": 80,
                "registration_number": 80, "external_id": 120}


def map_dosage_form(raw: str) -> str | None:
    key = normalize_arabic(raw).replace("_", " ")
    return _FORM_LOOKUP.get(key) or _FORM_LOOKUP.get(key.replace(" ", "_"))


def map_route(raw: str) -> str | None:
    return _ROUTE_LOOKUP.get(normalize_arabic(raw))


def _number(text: str) -> str:
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def normalize_strength(raw: str | None) -> str:
    """'500MG' → '500 mg', '٠٫٥ غ' → '0.5 g', '120mg/5ml' → '120 mg/5 ml', '1 ٪' → '1%'.

    Unparseable values are returned trimmed (never rejected: strength is optional)."""
    text = normalize_digits(raw or "").replace("٫", ".").strip()
    if not text:
        return ""
    text = re.sub(r"(\d),(\d)", r"\1.\2", text)
    combos = []
    for combo in re.split(r"\s*\+\s*", text):
        parts = []
        for part in combo.split("/"):
            match = _AMOUNT.match(part)
            amount, unit_text = (match.group(1) or "", match.group(2)) if match else ("", part)
            unit = _UNIT_LOOKUP.get(normalize_arabic(unit_text)) if unit_text else ""
            if unit is None:
                return re.sub(r"\s+", " ", text)
            if unit == "%":
                parts.append(f"{_number(amount)}%")
            else:
                parts.append(" ".join(p for p in [_number(amount) if amount else "", unit] if p))
        combos.append("/".join(parts))
    return " + ".join(combos)


def dedupe_key(name: str, strength: str, dosage_form: str, manufacturer: str = "") -> str:
    """Same normalised name + strength + form + manufacturer = the same catalog entry."""
    return "|".join([
        normalize_arabic(name),
        normalize_strength(strength).lower().replace(" ", ""),
        dosage_form or "",
        normalize_arabic(manufacturer),
    ])[:600]


# ---------------------------------------------------------------- parsing


def parse_file(content: bytes, filename: str) -> tuple[list[tuple[int, dict]], str]:
    if len(content) > MAX_FILE_BYTES:
        raise DomainError(_("الملف أكبر من الحد المسموح (5 ميغابايت)."), code="file_too_large")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise DomainError(_("يجب أن يكون الملف بترميز UTF-8."), code="bad_encoding") from None
    if filename.lower().endswith(".json"):
        fmt = "json"
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            raise DomainError(_("ملف JSON غير صالح."), code="bad_json") from None
        if isinstance(data, dict):
            data = data.get("items") or data.get("medications") or []
        if not isinstance(data, list) or not all(isinstance(r, dict) for r in data):
            raise DomainError(_("يجب أن يحتوي ملف JSON على قائمة أصناف."), code="bad_json")
        raw_rows = [(i + 1, r) for i, r in enumerate(data)]
    else:
        fmt = "csv"
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            raise DomainError(_("الملف فارغ أو بلا سطر عناوين."), code="empty_file")
        raw_rows = [(i + 2, r) for i, r in enumerate(reader)]  # header is line 1
    if len(raw_rows) > MAX_ROWS:
        raise DomainError(_("عدد الأسطر أكبر من الحد المسموح (%(n)s).") % {"n": MAX_ROWS},
                          code="too_many_rows")
    rows = []
    for line, raw in raw_rows:
        row = {}
        for key, value in raw.items():
            if key is None:
                continue
            canonical = _HEADER_LOOKUP.get(normalize_arabic(str(key)).replace("_", " ")) \
                or _HEADER_LOOKUP.get(normalize_arabic(str(key)))
            if canonical:
                row[canonical] = "" if value is None else str(value).strip()
        rows.append((line, row))
    if rows and not any("name" in r for _l, r in rows):
        raise DomainError(_("لم يُعثر على عمود الاسم (name). راجع سطر العناوين."),
                          code="missing_columns")
    return rows, fmt


def validate_row(row: dict) -> tuple[dict, list[tuple[str, str]]]:
    errors: list[tuple[str, str]] = []
    clean = {k: (row.get(k) or "").strip() for k in FIELD_LIMITS}
    if not clean["name"]:
        errors.append(("name", "الاسم مطلوب."))
    form = map_dosage_form(row.get("dosage_form") or "")
    if not (row.get("dosage_form") or "").strip():
        errors.append(("dosage_form", "الشكل الدوائي مطلوب."))
    elif form is None:
        errors.append(("dosage_form", f"شكل دوائي غير معروف: {row.get('dosage_form')}"))
    route_raw = (row.get("route") or "").strip()
    route = map_route(route_raw) if route_raw else DEFAULT_ROUTE_BY_FORM.get(form or "", "oral")
    if route is None:
        errors.append(("route", f"طريق إعطاء غير معروف: {route_raw}"))
    clean["strength"] = normalize_strength(clean["strength"])
    for key, limit in FIELD_LIMITS.items():
        if len(clean[key]) > limit:
            errors.append((key, f"أطول من {limit} حرفاً."))
    clean["dosage_form"] = form or ""
    clean["default_route"] = route or "oral"
    clean["unit"] = clean["unit"] or DEFAULT_UNIT_BY_FORM.get(form or "", "")
    return clean, errors


# ---------------------------------------------------------------- planning


@dataclass
class Plan:
    total: int = 0
    creates: list[dict] = field(default_factory=list)
    updates: list[tuple[object, dict]] = field(default_factory=list)
    unchanged: int = 0
    duplicates: list[dict] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    preview: list[dict] = field(default_factory=list)


CATALOG_FIELDS = ("name", "brand_name", "active_ingredient", "strength", "dosage_form", "unit",
                  "default_route", "manufacturer", "country_of_registration",
                  "registration_number", "external_id")


def build_plan(rows: list[tuple[int, dict]], *, source_name: str, is_synthetic: bool) -> Plan:
    from .models import CatalogSource, Medication

    plan = Plan(total=len(rows))
    catalog = Medication.objects.filter(is_synthetic=is_synthetic, merged_into__isnull=True
                                        ).exclude(source=CatalogSource.PRACTITIONER)
    by_external = {m.external_id: m for m in catalog.filter(source_name=source_name)
                   .exclude(external_id="")}
    by_key: dict[str, object] = {}
    for med in catalog.only("id", "dedupe_key", "source_name", "name", *CATALOG_FIELDS):
        by_key.setdefault(med.dedupe_key, med)
    practitioner_keys = dict(Medication.objects.filter(
        source=CatalogSource.PRACTITIONER, review_status="pending",
    ).values_list("dedupe_key", "id"))
    seen_in_file: dict[str, int] = {}

    def note(line, action, clean, match=None, detail=""):
        if len(plan.preview) < MAX_PREVIEW_ROWS:
            plan.preview.append({"row": line, "action": action, "name": clean.get("name", ""),
                                 "strength": clean.get("strength", ""),
                                 "dosage_form": clean.get("dosage_form", ""),
                                 "manufacturer": clean.get("manufacturer", ""),
                                 "match_id": str(match.pk) if match is not None else None,
                                 "detail": detail})

    for line, row in rows:
        clean, errors = validate_row(row)
        if errors:
            for fld, message in errors:
                if len(plan.errors) < MAX_REPORTED_ERRORS:
                    plan.errors.append({"row": line, "field": fld, "message": message})
            note(line, "error", clean, detail="؛ ".join(m for _f, m in errors))
            continue
        key = dedupe_key(clean["name"], clean["strength"], clean["dosage_form"],
                         clean["manufacturer"])
        if key in seen_in_file:
            plan.duplicates.append({"row": line, "duplicate_of_row": seen_in_file[key]})
            note(line, "duplicate", clean, detail=f"مكرر للسطر {seen_in_file[key]} في الملف")
            continue
        seen_in_file[key] = line
        existing = by_external.get(clean["external_id"]) if clean["external_id"] else None
        if existing is None:
            candidate = by_key.get(key)
            if candidate is not None:
                if candidate.source_name == source_name:
                    existing = candidate
                else:
                    plan.duplicates.append({"row": line, "existing_id": str(candidate.pk)})
                    note(line, "duplicate", clean, candidate,
                         detail="موجود في الكتالوج من مصدر آخر")
                    continue
        if existing is not None:
            changes = {f: clean[f] for f in CATALOG_FIELDS if getattr(existing, f) != clean[f]}
            if changes:
                plan.updates.append((existing, changes))
                note(line, "update", clean, existing, detail="، ".join(sorted(changes)))
            else:
                plan.unchanged += 1
                note(line, "unchanged", clean, existing)
            continue
        plan.creates.append(clean)
        detail = ""
        if key in practitioner_keys:
            detail = "يطابق دواءً أضافه طبيب وينتظر المراجعة"
        note(line, "create", clean, detail=detail)
    return plan


# ---------------------------------------------------------------- service API


def _require_declaration(*, source_name: str, license_text: str, license_confirmed: bool):
    if not (source_name or "").strip():
        raise DomainError(_("حدد مصدر البيانات."), code="source_required")
    if len((license_text or "").strip()) < 10 or not license_confirmed:
        raise DomainError(_("لا يمكن الاستيراد دون توثيق ترخيص أو إذن إعادة استخدام البيانات "
                            "وتأكيده."), code="license_required")


def preview_import(*, uploaded_file, user, source_name: str, source_version: str = "",
                   source_date: date | None = None, source_url: str = "", license_text: str,
                   license_confirmed: bool, is_synthetic: bool = False):
    """Dry run: parse, validate and plan. Stores the file and the report, writes nothing to
    the catalog."""
    from .models import CatalogImport

    _require_declaration(source_name=source_name, license_text=license_text,
                         license_confirmed=license_confirmed)
    content = uploaded_file.read()
    filename = getattr(uploaded_file, "name", "catalog.csv") or "catalog.csv"
    rows, fmt = parse_file(content, filename)
    plan = build_plan(rows, source_name=source_name.strip(), is_synthetic=is_synthetic)
    uploaded_file.seek(0)
    imp = CatalogImport(
        original_filename=filename[:200], file_format=fmt,
        sha256=hashlib.sha256(content).hexdigest(), source_name=source_name.strip(),
        source_version=source_version.strip(), source_date=source_date,
        source_url=source_url.strip(), license_text=license_text.strip(),
        license_confirmed=license_confirmed, is_synthetic=is_synthetic, imported_by=user,
    )
    _apply_counts(imp, plan)
    imp.file.save(filename, uploaded_file, save=False)
    imp.save()
    return imp


def _apply_counts(imp, plan: Plan):
    imp.total_rows = plan.total
    imp.created_count = len(plan.creates)
    imp.updated_count = len(plan.updates)
    imp.unchanged_count = plan.unchanged
    imp.duplicate_count = len(plan.duplicates)
    imp.error_count = len({e["row"] for e in plan.errors})
    imp.error_report = plan.errors
    imp.preview = plan.preview


@transaction.atomic
def commit_import(imp, *, user):
    """Apply the import. The plan is rebuilt from the stored file so the catalog state at
    commit time is what counts."""
    from .models import CatalogImport, CatalogSource, ImportStatus, Medication

    imp = CatalogImport.objects.select_for_update().get(pk=imp.pk)
    if imp.status != ImportStatus.PREVIEWED:
        raise DomainError(_("هذا الاستيراد ليس في مرحلة المعاينة."), code="not_previewed",
                          status_code=409)
    with imp.file.open("rb") as fh:
        rows, _fmt = parse_file(fh.read(), imp.original_filename or imp.file.name)
    plan = build_plan(rows, source_name=imp.source_name, is_synthetic=imp.is_synthetic)
    now = timezone.now()
    provenance = {"source_name": imp.source_name, "source_version": imp.source_version,
                  "source_date": imp.source_date, "imported_at": now, "catalog_import": imp,
                  "is_synthetic": imp.is_synthetic,
                  "source": CatalogSource.SYNTHETIC_TEST if imp.is_synthetic
                  else CatalogSource.IMPORTED,
                  "source_reference": f"import:{imp.pk}"}
    for clean in plan.creates:
        Medication.objects.create(**clean, **provenance)
    for med, changes in plan.updates:
        for key, value in {**changes, **provenance}.items():
            setattr(med, key, value)
        med.save()
    _apply_counts(imp, plan)
    imp.status = ImportStatus.COMMITTED
    imp.committed_at = now
    imp.save()
    return imp


@transaction.atomic
def review_unknown_medication(*, medication, decision: str, user, target=None):
    """A medicine typed by a practitioner: keep it in the catalog, or merge it into an
    existing entry (favorites follow; prescriptions keep their own snapshot)."""
    from .models import CatalogSource, Medication, MedicationFavorite, ReviewStatus

    if medication.source != CatalogSource.PRACTITIONER:
        raise DomainError(_("المراجعة للأدوية التي أضافها الأطباء فقط."), code="not_unknown")
    if medication.review_status == ReviewStatus.MERGED:
        raise DomainError(_("دُمج هذا الدواء مسبقاً."), code="already_merged", status_code=409)
    now = timezone.now()
    if decision == "keep":
        medication.review_status = ReviewStatus.ACCEPTED
    elif decision == "merge":
        if target is None or target.pk == medication.pk or not target.is_active \
                or target.merged_into_id:
            raise DomainError(_("اختر صنفاً فعالاً من الكتالوج للدمج فيه."),
                              code="invalid_target")
        for fav in MedicationFavorite.objects.filter(medication=medication):
            if MedicationFavorite.objects.filter(practitioner_id=fav.practitioner_id,
                                                 medication=target).exists():
                MedicationFavorite.objects.filter(
                    practitioner_id=fav.practitioner_id, medication=target,
                ).update(use_count=F("use_count") + fav.use_count)
                fav.delete()
            else:
                fav.medication = target
                fav.save(update_fields=["medication", "updated_at"])
        medication.review_status = ReviewStatus.MERGED
        medication.merged_into = target
        medication.is_active = False
    else:
        raise DomainError(_("قرار غير معروف."), code="invalid_decision")
    medication.reviewed_by = user
    medication.reviewed_at = now
    medication.save()
    return Medication.objects.get(pk=medication.pk)
