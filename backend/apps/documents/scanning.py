"""Upload validation: size, real content type (magic bytes), checksum, and malware scanning.

Quarantine model (SECURITY_MODEL §7, ADR-023): every upload is stored with
``scan_status=pending`` and is unreadable (download, preview, OCR) until a scanner says
``clean``. Infected files are ``rejected`` and their bytes are deleted from storage. When the
scanner is down the file stays pending (fail-closed) and a Celery task retries later.
"""

import hashlib
import logging
import socket
import struct
from dataclasses import dataclass

from django.conf import settings
from django.dispatch import Signal
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


logger = logging.getLogger("hayat.scan")

# Sent after a pending document is marked clean (queryset update, so no post_save).
# Receivers: apps.dicom (push to the image store).
document_scanned_clean = Signal()


class ScannerUnavailable(Exception):
    """The scan engine could not give a verdict (down, timeout, protocol error)."""


@dataclass(frozen=True)
class ScanVerdict:
    clean: bool
    engine: str
    signature: str = ""  # malware name from the engine, never file content


class MalwareScanner:
    name = "base"

    def scan_stream(self, fileobj) -> ScanVerdict:
        """Scan a binary file object. Raise ScannerUnavailable if no verdict is possible."""
        raise NotImplementedError

    def scan(self, uploaded) -> bool:
        """Backwards-compatible boolean API: True if clean."""
        return self.scan_stream(uploaded).clean


class NoopMalwareScanner(MalwareScanner):
    """Development only. Production settings refuse it and use ClamAV (SECURITY_MODEL §7)."""

    name = "noop"

    def scan_stream(self, fileobj) -> ScanVerdict:
        return ScanVerdict(clean=True, engine=self.name)


class ClamAVScanner(MalwareScanner):
    """Minimal clamd client (INSTREAM over TCP, null-terminated "z" commands).

    Protocol: ``zINSTREAM\0`` then chunks of ``<uint32 big-endian length><bytes>``, a zero
    length terminates the stream; clamd answers ``stream: OK`` / ``stream: <name> FOUND`` /
    ``<reason> ERROR``. No third-party dependency.
    """

    name = "clamav"
    CHUNK_SIZE = 64 * 1024

    def __init__(self, host: str | None = None, port: int | None = None,
                 timeout: float | None = None):
        cfg = settings.HAYAT
        self.host = host or cfg.get("CLAMAV_HOST", "127.0.0.1")
        self.port = int(port or cfg.get("CLAMAV_PORT", 53310))
        self.timeout = float(timeout or cfg.get("CLAMAV_TIMEOUT", 30))

    def _connect(self) -> socket.socket:
        try:
            return socket.create_connection((self.host, self.port), timeout=self.timeout)
        except OSError as exc:
            raise ScannerUnavailable("clamd unreachable") from exc

    @staticmethod
    def _read_reply(sock: socket.socket, limit: int = 4096) -> str:
        data = b""
        while not data.endswith(b"\0") and len(data) < limit:
            chunk = sock.recv(1024)
            if not chunk:
                break
            data += chunk
        return data.rstrip(b"\0").decode("utf-8", "replace").strip()

    def ping(self) -> bool:
        try:
            with self._connect() as sock:
                sock.sendall(b"zPING\0")
                return self._read_reply(sock) == "PONG"
        except (OSError, ScannerUnavailable):
            return False

    def scan_stream(self, fileobj) -> ScanVerdict:
        fileobj.seek(0)
        try:
            with self._connect() as sock:
                sock.sendall(b"zINSTREAM\0")
                while chunk := fileobj.read(self.CHUNK_SIZE):
                    sock.sendall(struct.pack("!L", len(chunk)) + chunk)
                sock.sendall(struct.pack("!L", 0))
                reply = self._read_reply(sock)
        except OSError as exc:  # includes socket.timeout / connection reset
            raise ScannerUnavailable("clamd I/O error") from exc
        finally:
            fileobj.seek(0)
        if reply.endswith("FOUND"):
            signature = reply.removeprefix("stream:").removesuffix("FOUND").strip()
            return ScanVerdict(clean=False, engine=self.name, signature=signature[:200])
        if reply.endswith("OK"):
            return ScanVerdict(clean=True, engine=self.name)
        # e.g. "INSTREAM size limit exceeded. ERROR": no verdict -> stays quarantined.
        raise ScannerUnavailable("clamd error reply")


def get_scanner() -> MalwareScanner:
    return import_string(settings.HAYAT["MALWARE_SCANNER"])()


def scan_fail_mode() -> str:
    """``closed`` (default, mandatory in production) keeps files quarantined while the
    scanner is down; ``open`` releases them unscanned and is honoured only when DEBUG."""
    mode = settings.HAYAT.get("SCAN_FAIL_MODE", "closed")
    return "open" if mode == "open" and settings.DEBUG else "closed"


# ------------------------------------------------------------------ document quarantine


def run_scan(fileobj) -> ScanVerdict | None:
    """Scan a file object. Returns ``None`` when no verdict is possible and the fail mode is
    ``closed`` (the caller keeps the file quarantined)."""
    scanner = get_scanner()
    try:
        return scanner.scan_stream(fileobj)
    except ScannerUnavailable as exc:
        logger.warning("malware scanner unavailable engine=%s (%s)", scanner.name, exc)
        if scan_fail_mode() == "open":  # DEBUG only
            return ScanVerdict(clean=True, engine=f"{scanner.name}:skipped")
        return None


def apply_verdict(document, verdict: ScanVerdict, *, request=None, ctx=None) -> str:
    """Persist a verdict on a pending ``ClinicalDocument``; returns the new ``scan_status``."""
    from apps.audit import services as audit

    from .models import ClinicalDocument, ScanStatus

    if verdict.clean:
        updated = ClinicalDocument.objects.filter(
            pk=document.pk, scan_status=ScanStatus.PENDING).update(scan_status=ScanStatus.CLEAN)
        if updated:
            document.scan_status = ScanStatus.CLEAN
            document_scanned_clean.send(sender=ClinicalDocument, document=document)
            logger.info("document scan clean engine=%s document=%s", verdict.engine,
                        document.pk)
        return document.scan_status

    # Infected: drop the bytes (if any were stored), keep the record and the reason.
    if document.file:
        try:
            document.file.delete(save=False)
        except Exception:  # never leave it readable: the status below blocks every path
            logger.exception("could not delete rejected file document=%s", document.pk)
    ClinicalDocument.objects.filter(pk=document.pk).update(scan_status=ScanStatus.REJECTED,
                                                           file="")
    document.scan_status = ScanStatus.REJECTED
    audit.record(audit.Action.DOCUMENT_SCAN_REJECTED, request=request, ctx=ctx,
                 target=document, metadata={"engine": verdict.engine,
                                            "signature": verdict.signature,
                                            "mime": document.mime_type,
                                            "size": document.size_bytes})
    logger.warning("document rejected by malware scan engine=%s document=%s",
                   verdict.engine, document.pk)
    return ScanStatus.REJECTED


def scan_document(document, *, request=None, ctx=None) -> str:
    """Scan a stored, still-pending document (retry path). Never raises for outages."""
    from .models import ScanStatus

    if document.scan_status != ScanStatus.PENDING or not document.file:
        return document.scan_status
    with document.file.open("rb") as fh:
        verdict = run_scan(fh)
    if verdict is None:
        return ScanStatus.PENDING
    return apply_verdict(document, verdict, request=request, ctx=ctx)
