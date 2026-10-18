from celery import shared_task

from .models import ClinicalDocument, OcrResult, OcrStatus
from .ocr import get_ocr_provider


@shared_task(ignore_result=True)
def run_ocr(document_id: str) -> None:
    document = ClinicalDocument.objects.filter(pk=document_id).first()
    if document is None:
        return
    provider = get_ocr_provider()
    result, _ = OcrResult.objects.get_or_create(document=document,
                                                defaults={"provider": provider.name})
    try:
        with document.file.open("rb") as fh:
            output = provider.extract(fh.read(), document.mime_type)
    except Exception:
        result.status = OcrStatus.FAILED
        result.save(update_fields=["status", "updated_at"])
        return
    if not output.available:
        result.status = OcrStatus.UNAVAILABLE
    else:
        result.status = OcrStatus.DONE
        result.text = output.text
        result.mean_confidence = output.mean_confidence
        result.suggested_category = output.suggested_category
        result.extracted = output.extracted
    result.provider = provider.name
    result.save()
