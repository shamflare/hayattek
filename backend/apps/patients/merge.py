"""Duplicate patient files: detection, human-reviewed merge and exact undo (§8, ADR-027).

Rules:
- Never automatic. A receptionist or verified physician of a facility where BOTH files are
  actively registered decides, with documented evidence (at least one identity document).
- Every table with a foreign key to Patient is discovered programmatically, so models added
  later (by any app) are re-pointed too. Rows are moved, never copied or deleted.
- The source file is kept (status=merged, merged_into=target): its health number and cards
  keep resolving to the target; its identity is snapshotted in PatientMergeRecord.
- Undo moves exactly the recorded rows back. Rows created on the target after the merge stay
  there and are listed for manual review.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from django.apps import apps
from django.conf import settings
from django.db import IntegrityError, connection, models, transaction
from django.utils import timezone
from django.utils.translation import gettext as _

from apps.audit import services as audit
from apps.core.exceptions import DomainError
from apps.organizations.models import Role

from .models import (
    STRONG_MERGE_EVIDENCE,
    HealthCard,
    MergeCaseStatus,
    MergeEvidence,
    Patient,
    PatientMergeCase,
    PatientMergeRecord,
    PatientRegistration,
    PatientStatus,
)

ACTION_MERGE = "patient.merge"
ACTION_MERGE_REJECT = "patient.merge_reject"
ACTION_MERGE_REVERT = "patient.merge_revert"

# Foreign keys that must NOT follow the merge:
# - HealthCard: old cards stay on the source and resolve through merged_into (identifier
#   history is preserved; revoking stays possible).
# - Patient.merged_into and the merge bookkeeping itself.
EXCLUDED_FKS = {
    ("patients.healthcard", "patient"),
    ("patients.patient", "merged_into"),
    ("patients.patientmergecase", "source"),
    ("patients.patientmergecase", "target"),
    ("patients.patientmergerecord", "source"),
    ("patients.patientmergerecord", "target"),
}

SIMILAR_NAME_THRESHOLD = 0.6
SIMILAR_NAME_NO_BIRTH_YEAR_THRESHOLD = 0.85
MAX_SUSPECT_PAIRS = 200


# ---------------------------------------------------------------- discovery


def patient_foreign_keys() -> list[tuple[type[models.Model], models.Field]]:
    """Every concrete FK/OneToOne pointing at Patient, across all installed apps."""
    found = []
    for model in apps.get_models():
        if model._meta.proxy or not model._meta.managed:
            continue
        for field in model._meta.concrete_fields:
            if not field.is_relation or field.remote_field is None:
                continue
            if field.remote_field.model is not Patient:
                continue
            if (model._meta.label_lower, field.name) in EXCLUDED_FKS:
                continue
            found.append((model, field))
    return found


# ---------------------------------------------------------------- permissions


def can_review_duplicates(ctx) -> bool:
    """Receptionists and verified physicians. Org admins have no patient access (ADR-006)."""
    return ctx.has_role(Role.RECEPTIONIST) or ctx.is_clinician


def _require_reviewer(ctx):
    if not can_review_duplicates(ctx):
        raise DomainError(_("مراجعة الملفات المكررة متاحة لموظف الاستقبال أو الطبيب المعتمد."),
                          code="forbidden", status_code=403)


def _registered_here(ctx, patient_ids) -> set:
    return set(PatientRegistration.objects.filter(
        organization=ctx.organization, status="active", patient_id__in=patient_ids,
    ).values_list("patient_id", flat=True))


def get_pair(ctx, a_id, b_id, *, lock: bool = False) -> tuple[Patient, Patient]:
    """Both files must be active and registered at the acting facility; otherwise 404
    (never reveal files of other facilities — ADR-015)."""
    try:
        a_id, b_id = uuid.UUID(str(a_id)), uuid.UUID(str(b_id))
    except ValueError:
        raise DomainError(_("أحد الملفين غير موجود أو غير مسجل لدى منشأتك."), code="not_found",
                          status_code=404) from None
    if a_id == b_id:
        raise DomainError(_("اختر ملفين مختلفين."), code="same_patient")
    qs = Patient.objects.filter(pk__in=[a_id, b_id])
    if lock:
        qs = qs.select_for_update().order_by("pk")
    found = {p.pk: p for p in qs}
    a, b = found.get(a_id), found.get(b_id)
    if a is None or b is None or _registered_here(ctx, [a.pk, b.pk]) != {a.pk, b.pk}:
        raise DomainError(_("أحد الملفين غير موجود أو غير مسجل لدى منشأتك."), code="not_found",
                          status_code=404)
    if PatientStatus.MERGED in (a.status, b.status):
        raise DomainError(_("أحد الملفين مدمج مسبقاً."), code="already_merged", status_code=409)
    return a, b


# ---------------------------------------------------------------- detection


def suspected_duplicates(ctx) -> list[dict]:
    """Pairs of files registered at this facility that may be the same person.

    Matching never looks outside the facility (ADR-015). Pairs already judged
    "not the same person" here are hidden.
    """
    _require_reviewer(ctx)
    sql = """
        WITH own AS (
            SELECT p.id, p.name_search, p.phone, p.national_id, p.birth_date
            FROM patients_patient p
            JOIN patients_patientregistration r ON r.patient_id = p.id
            WHERE r.organization_id = %(org)s AND r.status = 'active' AND p.status <> 'merged'
        )
        SELECT a.id, b.id, similarity(a.name_search, b.name_search) AS sim,
               (a.national_id <> '' AND a.national_id = b.national_id) AS same_nid,
               (a.phone <> '' AND a.phone = b.phone) AS same_phone,
               (a.birth_date IS NOT NULL AND b.birth_date IS NOT NULL
                AND date_part('year', a.birth_date) = date_part('year', b.birth_date)) AS same_year,
               (a.birth_date IS NULL OR b.birth_date IS NULL) AS year_unknown
        FROM own a JOIN own b ON a.id < b.id
        WHERE (a.national_id <> '' AND a.national_id = b.national_id)
           OR (a.phone <> '' AND a.phone = b.phone)
           OR (a.name_search %% b.name_search
               AND similarity(a.name_search, b.name_search) >= %(sim)s)
        LIMIT %(limit)s
    """
    with connection.cursor() as cursor:
        cursor.execute(sql, {"org": ctx.organization.pk, "sim": SIMILAR_NAME_THRESHOLD,
                             "limit": MAX_SUSPECT_PAIRS * 3})
        rows = cursor.fetchall()

    rejected = {
        frozenset((str(s), str(t))) for s, t in PatientMergeCase.objects.filter(
            organization=ctx.organization, status=MergeCaseStatus.REJECTED,
        ).values_list("source_id", "target_id")
    }
    pairs = []
    for a_id, b_id, sim, same_nid, same_phone, same_year, year_unknown in rows:
        if frozenset((str(a_id), str(b_id))) in rejected:
            continue
        reasons = []
        if same_nid:
            reasons.append("same_national_id")
        if same_phone and same_year:
            reasons.append("same_phone_birth_year")
        if sim >= SIMILAR_NAME_THRESHOLD and same_year:
            reasons.append("similar_name_birth_year")
        elif sim >= SIMILAR_NAME_NO_BIRTH_YEAR_THRESHOLD and year_unknown:
            reasons.append("similar_name")
        if not reasons:
            continue  # e.g. siblings sharing a family phone with different birth years
        score = round(min(1.0, (0.5 if same_nid else 0) + (0.3 if same_phone and same_year else 0)
                          + float(sim) * 0.5), 2)
        pairs.append({"a": a_id, "b": b_id, "reasons": reasons, "name_similarity": round(sim, 2),
                      "score": score})
    pairs.sort(key=lambda p: -p["score"])
    pairs = pairs[:MAX_SUSPECT_PAIRS]
    patients = Patient.objects.in_bulk({p["a"] for p in pairs} | {p["b"] for p in pairs})
    for pair in pairs:
        pair["a"], pair["b"] = patients[pair["a"]], patients[pair["b"]]
        # Suggest the older file as the surviving one.
        if pair["b"].created_at < pair["a"].created_at:
            pair["a"], pair["b"] = pair["b"], pair["a"]
    return pairs


def match_reasons(a: Patient, b: Patient) -> list[str]:
    from django.contrib.postgres.search import TrigramSimilarity

    reasons = []
    if a.national_id and a.national_id == b.national_id:
        reasons.append("same_national_id")
    same_year = bool(a.birth_date and b.birth_date and a.birth_date.year == b.birth_date.year)
    if a.phone and a.phone == b.phone and same_year:
        reasons.append("same_phone_birth_year")
    sim = (Patient.objects.filter(pk=a.pk)
           .annotate(sim=TrigramSimilarity("name_search", b.name_search))
           .values_list("sim", flat=True).first()) or 0
    if sim >= SIMILAR_NAME_THRESHOLD and same_year:
        reasons.append("similar_name_birth_year")
    elif sim >= SIMILAR_NAME_NO_BIRTH_YEAR_THRESHOLD:
        reasons.append("similar_name")
    return reasons


# ---------------------------------------------------------------- compare


BLOCKER_LABELS = {
    "sex_differs": "الجنس مختلف",
    "national_id_differs": "الرقم الوطني مختلف",
    "both_have_accounts": "لكل ملف حساب تطبيق مستقل",
}


def identity_conflicts(a: Patient, b: Patient) -> list[str]:
    """Hard blockers: evidence that these are two different people."""
    blockers = []
    if "unknown" not in (a.sex, b.sex) and a.sex != b.sex:
        blockers.append("sex_differs")
    if a.national_id and b.national_id and a.national_id != b.national_id:
        blockers.append("national_id_differs")
    if a.user_id and b.user_id:
        blockers.append("both_have_accounts")
    return blockers


def identity_warnings(a: Patient, b: Patient) -> list[str]:
    warnings = []
    if a.birth_date and b.birth_date and a.birth_date != b.birth_date:
        warnings.append("birth_year_differs" if a.birth_date.year != b.birth_date.year
                        else "birth_date_differs")
    if a.phone and b.phone and a.phone != b.phone:
        warnings.append("phone_differs")
    if a.mother_name and b.mother_name and a.mother_name != b.mother_name:
        warnings.append("mother_name_differs")
    return warnings


def record_counts(ctx, patient: Patient) -> dict[str, int]:
    """Clinical record counts the acting clinician may see (policy engine)."""
    from apps.access import policy
    from apps.clinical.models import Allergy, Condition, Encounter
    from apps.diagnostics.models import ImagingReport, LabReport, ServiceRequest
    from apps.documents.models import ClinicalDocument
    from apps.medications.models import Prescription
    from apps.referrals.models import Referral

    access = policy.clinical_access(ctx, patient.pk)
    counts = {}
    for key, model in (("encounters", Encounter), ("conditions", Condition),
                       ("allergies", Allergy), ("prescriptions", Prescription),
                       ("service_requests", ServiceRequest), ("lab_reports", LabReport),
                       ("imaging_reports", ImagingReport), ("documents", ClinicalDocument),
                       ("referrals", Referral)):
        counts[key] = policy.visible_records(ctx, patient.pk, model, access).count()
    return counts


def administrative_facts(patient: Patient) -> dict:
    return {
        "facilities": PatientRegistration.objects.filter(patient=patient,
                                                         status="active").count(),
        "has_account": patient.user_id is not None,
        "guardians": patient.guardians.filter(revoked_at__isnull=True).count(),
        "active_cards": patient.cards.filter(status="active").count(),
    }


# ---------------------------------------------------------------- merge


def _snapshot(patient: Patient) -> dict:
    fields = ("health_number", "first_name", "father_name", "grandfather_name", "family_name",
              "mother_name", "full_name_en", "sex", "birth_date", "birth_date_precision", "phone",
              "national_id", "governorate", "city", "address", "status")
    data = {f: str(getattr(patient, f)) if getattr(patient, f) is not None else None
            for f in fields}
    data["user_id"] = str(patient.user_id) if patient.user_id else None
    data["cards"] = [{"id": str(c.pk), "status": c.status}
                     for c in HealthCard.objects.filter(patient=patient)]
    return data


def _move_rows(model, field, source: Patient, target: Patient) -> tuple[list, list]:
    """Re-point every row of `model.field` from source to target. Rows that would violate a
    unique constraint (target already has an equivalent row) stay on the source."""
    ids = list(model._base_manager.filter(**{field.name: source}).values_list("pk",
                                                                                 flat=True))
    if not ids:
        return [], []
    try:
        with transaction.atomic():
            model._base_manager.filter(pk__in=ids).update(**{field.name: target})
        return ids, []
    except IntegrityError:
        pass
    moved, kept = [], []
    for pk in ids:
        try:
            with transaction.atomic():
                model._base_manager.filter(pk=pk).update(**{field.name: target})
            moved.append(pk)
        except IntegrityError:
            kept.append(pk)
    return moved, kept


def _validate_evidence(evidence_checks: list[str], evidence_notes: str, reason: str):
    valid = {c.value for c in MergeEvidence}
    checks = [c for c in dict.fromkeys(evidence_checks or []) if c in valid]
    if not any(c in STRONG_MERGE_EVIDENCE for c in checks):
        raise DomainError(_("لا يمكن الدمج دون التحقق من وثيقة هوية (البطاقة الصحية، أو الهوية "
                            "الشخصية، أو دفتر العائلة)."), code="insufficient_evidence")
    if len((evidence_notes or "").strip()) < 10:
        raise DomainError(_("اكتب ما تحققت منه بالتفصيل (10 أحرف على الأقل)."),
                          code="evidence_notes_required")
    if len((reason or "").strip()) < 5:
        raise DomainError(_("اكتب سبب الدمج."), code="reason_required")
    return checks


@transaction.atomic
def merge_patients(*, ctx, source_id, target_id, evidence_checks: list[str],
                   evidence_notes: str, reason: str, request=None) -> PatientMergeCase:
    """Fold `source` into `target` in one transaction. Explicit, evidenced, reversible."""
    _require_reviewer(ctx)
    checks = _validate_evidence(evidence_checks, evidence_notes, reason)
    source, target = get_pair(ctx, source_id, target_id, lock=True)
    blockers = identity_conflicts(source, target)
    if blockers:
        raise DomainError(_("لا يمكن دمج الملفين: توجد بيانات هوية متعارضة (%(b)s). صحح البيانات "
                            "أولاً إن كانت خاطئة.") % {"b": "، ".join(BLOCKER_LABELS[b]
                                                                  for b in blockers)},
                          code="identity_conflict", status_code=409)

    now = timezone.now()
    case = PatientMergeCase.objects.create(
        organization=ctx.organization, source=source, target=target,
        reasons=match_reasons(source, target), status=MergeCaseStatus.MERGED,
        evidence_checks=checks, evidence_notes=evidence_notes.strip(),
        decision_reason=reason.strip(), reviewed_by=ctx.user, reviewer_role=ctx.primary_role,
        reviewed_at=now,
    )
    source_snapshot, target_snapshot = _snapshot(source), _snapshot(target)

    moved, kept = [], []
    for model, field in patient_foreign_keys():
        moved_ids, kept_ids = _move_rows(model, field, source, target)
        label = model._meta.label_lower
        if moved_ids:
            moved.append({"model": label, "field": field.name,
                          "ids": [str(pk) for pk in moved_ids]})
        if kept_ids:
            kept.append({"model": label, "field": field.name,
                         "ids": [str(pk) for pk in kept_ids]})

    moved_user_id = None
    if source.user_id and not target.user_id:
        moved_user_id = source.user_id
        Patient.objects.filter(pk=source.pk).update(user=None)
        Patient.objects.filter(pk=target.pk).update(user_id=moved_user_id, updated_at=now)

    source_status_before = source.status
    Patient.objects.filter(pk=source.pk).update(status=PatientStatus.MERGED, merged_into=target,
                                                user=None, updated_at=now)
    PatientMergeRecord.objects.create(
        case=case, source=source, target=target, moved=moved, kept_on_source=kept,
        moved_user_id=moved_user_id, source_status_before=source_status_before,
        source_snapshot=source_snapshot, target_snapshot=target_snapshot, merged_at=now,
    )
    summary = {"case_id": str(case.pk), "source_id": str(source.pk), "target_id": str(target.pk),
               "moved": {g["model"]: len(g["ids"]) for g in moved},
               "kept_on_source": {g["model"]: len(g["ids"]) for g in kept},
               "account_moved": bool(moved_user_id), "evidence": checks}
    for patient_id in (target.pk, source.pk):
        audit.record(ACTION_MERGE, request=request, ctx=ctx, target=case, patient_id=patient_id,
                     metadata=summary)
    return case


@transaction.atomic
def reject_pair(*, ctx, a_id, b_id, reason: str, request=None) -> PatientMergeCase:
    """Record that two similar files belong to different people (hidden from suggestions)."""
    _require_reviewer(ctx)
    if len((reason or "").strip()) < 5:
        raise DomainError(_("اكتب سبب القرار."), code="reason_required")
    a, b = get_pair(ctx, a_id, b_id)
    case = PatientMergeCase.objects.create(
        organization=ctx.organization, source=a, target=b, reasons=match_reasons(a, b),
        status=MergeCaseStatus.REJECTED, decision_reason=reason.strip(), reviewed_by=ctx.user,
        reviewer_role=ctx.primary_role, reviewed_at=timezone.now(),
    )
    audit.record(ACTION_MERGE_REJECT, request=request, ctx=ctx, target=case, patient_id=a.pk,
                 metadata={"other_patient_id": str(b.pk)})
    return case


# ---------------------------------------------------------------- undo


def undo_window() -> timedelta:
    return timedelta(days=settings.HAYAT.get("PATIENT_MERGE_UNDO_DAYS", 30))


def can_revert(ctx, case: PatientMergeCase) -> bool:
    return (case.status == MergeCaseStatus.MERGED and can_review_duplicates(ctx)
            and case.organization_id == ctx.organization.pk
            and case.reviewed_at is not None and timezone.now() - case.reviewed_at <= undo_window())


@transaction.atomic
def revert_merge(*, case: PatientMergeCase, reason: str, ctx=None, actor=None, request=None,
                 enforce_window: bool = True) -> PatientMergeCase:
    """Undo a mistaken merge using the PatientMergeRecord.

    Facility path (ctx): same facility, same roles, within the undo window.
    Platform path (management command, actor only): any time, for support cases.
    """
    case = PatientMergeCase.objects.select_for_update().get(pk=case.pk)
    if ctx is not None:
        _require_reviewer(ctx)
        if case.organization_id != ctx.organization.pk:
            raise DomainError(_("حالة الدمج غير موجودة."), code="not_found", status_code=404)
        if enforce_window and case.reviewed_at and timezone.now() - case.reviewed_at > undo_window():
            raise DomainError(_("انتهت مدة التراجع من المنشأة. تواصل مع إدارة المنصة."),
                              code="undo_window_expired", status_code=409)
    if case.status != MergeCaseStatus.MERGED:
        raise DomainError(_("لا يوجد دمج فعال للتراجع عنه."), code="not_merged", status_code=409)
    if len((reason or "").strip()) < 5:
        raise DomainError(_("اكتب سبب التراجع."), code="reason_required")

    record = PatientMergeRecord.objects.select_for_update().get(case=case)
    source = Patient.objects.select_for_update().get(pk=record.source_id)
    target = Patient.objects.select_for_update().get(pk=record.target_id)
    if source.status != PatientStatus.MERGED or source.merged_into_id != target.pk:
        raise DomainError(_("تغيرت حالة الملف المدمج منذ الدمج."), code="state_changed",
                          status_code=409)
    if target.status == PatientStatus.MERGED:
        raise DomainError(_("الملف الباقي دُمج لاحقاً في ملف آخر. تراجع عن الدمج اللاحق أولاً."),
                          code="target_merged_later", status_code=409)

    restored, missing, conflicts = {}, [], []
    moved_ids_by_model: dict[str, set] = {}
    for group in record.moved:
        model = apps.get_model(group["model"])
        field = group["field"]
        ids = group["ids"]
        moved_ids_by_model.setdefault(group["model"], set()).update(ids)
        still_on_target = set(str(pk) for pk in model._base_manager.filter(
            pk__in=ids, **{f"{field}_id": target.pk}).values_list("pk", flat=True))
        gone = [pk for pk in ids if pk not in still_on_target]
        if gone:
            missing.append({"model": group["model"], "field": field, "ids": gone})
        back = 0
        for pk in still_on_target:
            try:
                with transaction.atomic():
                    back += model._base_manager.filter(pk=pk).update(**{field: source})
            except IntegrityError:
                conflicts.append({"model": group["model"], "field": field, "id": pk})
        restored[group["model"]] = restored.get(group["model"], 0) + back

    account_restored = False
    if record.moved_user_id and target.user_id == record.moved_user_id and not source.user_id:
        Patient.objects.filter(pk=target.pk).update(user=None)
        Patient.objects.filter(pk=source.pk).update(user_id=record.moved_user_id)
        account_restored = True

    # Rows attached to the target after the merge: may belong to either person. Listed for
    # manual review by a clinician; never moved automatically.
    created_after = []
    for model, field in patient_foreign_keys():
        if not any(f.name == "created_at" for f in model._meta.concrete_fields):
            continue
        label = model._meta.label_lower
        ids = [str(pk) for pk in model._base_manager.filter(
            **{field.name: target}, created_at__gte=record.merged_at,
        ).values_list("pk", flat=True)]
        ids = [pk for pk in ids if pk not in moved_ids_by_model.get(label, set())]
        if ids:
            created_after.append({"model": label, "field": field.name, "ids": ids})

    now = timezone.now()
    Patient.objects.filter(pk=source.pk).update(status=record.source_status_before,
                                                merged_into=None, updated_at=now)
    PatientMergeRecord.objects.filter(pk=record.pk).update(reverted_at=now)
    actor = actor or (ctx.user if ctx else None)
    report = {"restored": restored, "missing": missing, "conflicts": conflicts,
              "created_after_merge": created_after, "account_restored": account_restored}
    case.status = MergeCaseStatus.REVERTED
    case.reverted_by = actor
    case.reverted_at = now
    case.revert_reason = reason.strip()
    case.revert_report = report
    case.save(update_fields=["status", "reverted_by", "reverted_at", "revert_reason",
                             "revert_report", "updated_at"])
    metadata = {"case_id": str(case.pk), "restored": restored,
                "created_after_merge": {g["model"]: len(g["ids"]) for g in created_after},
                "platform": ctx is None}
    for patient_id in (source.pk, target.pk):
        audit.record(ACTION_MERGE_REVERT, request=request, ctx=ctx, actor=actor, target=case,
                     patient_id=patient_id, metadata=metadata)
    return case
