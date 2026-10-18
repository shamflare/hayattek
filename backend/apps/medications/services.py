from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone
from django.utils.translation import gettext as _

from apps.clinical import records
from apps.core.exceptions import DomainError
from apps.core.ids import random_code

from .models import Medication, MedicationFavorite, Prescription, PrescriptionItem


def _new_identifiers() -> dict:
    return {"number": f"RX-{timezone.now():%y%m}-{random_code(6)}",
            "verification_code": random_code(10)}


def _build_items(prescription: Prescription, items: list[dict]) -> None:
    rows = []
    for position, item in enumerate(items):
        item = dict(item)
        item.pop("id", None)
        item.pop("position", None)
        med: Medication | None = item.get("medication")
        if med is not None:
            # Snapshot catalog data: later catalog edits never alter this prescription.
            item.setdefault("medication_name", med.name)
            item["medication_name"] = item.get("medication_name") or med.name
            item["strength"] = item.get("strength") or med.strength
            item["dosage_form"] = item.get("dosage_form") or med.dosage_form
            item["route"] = item.get("route") or med.default_route
            item["dose_unit"] = item.get("dose_unit") or med.unit
        rows.append(PrescriptionItem(prescription=prescription, position=position, **item))
    PrescriptionItem.objects.bulk_create(rows)


@transaction.atomic
def create_prescription(ctx, *, patient, data: dict, request=None) -> Prescription:
    items = data.pop("items")
    encounter = data.get("encounter")
    if encounter is not None and (encounter.patient_id != patient.pk
                                  or encounter.organization_id != ctx.organization.pk):
        raise DomainError(_("الزيارة لا تخص هذا المريض."), code="invalid_encounter")
    for _attempt in range(5):
        try:
            with transaction.atomic():
                prescription = records.create(ctx, Prescription, patient=patient,
                                              data={**data, **_new_identifiers()},
                                              request=request)
            break
        except IntegrityError:
            continue
    else:
        raise DomainError(_("تعذر إنشاء رقم الوصفة."), code="number_collision")
    _build_items(prescription, items)
    _bump_favorites(ctx, items)
    return prescription


@transaction.atomic
def update_draft_prescription(ctx, prescription: Prescription, data: dict, request=None):
    items = data.pop("items", None)
    data.pop("encounter", None)
    records.update_draft(ctx, prescription, data, request=request)
    if items is not None:
        prescription.items.all().delete()
        _build_items(prescription, items)
    return prescription


@transaction.atomic
def amend_prescription(ctx, prescription: Prescription, data: dict, reason: str, request=None):
    from .serializers import PrescriptionItemSerializer

    items = data.pop("items", None)
    data.pop("encounter", None)
    old_items = PrescriptionItemSerializer(prescription.items.all(), many=True).data
    prescription = records.amend(ctx, prescription, data, reason, request=request,
                                 children={"items": old_items})
    if items is not None:
        prescription.items.all().delete()
        _build_items(prescription, items)
    return prescription


def _bump_favorites(ctx, items) -> None:
    practitioner = ctx.practitioner
    med_ids = [i["medication"].pk for i in items if i.get("medication") is not None]
    if practitioner and med_ids:
        MedicationFavorite.objects.filter(practitioner=practitioner, medication_id__in=med_ids
                                          ).update(use_count=F("use_count") + 1)
