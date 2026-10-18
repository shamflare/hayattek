"""AI provider interfaces (PHASE2 §16). The rest of the system only talks to these classes,
so a managed cloud provider can replace the mock without touching views or UI.

Shipped implementations are LOCAL and synthetic:
  * MockSpeechToText          — returns the scripted transcript of synthetic samples; for any
                                other audio returns a clearly-labelled demo transcript.
  * RuleBasedClinicalExtractor — deterministic Arabic/English rules (apps.scribe.extraction).
A real provider (e.g. a managed speech + LLM API) must only be enabled after legal approval
(HAYAT_AI_REAL_PROVIDERS_APPROVED=true) — see docs/AI_PROVIDER_EVALUATION.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.utils.module_loading import import_string

from . import samples


class ProviderError(Exception):
    """The provider could not produce a result (outage, timeout, bad audio)."""

    def __init__(self, code: str, cost: Decimal = Decimal("0")):
        super().__init__(code)
        self.code = code
        self.cost = cost  # what the failed attempt still cost us, if anything


@dataclass
class Segment:
    id: str
    speaker: str  # doctor | patient | unknown
    speaker_confidence: float
    start: float
    end: float
    text: str


@dataclass
class TranscriptResult:
    language: str
    segments: list[Segment]
    provider: str
    is_mock: bool
    cost: Decimal = Decimal("0")
    cost_is_actual: bool = False
    diarization: bool = True


@dataclass
class ExtractionResult:
    fields: dict
    provider: str
    cost: Decimal = Decimal("0")
    cost_is_actual: bool = False
    warnings: list[str] = field(default_factory=list)


class SpeechToTextProvider:
    name = "base"
    is_real = False  # True => sends audio outside HayatTek; requires approval

    def transcribe(self, audio: bytes, *, mode: str, language_hint: str = "ar") -> TranscriptResult:
        raise NotImplementedError


class ClinicalExtractionProvider:
    name = "base"
    is_real = False

    def extract(self, transcript: TranscriptResult, *, mode: str, context: dict) -> ExtractionResult:
        raise NotImplementedError


# ------------------------------------------------------------------ mock implementations

GENERIC_DEMO = {
    "conversation": [
        ("unknown", 0, 6, "صرلي يومين عندي صداع بالجبهة"),
        ("unknown", 6, 10, "الضغط مية وعشرين على تمانين"),
        ("unknown", 10, 16, "غالباً صداع توتري"),
        ("unknown", 16, 22, "رح اكتبلك باراسيتامول خمسمية ملغ عند الحاجة"),
    ],
    "dictation": [
        ("doctor", 0, 5, "مريض بشكو من صداع منذ يومين"),
        ("doctor", 5, 9, "الضغط مية وعشرين على تمانين"),
        ("doctor", 9, 13, "التشخيص: صداع توتري"),
        ("doctor", 13, 19, "باراسيتامول خمسمية ملغ عند الحاجة"),
    ],
}

# Estimated public list prices (USD per audio minute) — estimates, never invoices.
MOCK_STT_COST_PER_MINUTE = Decimal("0.006")
MOCK_EXTRACTION_COST = Decimal("0.002")


class MockSpeechToText(SpeechToTextProvider):
    name = "mock-stt"
    fail_next: list[str] = []  # tests push error codes to simulate outages

    def transcribe(self, audio: bytes, *, mode: str, language_hint: str = "ar") -> TranscriptResult:
        if MockSpeechToText.fail_next:
            raise ProviderError(MockSpeechToText.fail_next.pop(0), cost=Decimal("0.001"))
        sample_id = samples.sample_id_from_wav(audio)
        if sample_id:
            script = samples.SAMPLES[sample_id]["segments"]
            diarization = True
        else:
            script = GENERIC_DEMO["dictation" if mode == "dictation" else "conversation"]
            diarization = mode == "dictation"
        segments = [Segment(id=f"s{i + 1}", speaker=spk,
                            speaker_confidence=0.95 if spk != "unknown" else 0.0,
                            start=float(a), end=float(b), text=text)
                    for i, (spk, a, b, text) in enumerate(script)]
        minutes = Decimal(segments[-1].end) / 60 if segments else Decimal(0)
        return TranscriptResult(language="ar-SY", segments=segments, provider=self.name,
                                is_mock=True, cost=(minutes * MOCK_STT_COST_PER_MINUTE),
                                cost_is_actual=False, diarization=diarization)


class RuleBasedClinicalExtractor(ClinicalExtractionProvider):
    name = "rules-v1"

    def extract(self, transcript: TranscriptResult, *, mode: str, context: dict) -> ExtractionResult:
        from .extraction import extract_fields

        fields, warnings = extract_fields(transcript.segments, mode=mode,
                                          catalog=context.get("catalog", {}),
                                          lab_tests=context.get("lab_tests", {}))
        return ExtractionResult(fields=fields, provider=self.name, cost=MOCK_EXTRACTION_COST,
                                warnings=warnings)


class ManagedCloudProviderPlaceholder(SpeechToTextProvider, ClinicalExtractionProvider):
    """Where a managed API adapter goes. Intentionally not implemented: choosing a vendor,
    verifying it may serve users in Syria, a data-processing agreement and the owner's
    approval come first (docs/AI_PROVIDER_EVALUATION.md)."""

    name = "managed-cloud"
    is_real = True

    def transcribe(self, audio, *, mode, language_hint="ar"):
        raise ProviderError("provider_not_configured")

    def extract(self, transcript, *, mode, context):
        raise ProviderError("provider_not_configured")


def _load(path: str):
    provider = import_string(path)()
    if provider.is_real and not settings.HAYAT.get("AI_REAL_PROVIDERS_APPROVED"):
        raise ImproperlyConfigured(
            "A real AI provider is configured but HAYAT_AI_REAL_PROVIDERS_APPROVED is not set.")
    return provider


def get_stt() -> SpeechToTextProvider:
    return _load(settings.HAYAT["AI_STT_PROVIDER"])


def get_extractor() -> ClinicalExtractionProvider:
    return _load(settings.HAYAT["AI_EXTRACTION_PROVIDER"])
