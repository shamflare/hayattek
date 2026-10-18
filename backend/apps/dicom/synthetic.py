"""Synthetic DICOM generator for tests and demos. Never real images or real patients.

Produces a tiny CT-like series: N axial slices of 64x64 16-bit pixels showing a sphere whose
cross-section grows and shrinks across the slices, plus a bright square "bone" marker.
"""

from __future__ import annotations

import io
import math
import struct
import zipfile
from datetime import date

from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import PYDICOM_IMPLEMENTATION_UID, CTImageStorage, ExplicitVRLittleEndian, generate_uid

FAKE_PATIENT_NAME = "مريض تجريبي"
FAKE_PATIENT_ID = "SYNTHETIC-0001"


def _pixels(size: int, slice_index: int, slices: int) -> bytes:
    centre = (size - 1) / 2
    # Sphere radius at this slice (largest in the middle of the stack).
    z = (slice_index - (slices - 1) / 2) / max(1, slices / 2)
    radius = max(0.0, (size * 0.38) * math.sqrt(max(0.0, 1 - z * z)))
    values = []
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - centre, y - centre)
            hu = -1000  # air
            if d < size * 0.47:
                hu = 0  # "water" body outline
            if d < radius:
                hu = 60  # soft tissue sphere
            if size - 14 <= x < size - 6 and size - 14 <= y < size - 6:
                hu = 1200  # bone marker, bottom-right (orientation cue)
            values.append(hu + 1024)  # stored with RescaleIntercept -1024
    return struct.pack(f"<{len(values)}H", *values)


def make_series(slices: int = 10, size: int = 64, *, patient_name: str = FAKE_PATIENT_NAME,
                patient_id: str = FAKE_PATIENT_ID, description: str = "دراسة طبقي تجريبية",
                study_uid: str | None = None) -> list[bytes]:
    study_uid = study_uid or generate_uid()
    series_uid = generate_uid()
    frame_uid = generate_uid()
    today = date.today().strftime("%Y%m%d")
    files = []
    for i in range(slices):
        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = CTImageStorage
        meta.MediaStorageSOPInstanceUID = generate_uid()
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        meta.ImplementationClassUID = PYDICOM_IMPLEMENTATION_UID
        ds = FileDataset(None, {}, file_meta=meta, preamble=b"\0" * 128)
        ds.SpecificCharacterSet = "ISO_IR 192"  # UTF-8, for the Arabic fake name
        ds.SOPClassUID = CTImageStorage
        ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID = study_uid
        ds.SeriesInstanceUID = series_uid
        ds.FrameOfReferenceUID = frame_uid
        ds.PatientName = patient_name
        ds.PatientID = patient_id
        ds.PatientBirthDate = "19800101"
        ds.PatientSex = "O"
        ds.Modality = "CT"
        ds.StudyDate = ds.SeriesDate = ds.ContentDate = today
        ds.StudyTime = ds.SeriesTime = "120000"
        ds.StudyDescription = description
        ds.SeriesDescription = "محوري تجريبي"
        ds.SeriesNumber = 1
        ds.InstanceNumber = i + 1
        ds.Manufacturer = "HAYAT synthetic"
        ds.ImageType = ["DERIVED", "SECONDARY", "AXIAL"]
        ds.SliceThickness = 5
        ds.ImagePositionPatient = [0, 0, i * 5]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.PixelSpacing = [1, 1]
        ds.Rows = ds.Columns = size
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated = 16
        ds.BitsStored = 12
        ds.HighBit = 11
        ds.PixelRepresentation = 0
        ds.RescaleIntercept = -1024
        ds.RescaleSlope = 1
        ds.WindowCenter = 40
        ds.WindowWidth = 400
        ds.PixelData = _pixels(size, i, slices)
        out = io.BytesIO()
        ds.save_as(out, enforce_file_format=True)
        files.append(out.getvalue())
    return files


def make_zip(files: list[bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
        for i, payload in enumerate(files, start=1):
            archive.writestr(f"series1/slice{i:03d}.dcm", payload)
    return buf.getvalue()
