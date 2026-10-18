from celery import shared_task

from .models import ClinicalDocument, ScanStatus


@shared_task(ignore_result=True)
def run_ocr(document_id: str) -> None:
    """OCR + suggested extraction (apps.documents.ocr_service). Skips non-clean files."""
    from .ocr_service import process_document

    process_document(document_id)


# ------------------------------------------------------------------ malware scan (quarantine)

SCAN_RETRY_DELAYS = (30, 60, 120, 300, 600, 1200, 1800, 3600)  # seconds, then the sweeper


@shared_task(ignore_result=True)
def scan_document_task(document_id: str, attempt: int = 0, run_ocr_after: bool = False) -> None:
    """Scan a pending document from storage; retried with backoff while clamd is down."""
    from .scanning import scan_document

    document = ClinicalDocument.objects.filter(pk=document_id).first()
    if document is None or document.scan_status != ScanStatus.PENDING:
        return
    status = scan_document(document)
    if status == ScanStatus.CLEAN and run_ocr_after:
        run_ocr.delay(str(document.pk))
    elif status == ScanStatus.PENDING and attempt + 1 < len(SCAN_RETRY_DELAYS):
        scan_document_task.apply_async((document_id, attempt + 1, run_ocr_after),
                                       countdown=SCAN_RETRY_DELAYS[attempt])


@shared_task(ignore_result=True)
def rescan_pending_documents(limit: int = 200) -> int:
    """Periodic sweeper (Celery beat): rescans everything still quarantined. Also usable by
    hand: ``manage.py scan_pending_documents``."""
    from .scanning import scan_document

    done = 0
    for document in ClinicalDocument.objects.filter(scan_status=ScanStatus.PENDING
                                                    ).order_by("created_at")[:limit]:
        if scan_document(document) == ScanStatus.PENDING:
            break  # scanner still unavailable: stop, the next run retries
        done += 1
    return done
