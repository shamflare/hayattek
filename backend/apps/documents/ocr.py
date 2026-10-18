"""OCR provider interface (§11, PHASE2 §4).

Results are suggestions for human review only; they never become clinical records
automatically. No patient data may be sent to an external provider without a legal
basis, consent and a processing agreement — the shipped providers are local only:

- `NullOcrProvider`           does nothing (status `unavailable`); the review screen still
                              works and the reviewer types the values by hand.
- `TesseractHttpOcrProvider`  private Tesseract sidecar (infra/ocr, docker compose `ocr`).
- `FakeOcrProvider`           deterministic, for tests.

Select with HAYAT_OCR_PROVIDER (dotted path). A managed cloud provider would implement the
same `extract()` and return lines with confidences; see docs/OCR_EVALUATION.md.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

from django.conf import settings
from django.utils.module_loading import import_string


class OcrError(Exception):
    """The engine could not read the file (unsupported, timeout, engine down)."""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


@dataclass
class OcrOutput:
    text: str = ""
    mean_confidence: float | None = None
    suggested_category: str = ""
    # Structured suggestion produced by apps.documents.ocr_parsing.parse_lines.
    extracted: dict = field(default_factory=dict)
    available: bool = True
    engine: str = ""
    engine_version: str = ""
    # [{"text", "confidence" (0..100), "page", "words": [{"text", "conf"}]}]
    lines: list = field(default_factory=list)
    pages: int = 0


class OcrProvider:
    name = "base"

    def extract(self, file_bytes: bytes, mime_type: str) -> OcrOutput:
        raise NotImplementedError


class NullOcrProvider(OcrProvider):
    name = "none"

    def extract(self, file_bytes: bytes, mime_type: str) -> OcrOutput:
        return OcrOutput(available=False)


SUPPORTED_MIME = {"application/pdf", "image/jpeg", "image/png", "image/tiff", "image/webp"}


class TesseractHttpOcrProvider(OcrProvider):
    """Talks to the private sidecar in infra/ocr (POST /ocr with the raw file bytes)."""

    name = "tesseract"

    def __init__(self, url: str | None = None, timeout: float | None = None,
                 lang: str | None = None, psm: str | None = None):
        conf = settings.HAYAT
        self.url = (url or conf.get("OCR_URL") or "http://127.0.0.1:58884").rstrip("/")
        self.timeout = timeout or conf.get("OCR_TIMEOUT", 120)
        self.lang = lang or conf.get("OCR_LANG", "ara+eng")
        self.psm = str(psm or conf.get("OCR_PSM", "4"))

    def extract(self, file_bytes: bytes, mime_type: str) -> OcrOutput:
        if mime_type not in SUPPORTED_MIME:
            raise OcrError("unsupported_type")
        request = urllib.request.Request(  # noqa: S310 - fixed http(s) URL from settings
            f"{self.url}/ocr?{urllib.parse.urlencode({'lang': self.lang, 'psm': self.psm})}",
            data=file_bytes, method="POST",
            headers={"Content-Type": mime_type})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:  # noqa: S310
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                code = json.loads(exc.read().decode("utf-8")).get("error", "engine_error")
            except (ValueError, OSError):
                code = "engine_error"
            raise OcrError(code) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise OcrError("engine_unreachable") from exc
        return OcrOutput(
            text=payload.get("text", ""), mean_confidence=payload.get("mean_confidence"),
            engine=f"tesseract-{payload.get('lang', self.lang)}-psm{payload.get('psm', self.psm)}",
            engine_version=str(payload.get("version", "")), lines=payload.get("lines", []),
            pages=int(payload.get("pages") or 0))


class FakeOcrProvider(OcrProvider):
    """Deterministic provider for tests: returns `FakeOcrProvider.lines` as engine output."""

    name = "fake"
    lines: list = [
        {"text": "مختبر الاختبار للتحاليل الطبية", "confidence": 95},
        {"text": "Date: 2026-03-12", "confidence": 93},
        {"text": "Hemoglobin 13.5 g/dL 12.0 - 16.0", "confidence": 94},
        {"text": "Glucose 1O5 mg/dL 70 - 110", "confidence": 61},
    ]

    def extract(self, file_bytes: bytes, mime_type: str) -> OcrOutput:
        lines = [dict(line) for line in self.lines]
        confs = [line["confidence"] for line in lines]
        return OcrOutput(text="\n".join(line["text"] for line in lines),
                         mean_confidence=sum(confs) / len(confs) if confs else None,
                         engine="fake", engine_version="1", lines=lines, pages=1)


def get_ocr_provider() -> OcrProvider:
    return import_string(settings.HAYAT["OCR_PROVIDER"])()
