"""Audio handling: strict WAV validation (duration is computed on the server, never trusted
from the client) and encryption at rest (Fernet / AES-128-CBC + HMAC-SHA256)."""

from __future__ import annotations

import base64
import hashlib
import struct
from dataclasses import dataclass

from cryptography.fernet import Fernet
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.utils.translation import gettext as _

from apps.core.exceptions import DomainError

MAX_UPLOAD_BYTES = 200 * 1024 * 1024


@dataclass(frozen=True)
class WavInfo:
    channels: int
    sample_rate: int
    bits_per_sample: int
    data_bytes: int

    @property
    def seconds(self) -> float:
        bytes_per_second = self.sample_rate * self.channels * self.bits_per_sample // 8
        return self.data_bytes / bytes_per_second if bytes_per_second else 0.0


def parse_wav(data: bytes) -> WavInfo:
    """Accept PCM WAV only (what the web/mobile recorders produce)."""
    invalid = DomainError(_("صيغة التسجيل غير مدعومة. المطلوب WAV PCM."), code="invalid_audio")
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise invalid
    pos, fmt, data_bytes = 12, None, None
    while pos + 8 <= len(data):
        chunk_id, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = pos + 8
        if chunk_id == b"fmt " and size >= 16:
            audio_format, channels, rate, _b, _a, bits = struct.unpack("<HHIIHH", data[body:body + 16])
            if audio_format not in (1, 0xFFFE):  # PCM / extensible PCM
                raise invalid
            fmt = (channels, rate, bits)
        elif chunk_id == b"data":
            # Streaming recorders sometimes write 0/0xFFFFFFFF; trust the real remaining bytes.
            data_bytes = min(size, len(data) - body) if size else len(data) - body
            break
        pos = body + size + (size % 2)
    if fmt is None or data_bytes is None:
        raise invalid
    channels, rate, bits = fmt
    if not (1 <= channels <= 2 and 8000 <= rate <= 96000 and bits in (8, 16, 24, 32)):
        raise invalid
    return WavInfo(channels, rate, bits, data_bytes)


def _fernet() -> Fernet:
    key = settings.HAYAT.get("AI_AUDIO_KEY")
    if not key:
        if not settings.DEBUG and not getattr(settings, "TESTING", False):
            raise ImproperlyConfigured("HAYAT_AI_AUDIO_KEY must be set outside development.")
        # Development/tests only: derive a stable key from SECRET_KEY.
        key = base64.urlsafe_b64encode(hashlib.sha256(
            ("hayat-audio:" + settings.SECRET_KEY).encode()).digest()).decode()
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt(data: bytes) -> bytes:
    return _fernet().encrypt(data)


def decrypt(token: bytes) -> bytes:
    return _fernet().decrypt(token)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
