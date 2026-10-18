"""Synthetic test recordings (no real people, no real voices).

Each sample is a scripted Syrian-Arabic consultation. `build_wav` produces deterministic
PCM audio (tones) of the scripted length and embeds the sample id in a private RIFF chunk
("hyts"), which the mock speech-to-text provider uses to return the scripted transcript.
The scripts double as the evaluation set for extraction (docs/AI_PROVIDER_EVALUATION.md).
"""

from __future__ import annotations

import math
import struct

SAMPLE_RATE = 16000

# (speaker, start_second, end_second, text)
SAMPLES: dict[str, dict] = {
    "chest_pain_conversation": {
        "title": "حوار: ألم صدري (لهجة سورية)",
        "mode": "conversation",
        "segments": [
            ("doctor", 0, 4, "أهلين، تفضل. شو عم تشكي؟"),
            ("patient", 4, 14, "والله يا دكتور صرلي أسبوع عندي وجع بصدري، بيجيني لما امشي "
                               "وبيروح لما ارتاح"),
            ("doctor", 14, 18, "في عندك ضيق نفس أو تعرق؟"),
            ("patient", 18, 23, "شوي ضيق نفس، وما في تعرق"),
            ("doctor", 23, 26, "عم تاخد أدوية هلق؟"),
            ("patient", 26, 34, "عم آخد أملوديبين خمسة ملغ للضغط كل يوم الصبح، وكمان دوا "
                                "للمعدة ما بعرف اسمه"),
            ("doctor", 34, 37, "عندك حساسية من شي دوا؟"),
            ("patient", 37, 42, "ايه، عندي حساسية من البنسلين، بيطلعلي طفح"),
            ("doctor", 42, 48, "الضغط مية وخمسين على تسعين، والنبض ستة وتمانين"),
            ("doctor", 48, 55, "الفحص: الأصوات القلبية طبيعية، وما في وذمات بالرجلين"),
            ("doctor", 55, 61, "غالباً ذبحة صدرية مستقرة، بس لازم نتأكد"),
            ("doctor", 61, 68, "رح اكتبلك أسبرين مية ملغ حبة وحدة باليوم بعد الأكل"),
            ("doctor", 68, 76, "وبدي تعمل تحليل شحوم وسكر صيامي، وتخطيط قلب وإيكو قلب"),
            ("doctor", 76, 80, "وراجعني بعد أسبوع مع النتايج"),
        ],
        "expected": {
            "chief_complaint_contains": "وجع بصدري",
            "duration": "أسبوع",
            "allergies": ["البنسلين"],
            "current_medications": ["Amlodipine"],
            "unnamed_current_medication": True,
            "vitals": {"bp_systolic": 150, "bp_diastolic": 90, "heart_rate": 86},
            "diagnoses": [("ذبحة صدرية مستقرة", "suspected")],
            "prescribed": [("Aspirin", "100", "mg")],
            "labs": ["شحوم", "سكر صيامي"],
            "imaging": ["ecg", "echo"],
            "follow_up_contains": "أسبوع",
        },
    },
    "diabetes_dictation": {
        "title": "إملاء: مراجعة سكري (عربي وإنجليزي)",
        "mode": "dictation",
        "segments": [
            ("doctor", 0, 6, "مراجعة مريض سكري نوع تاني من سنتين"),
            ("doctor", 6, 11, "السكر الصيامي اليوم مية وستين، والضغط مية وتلاتين على تمانين"),
            ("doctor", 11, 16, "التشخيص: سكري نوع ثاني غير مضبوط"),
            ("doctor", 16, 24, "بزيد الـ Metformin لألف ملغ مرتين باليوم مع الأكل"),
            ("doctor", 24, 29, "تحليل خضاب سكري بعد تلات شهور"),
            ("doctor", 29, 32, "المراجعة بعد شهر"),
        ],
        "expected": {
            "vitals": {"glucose_mg_dl": 160, "bp_systolic": 130, "bp_diastolic": 80},
            "diagnoses": [("سكري نوع ثاني غير مضبوط", "confirmed")],
            "prescribed": [("Metformin", "1000", "mg")],
            "labs": ["خضاب سكري"],
            "imaging": [],
            "follow_up_contains": "شهر",
        },
    },
    "child_cough_no_dose": {
        "title": "حوار: سعال طفل (دواء دون جرعة)",
        "mode": "conversation",
        "segments": [
            ("patient", 0, 7, "ابني صرله تلات أيام عنده سعلة وحرارة"),
            ("doctor", 7, 11, "الحرارة هلق تمانية وتلاتين ونص"),
            ("doctor", 11, 17, "ممكن يكون التهاب قصبات"),
            ("doctor", 17, 22, "بعطيه Augmentin، والجرعة بحددها بعد ما نوزنه"),
            ("doctor", 22, 26, "وبدي صورة صدر"),
        ],
        "expected": {
            "duration": "تلات أيام",
            "vitals": {"temperature_c": 38.5},
            "diagnoses": [("التهاب قصبات", "suspected")],
            "prescribed": [("Augmentin", None, None)],
            "labs": [],
            "imaging": ["xray"],
        },
    },
}


def duration_of(sample_id: str) -> int:
    return SAMPLES[sample_id]["segments"][-1][2]


def build_wav(sample_id: str) -> bytes:
    """Deterministic synthetic PCM16 mono WAV with the sample id embedded."""
    seconds = duration_of(sample_id)
    frames = bytearray()
    total = seconds * SAMPLE_RATE
    for i in range(total):
        tone = 220 + 110 * ((i // SAMPLE_RATE) % 3)
        value = int(1200 * math.sin(2 * math.pi * tone * i / SAMPLE_RATE))
        frames += struct.pack("<h", value)
    marker = sample_id.encode()
    if len(marker) % 2:
        marker += b"\0"
    fmt = struct.pack("<HHIIHH", 1, 1, SAMPLE_RATE, SAMPLE_RATE * 2, 2, 16)
    chunks = (b"fmt " + struct.pack("<I", len(fmt)) + fmt
              + b"hyts" + struct.pack("<I", len(marker)) + marker
              + b"data" + struct.pack("<I", len(frames)) + bytes(frames))
    return b"RIFF" + struct.pack("<I", 4 + len(chunks)) + b"WAVE" + chunks


def sample_id_from_wav(data: bytes) -> str | None:
    pos = 12
    while pos + 8 <= len(data):
        chunk_id, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
        if chunk_id == b"hyts":
            sid = data[pos + 8:pos + 8 + size].rstrip(b"\0").decode("ascii", "ignore")
            return sid if sid in SAMPLES else None
        if chunk_id == b"data":
            return None
        pos += 8 + size + (size % 2)
    return None
