"""Post-upload hook: DICOM documents are pushed to the image store once their file is clean.

A signal (not an edit of the documents upload view) keeps this independent of how scanning
works: a document saved as `pending` is pushed when a later save marks it `clean`.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.documents.models import ClinicalDocument
from apps.documents.scanning import document_scanned_clean

from .services import ensure_study, is_dicom_document


@receiver(post_save, sender=ClinicalDocument, dispatch_uid="dicom_document_saved")
def document_saved(sender, instance: ClinicalDocument, raw=False, **kwargs):
    if raw or not is_dicom_document(instance):
        return
    ensure_study(instance)


@receiver(document_scanned_clean, dispatch_uid="dicom_document_scanned_clean")
def document_scanned(sender, document: ClinicalDocument, **kwargs):
    if is_dicom_document(document):
        ensure_study(document)
