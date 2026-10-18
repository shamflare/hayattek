"""Reading DICOM payloads out of an uploaded file, and rewriting patient identity.

A document holds either one DICOM file (`application/dicom`) or a ZIP of one study
(`application/zip`, accepted only by the dicom upload endpoint). ZIP members are read in
memory one at a time and never extracted to disk, so path traversal ("zip slip") cannot write
anywhere; suspicious names are still rejected. Count, per-file size, total size and
compression ratio are bounded (zip bombs).
"""

from __future__ import annotations

import io
import posixpath
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass

import pydicom
from django.conf import settings
from django.utils.translation import gettext as _

from apps.core.exceptions import DomainError

from .models import DICOM_ZIP_MIME

MAX_RATIO = 200  # uncompressed / compressed, per member

# Identity-bearing attributes cleared in the image-store copy (ADR-030). PatientName/PatientID
# are replaced; these are emptied when present.
CLEARED_PATIENT_TAGS = (
    "PatientBirthDate", "PatientBirthTime", "OtherPatientIDs", "OtherPatientNames",
    "OtherPatientIDsSequence", "PatientAddress", "PatientTelephoneNumbers",
    "PatientMotherBirthName", "PatientBirthName", "MilitaryRank", "BranchOfService",
    "MedicalRecordLocator", "IssuerOfPatientID", "PatientComments", "ResponsiblePerson",
    "ReferringPhysicianName", "ReferringPhysicianTelephoneNumbers", "PatientInsurancePlanCodeSequence",
    "InsurancePlanIdentification", "CountryOfResidence", "RegionOfResidence",
)


def limits() -> dict:
    hayat = settings.HAYAT
    return {
        "zip_max_bytes": hayat.get("DICOM_ZIP_MAX_BYTES", 200 * 1024 * 1024),
        "max_files": hayat.get("DICOM_ZIP_MAX_FILES", 2000),
        "max_file_bytes": hayat.get("DICOM_MAX_FILE_BYTES", 64 * 1024 * 1024),
        "max_total_bytes": hayat.get("DICOM_ZIP_MAX_TOTAL_BYTES", 1024 * 1024 * 1024),
    }


def _bad(message: str, code: str = "invalid_dicom_archive") -> DomainError:
    return DomainError(message, code=code)


def _skip(name: str) -> bool:
    base = posixpath.basename(name)
    return (name.endswith("/") or name.startswith("__MACOSX/") or base.startswith(".")
            or base.upper() == "DICOMDIR")


def _check_name(name: str) -> None:
    normalized = posixpath.normpath(name.replace("\\", "/"))
    if (name.startswith(("/", "\\")) or normalized.startswith("..") or ":" in name
            or "\x00" in name):
        raise _bad(_("الأرشيف يحتوي مسارات غير آمنة."))


def _members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    lim = limits()
    members, total = [], 0
    for info in archive.infolist():
        _check_name(info.filename)
        if _skip(info.filename):
            continue
        if info.flag_bits & 0x1:
            raise _bad(_("الأرشيفات المشفرة غير مدعومة."))
        if info.file_size > lim["max_file_bytes"]:
            raise _bad(_("أحد ملفات الأرشيف أكبر من المسموح."))
        if info.compress_size and info.file_size / info.compress_size > MAX_RATIO \
                and info.file_size > 1024 * 1024:
            raise _bad(_("نسبة ضغط غير طبيعية في الأرشيف."))
        total += info.file_size
        members.append(info)
        if len(members) > lim["max_files"]:
            raise _bad(_("عدد الملفات في الأرشيف أكبر من المسموح (%(n)s).")
                       % {"n": lim["max_files"]})
        if total > lim["max_total_bytes"]:
            raise _bad(_("الحجم الكلي للأرشيف بعد فك الضغط أكبر من المسموح."))
    if not members:
        raise _bad(_("الأرشيف لا يحتوي ملفات DICOM."))
    return members


def _read_member(archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> bytes:
    # Do not trust the header's declared size: stop reading past the limit.
    cap = limits()["max_file_bytes"]
    with archive.open(info) as fh:
        data = fh.read(cap + 1)
    if len(data) > cap:
        raise _bad(_("أحد ملفات الأرشيف أكبر من المسموح."))
    return data


def is_zip(head: bytes) -> bool:
    return head[:4] == b"PK\x03\x04"


@dataclass
class ArchiveSummary:
    file_count: int
    study_instance_uid: str


def validate_zip(fileobj) -> ArchiveSummary:
    """Upload-time check: a well-formed ZIP of DICOM files that all belong to ONE study."""
    try:
        with zipfile.ZipFile(fileobj) as archive:
            members = _members(archive)
            study_uids = set()
            for info in members:
                with archive.open(info) as fh:
                    head = fh.read(132)
                if len(head) < 132 or head[128:132] != b"DICM":
                    raise _bad(_("كل ملفات الأرشيف يجب أن تكون DICOM."))
                ds = _parse(_read_member(archive, info), headers_only=True)
                study_uids.add(str(ds.get("StudyInstanceUID", "")))
    except zipfile.BadZipFile as exc:
        raise _bad(_("ملف ZIP تالف.")) from exc
    finally:
        fileobj.seek(0)
    if len(study_uids) != 1 or "" in study_uids:
        raise _bad(_("يجب أن يحتوي الأرشيف دراسة DICOM واحدة فقط."), code="multiple_studies")
    return ArchiveSummary(file_count=len(members), study_instance_uid=study_uids.pop())


def _parse(payload: bytes, *, headers_only: bool = False) -> pydicom.Dataset:
    try:
        return pydicom.dcmread(io.BytesIO(payload), stop_before_pixels=headers_only)
    except Exception as exc:  # pydicom raises many types for malformed input
        raise _bad(_("ملف DICOM غير صالح.")) from exc


def iter_payloads(fileobj, mime_type: str) -> Iterator[bytes]:
    """Yield raw DICOM files from a stored document (re-validated at push time)."""
    if mime_type == DICOM_ZIP_MIME:
        with zipfile.ZipFile(fileobj) as archive:
            for info in _members(archive):
                yield _read_member(archive, info)
        return
    cap = limits()["max_file_bytes"]
    data = fileobj.read(cap + 1)
    if len(data) > cap:
        raise _bad(_("ملف DICOM أكبر من المسموح."))
    yield data


def pseudonymize(payload: bytes, pseudonym: str) -> tuple[bytes, str]:
    """Replace the patient identity in a DICOM file with a HAYAT pseudonym.

    The image store never holds a second, unverified identity source: PatientName/PatientID
    from the file are not trusted and not kept (ADR-030). Returns (bytes, StudyInstanceUID).
    Burned-in pixel annotations are NOT removed (documented limitation).
    """
    ds = _parse(payload)
    ds.PatientName = "HAYAT^PSEUDONYMIZED"
    ds.PatientID = pseudonym
    for keyword in CLEARED_PATIENT_TAGS:
        if keyword in ds:
            delattr(ds, keyword)
    ds.remove_private_tags()
    out = io.BytesIO()
    ds.save_as(out, enforce_file_format=False)
    return out.getvalue(), str(ds.get("StudyInstanceUID", ""))
