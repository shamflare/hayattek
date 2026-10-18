"""Run OCR on a stored document and keep the suggestion for human review."""

from __future__ import annotations

import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import ClinicalDocument, OcrResult, OcrStatus, ScanStatus
from .ocr import SUPPORTED_MIME, OcrError, get_ocr_provider
from .ocr_parsing import parse_lines

logger = logging.getLogger("hayat.ocr")


def is_ocr_supported(document: ClinicalDocument) -> bool:
    return document.mime_type in SUPPORTED_MIME


def process_document(document_id) -> OcrResult | None:
    """Synchronous OCR + parsing. Never touches the original file or clinical records."""
    document = ClinicalDocument.objects.filter(pk=document_id).first()
    if document is None or document.scan_status != ScanStatus.CLEAN or not document.file:
        return None  # quarantined or rejected files are never processed (SECURITY_MODEL §7)
    provider = get_ocr_provider()
    result, _ = OcrResult.objects.get_or_create(document=document,
                                                defaults={"provider": provider.name})
    if result.status == OcrStatus.REVIEWED:
        return result  # already converted by a reviewer: keep the reviewed state
    result.provider = provider.name
    result.error_code = ""
    try:
        if not is_ocr_supported(document):
            raise OcrError("unsupported_type")
        with document.file.open("rb") as fh:
            output = provider.extract(fh.read(), document.mime_type)
    except OcrError as exc:
        result.status, result.error_code = OcrStatus.FAILED, exc.code[:40]
    except Exception:
        logger.exception("ocr failed document=%s", document.pk)
        result.status, result.error_code = OcrStatus.FAILED, "engine_error"
    else:
        if not output.available:
            result.status = OcrStatus.UNAVAILABLE
            result.extracted = parse_lines([])  # empty, all fields flagged for manual entry
        else:
            extracted = output.extracted or parse_lines(output.lines)
            result.status = OcrStatus.DONE
            result.text = output.text
            result.lines = output.lines
            result.pages = output.pages
            result.mean_confidence = output.mean_confidence
            result.engine = output.engine or provider.name
            result.engine_version = output.engine_version
            result.extracted = extracted
            result.suggested_category = (output.suggested_category or extracted.get(
                "document_type", {}).get("suggested_category", ""))[:20]
    result.processed_at = timezone.now()
    result.save()
    return result


def schedule_ocr(document_id, *, user=None) -> OcrResult | None:
    """Mark the document as queued, then run inline (dev, HAYAT_OCR_INLINE) or via Celery."""
    from .tasks import run_ocr

    document = ClinicalDocument.objects.filter(pk=document_id).first()
    if document is None:
        return None
    result, created = OcrResult.objects.get_or_create(
        document=document, defaults={"provider": get_ocr_provider().name, "requested_by": user})
    if result.status == OcrStatus.REVIEWED:
        return result
    if not created:
        result.status = OcrStatus.QUEUED
        result.error_code = ""
        result.requested_by = user or result.requested_by
        result.save(update_fields=["status", "error_code", "requested_by", "updated_at"])
    if settings.HAYAT.get("OCR_INLINE"):
        return process_document(document.pk)
    transaction.on_commit(lambda: run_ocr.delay(str(document.pk)))
    return result
