"""Upload validation: size, real content type (magic bytes), checksum, malware scan hook."""

import hashlib

from django.conf import settings
from django.utils.module_loading import import_string
from django.utils.translation import gettext as _

from apps.core.exceptions import DomainError

ALLOWED_TYPES = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/tiff": "tiff",
    "image/heic": "heic",
    "application/dicom": "dcm",
}

INLINE_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}


def sniff_mime(head: bytes) -> str | None:
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:4] in (b"II*\x00", b"MM\x00*"):
        return "image/tiff"
    if head[4:8] == b"ftyp" and head[8:12] in (b"heic", b"heix", b"mif1", b"hevc", b"heim"):
        return "image/heic"
    if len(head) >= 132 and head[128:132] == b"DICM":
        return "application/dicom"
    return None


def inspect_upload(uploaded) -> dict:
    max_bytes = settings.HAYAT["UPLOAD_MAX_BYTES"]
    if uploaded.size > max_bytes:
        raise DomainError(_("حجم الملف أكبر من المسموح (%(mb)s ميغابايت).")
                          % {"mb": max_bytes // (1024 * 1024)}, code="file_too_large")
    if uploaded.size == 0:
        raise DomainError(_("الملف فارغ."), code="empty_file")
    uploaded.seek(0)
    head = uploaded.read(512)
    mime = sniff_mime(head)
    if mime is None:
        raise DomainError(_("نوع الملف غير مدعوم. المسموح: PDF أو صورة أو DICOM."),
                          code="unsupported_type")
    digest = hashlib.sha256()
    uploaded.seek(0)
    for chunk in uploaded.chunks():
        digest.update(chunk)
    uploaded.seek(0)
    return {"mime_type": mime, "size_bytes": uploaded.size, "sha256": digest.hexdigest()}


class MalwareScanner:
    def scan(self, uploaded) -> bool:
        """Return True if clean."""
        raise NotImplementedError


class NoopMalwareScanner(MalwareScanner):
    """Development only. Production must configure ClamAV (see SECURITY_MODEL §7)."""

    def scan(self, uploaded) -> bool:
        return True


def get_scanner() -> MalwareScanner:
    return import_string(settings.HAYAT["MALWARE_SCANNER"])()
