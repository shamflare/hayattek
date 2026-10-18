"""OCR provider interface (§11).

Results are suggestions for human review only; they never become clinical records
automatically. No patient data may be sent to an external provider without a legal
basis, consent and a processing agreement — so the default provider does nothing.
"""

from dataclasses import dataclass, field

from django.conf import settings
from django.utils.module_loading import import_string


@dataclass
class OcrOutput:
    text: str = ""
    mean_confidence: float | None = None
    suggested_category: str = ""
    # {"date": ..., "issuer": ..., "observations": [{"name","value","unit","range","confidence"}]}
    extracted: dict = field(default_factory=dict)
    available: bool = True


class OcrProvider:
    name = "base"

    def extract(self, file_bytes: bytes, mime_type: str) -> OcrOutput:
        raise NotImplementedError


class NullOcrProvider(OcrProvider):
    name = "none"

    def extract(self, file_bytes: bytes, mime_type: str) -> OcrOutput:
        return OcrOutput(available=False)


def get_ocr_provider() -> OcrProvider:
    return import_string(settings.HAYAT["OCR_PROVIDER"])()
