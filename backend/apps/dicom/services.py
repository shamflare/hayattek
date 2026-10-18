"""Ingest of DICOM documents into the private image store."""

from __future__ import annotations

import logging
from datetime import date

from django.db import transaction
from django.utils import timezone

from apps.core.exceptions import DomainError
from apps.documents.models import ClinicalDocument, ScanStatus

from . import archive
from .models import DICOM_MIMES, DicomInstance, DicomSeries, DicomStudy, StudyStatus
from .orthanc import OrthancError, get_client

logger = logging.getLogger(__name__)


def is_dicom_document(document: ClinicalDocument) -> bool:
    return document.mime_type in DICOM_MIMES


def ensure_study(document: ClinicalDocument) -> DicomStudy | None:
    """Create the study row for a DICOM document and queue the push once its file is clean."""
    if not is_dicom_document(document):
        return None
    study, _created = DicomStudy.objects.get_or_create(document=document)
    if document.scan_status == ScanStatus.CLEAN and study.status == StudyStatus.PENDING:
        dispatch_push(study.pk)
    return study


def dispatch_push(study_id) -> None:
    from .tasks import push_study

    def enqueue():
        try:
            push_study.delay(str(study_id))
        except Exception:  # broker down: `manage.py dicom_sync` / the viewer's lazy ingest retry
            logger.exception("could not enqueue dicom push", extra={"study": str(study_id)})

    transaction.on_commit(enqueue)


def _parse_date(value: str) -> date | None:
    try:
        return date(int(value[:4]), int(value[4:6]), int(value[6:8])) if len(value) >= 8 else None
    except ValueError:
        return None


def _int(value) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def push_study_now(study_id) -> DicomStudy | None:
    """Push the document's DICOM file(s) to Orthanc and index the result. Idempotent."""
    with transaction.atomic():
        study = (DicomStudy.objects.select_for_update().select_related("document")
                 .filter(pk=study_id).first())
        if study is None or study.status == StudyStatus.STORED:
            return study
        document = study.document
        if document.scan_status != ScanStatus.CLEAN:
            return study  # pushed later, when the scan marks the file clean
        study.attempts += 1
        study.pseudonym = study.pseudonym or f"HAYAT-{document.pk.hex}"
        try:
            with transaction.atomic():  # savepoint: no half-indexed series on failure
                _push(study, document)
        except (OrthancError, DomainError) as exc:
            study.status = StudyStatus.FAILED
            code = exc.code if isinstance(exc, OrthancError) else exc.get_codes()
            study.error_code = str(code)[:40]
            logger.warning("dicom push failed", extra={"study": str(study.pk),
                                                       "code": study.error_code})
        except Exception:
            study.status = StudyStatus.FAILED
            study.error_code = "unexpected_error"
            logger.exception("dicom push crashed", extra={"study": str(study.pk)})
        study.save()
        return study


def _push(study: DicomStudy, document: ClinicalDocument) -> None:
    client = get_client()
    orthanc_studies: set[str] = set()
    with document.file.open("rb") as fh:
        for payload in archive.iter_payloads(fh, document.mime_type):
            data, _uid = archive.pseudonymize(payload, study.pseudonym)
            stored = client.store_instance(data)
            orthanc_studies.add(stored["ParentStudy"])
    if len(orthanc_studies) != 1:
        raise DomainError("multiple_studies", code="multiple_studies")
    orthanc_study_id = orthanc_studies.pop()
    info = client.study(orthanc_study_id)
    tags = info.get("MainDicomTags", {})

    study.series.all().delete()
    modalities, total = [], 0
    for series_id in info.get("Series", []):
        series_info, instances = client.series_with_instances(series_id)
        stags = series_info.get("MainDicomTags", {})
        series = DicomSeries.objects.create(
            study=study, orthanc_id=series_id,
            series_instance_uid=stags.get("SeriesInstanceUID", "")[:64],
            modality=stags.get("Modality", "")[:16], number=_int(stags.get("SeriesNumber")),
            description=stags.get("SeriesDescription", "")[:200], instance_count=len(instances))
        if series.modality and series.modality not in modalities:
            modalities.append(series.modality)
        DicomInstance.objects.bulk_create([
            DicomInstance(series=series, orthanc_id=i["ID"],
                          instance_number=_int(i.get("MainDicomTags", {}).get("InstanceNumber")),
                          frames=max(1, _int(i.get("MainDicomTags", {}).get("NumberOfFrames"))
                                     or 1))
            for i in instances
        ], batch_size=500)
        total += len(instances)

    study.orthanc_study_id = orthanc_study_id
    study.study_instance_uid = tags.get("StudyInstanceUID", "")[:64]
    study.study_date = _parse_date(tags.get("StudyDate", ""))
    study.study_description = tags.get("StudyDescription", "")[:200]
    study.modalities = ",".join(modalities)[:60]
    study.series_count = len(info.get("Series", []))
    study.instance_count = total
    study.status = StudyStatus.STORED
    study.error_code = ""
    study.stored_at = timezone.now()


def sync_pending(*, include_failed: bool = False) -> int:
    """Create missing study rows and push everything still pending (management command)."""
    missing = ClinicalDocument.objects.filter(mime_type__in=DICOM_MIMES, dicom_study__isnull=True)
    for document in missing.iterator():
        DicomStudy.objects.get_or_create(document=document)
    statuses = [StudyStatus.PENDING] + ([StudyStatus.FAILED] if include_failed else [])
    count = 0
    for study_id in DicomStudy.objects.filter(status__in=statuses,
                                              document__scan_status=ScanStatus.CLEAN
                                              ).values_list("pk", flat=True):
        if include_failed:
            DicomStudy.objects.filter(pk=study_id, status=StudyStatus.FAILED).update(
                status=StudyStatus.PENDING)
        push_study_now(study_id)
        count += 1
    return count
