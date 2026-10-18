"""Rule-based clinical extraction for Syrian Arabic consultations (local, deterministic).

Principles (PHASE2 §14):
  * Extract only what was said. Missing dose → empty + needs_review, never a default.
  * Diagnoses only from the doctor's (or an unidentified) speaker, never from the patient;
    uncertain wording ("غالباً", "ممكن", "احتمال") → certainty "suspected".
  * Unidentified speaker or unknown drug → needs_review with a reason.
  * Every field keeps the ids of the transcript segments it came from.
"""

from __future__ import annotations

import re

from apps.clinical.serializers import VITAL_LIMITS

# ------------------------------------------------------------------ text normalisation

_LETTERS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ة": "ه", "ى": "ي", "ؤ": "و",
                          "ئ": "ي"})
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_DIACRITICS = re.compile(r"[ً-ٰٟـ]")


def norm(text: str) -> str:
    """Letter-level normalisation (keeps word boundaries; used for matching)."""
    return _DIACRITICS.sub("", text).translate(_LETTERS).translate(_DIGITS).lower()


UNITS = {"واحد": 1, "وحده": 1, "اتنين": 2, "اثنين": 2, "تنين": 2, "ثنين": 2, "تلاته": 3,
         "ثلاثه": 3, "تلات": 3, "ثلاث": 3, "اربعه": 4, "اربع": 4, "خمسه": 5, "خمس": 5, "سته": 6,
         "ست": 6, "سبعه": 7, "سبع": 7, "تمانيه": 8, "ثمانيه": 8, "تمان": 8, "ثمان": 8,
         "تسعه": 9, "تسع": 9, "عشره": 10, "عشر": 10, "احدعش": 11, "اتنعش": 12, "تلطعش": 13,
         "اربعطعش": 14, "خمسطعش": 15, "ستطعش": 16, "سبعطعش": 17, "تمنطعش": 18, "تسعطعش": 19}
TENS = {"عشرين": 20, "تلاتين": 30, "ثلاثين": 30, "اربعين": 40, "خمسين": 50, "ستين": 60,
        "سبعين": 70, "تمانين": 80, "ثمانين": 80, "تسعين": 90}
HUNDREDS = {"ميه": 100, "مئه": 100, "مايه": 100, "مائه": 100, "ميتين": 200, "مئتين": 200,
            "تلتميه": 300, "ثلاثمئه": 300, "اربعميه": 400, "اربعمئه": 400, "خمسميه": 500,
            "خمسمئه": 500, "ستميه": 600, "سبعميه": 700, "تمنميه": 800, "ثمانمئه": 800,
            "تسعميه": 900}
THOUSANDS = {"الف": 1000, "الفين": 2000}
NUMBER_WORDS = {**UNITS, **TENS, **HUNDREDS, **THOUSANDS}


def _num_value(token: str) -> int | None:
    return NUMBER_WORDS.get(token)


def _split_number(token: str) -> tuple[str, int | None]:
    """Return (prefix, value) for tokens like 'وخمسين', 'لالف', 'بالمية'."""
    value = _num_value(token)
    if value is not None:
        return "", value
    for prefix in ("ول", "بال", "و", "ل", "ب"):
        if token.startswith(prefix):
            value = _num_value(token[len(prefix):])
            if value is not None:
                return prefix, value
    return "", None


def numerify(text: str) -> str:
    """'مية وخمسين على تسعين' → '150 على 90'; 'تمانية وتلاتين ونص' → '38.5';
    'لالف ملغ' → 'ل 1000 ملغ'."""
    tokens = re.sub(r"([،,:؛!?])", r"  ", norm(text)).split()
    out: list[str] = []
    i = 0
    while i < len(tokens):
        prefix, value = _split_number(tokens[i])
        if value is None:
            out.append(tokens[i])
            i += 1
            continue
        total: float = value
        j = i + 1
        while j < len(tokens):
            if tokens[j] == "ونص":
                total += 0.5
                j += 1
                break
            nxt_prefix, nxt = _split_number(tokens[j])
            if nxt is not None and nxt_prefix == "و":
                total += nxt
                j += 1
                continue
            break
        if prefix:
            out.append(prefix)
        out.append(str(int(total)) if float(total).is_integer() else str(total))
        i = j
    return " ".join(out)


# ------------------------------------------------------------------ vocabularies

# Names only (no clinical facts). Arabic transliteration → canonical display name.
KNOWN_DRUG_NAMES = {
    "اسبرين": "Aspirin", "اسبيرين": "Aspirin", "aspirin": "Aspirin",
    "املوديبين": "Amlodipine", "amlodipine": "Amlodipine",
    "ميتفورمين": "Metformin", "metformin": "Metformin",
    "اوغمنتين": "Augmentin", "augmentin": "Augmentin",
    "باراسيتامول": "Paracetamol", "paracetamol": "Paracetamol", "بنادول": "Panadol",
    "ايبوبروفين": "Ibuprofen", "ibuprofen": "Ibuprofen", "بروفين": "Brufen",
    "اموكسيسيلين": "Amoxicillin", "amoxicillin": "Amoxicillin",
    "اوميبرازول": "Omeprazole", "omeprazole": "Omeprazole",
}
UNIT_WORDS = {"ملغ": "mg", "مغ": "mg", "ملغرام": "mg", "mg": "mg", "غرام": "g", "غ": "g",
              "g": "g", "مل": "ml", "ml": "ml", "ميكروغرام": "mcg", "mcg": "mcg"}
PRESCRIBE_TRIGGERS = ("رح اكتبلك", "بكتبلك", "اكتبلك", "بوصفلك", "رح اوصفلك", "بعطيك", "بعطيه",
                      "بعطيها", "بزيد", "بنقص", "خود", "خدي", "خذ", "ابدا ب", "منبلش ب")
CURRENT_MED_TRIGGERS = ("عم اخد", "عم اخذ", "باخد", "باخذ", "بستعمل", "عم استعمل", "بياخد",
                        "عم ياخد", "يتناول")
UNCERTAIN = ("غالبا", "ممكن", "احتمال", "اشتباه", "يشتبه", "يمكن", "على الاغلب")
SYMPTOMS = ("وجع", "الم", "صداع", "سعله", "سعال", "حراره", "ضيق نفس", "تعرق", "غثيان", "اقياء",
            "اسهال", "دوخه", "طفح", "حكه", "خفقان", "تعب")
NEGATIONS = ("ما في", "ما عندي", "بدون", "لا يوجد", "ما بيشكي من", "نفى")
IMAGING = [("تخطيط قلب", "ecg"), ("ايكو قلب", "echo"), ("ايكو للقلب", "echo"),
           ("صوره صدر", "xray"), ("صوره شعاعيه", "xray"), ("اشعه", "xray"),
           ("طبقي", "ct"), ("رنين", "mri"), ("ايكو", "ultrasound")]
TIMES = {"الصبح": "morning", "صباحا": "morning", "الظهر": "noon", "المسا": "evening",
         "مساء": "evening", "قبل النوم": "bedtime"}
MEALS = {"بعد الاكل": "after", "قبل الاكل": "before", "مع الاكل": "with"}


def _field(value, sources, *, confidence=0.9, needs_review=False, reason="", speaker=None):
    return {"value": value, "sources": sources, "confidence": confidence,
            "needs_review": needs_review, "review_reason": reason, "speaker": speaker}


def _speaker_ok_for_assessment(seg) -> tuple[bool, str]:
    if seg.speaker == "doctor":
        return True, ""
    if seg.speaker == "unknown":
        return True, "هوية المتحدث غير مؤكدة"
    return False, ""


# ------------------------------------------------------------------ medications


def _find_drug(text_norm: str, catalog: dict) -> tuple[str | None, bool]:
    """Return (display name, known) for the first drug mentioned."""
    words = re.findall(r"[\w؀-ۿ]+", text_norm)
    for w in words:
        w2 = w[2:] if w.startswith("ال") and len(w) > 4 else w
        for candidate in (w, w2):
            if candidate in catalog:
                return catalog[candidate], True
            if candidate in KNOWN_DRUG_NAMES:
                return KNOWN_DRUG_NAMES[candidate], True
    return None, False


def _dose(numeric: str):
    m = re.search(r"(\d+(?:\.\d+)?)\s*(ملغ|مغ|ملغرام|mg|غرام|g|مل|ml|ميكروغرام|mcg)\b", numeric)
    if m:
        return m.group(1), UNIT_WORDS.get(m.group(2), m.group(2))
    return None, None


def _schedule(numeric: str) -> dict:
    out: dict = {}
    if "عند الحاجه" in numeric:
        out["schedule_type"] = "as_needed"
    m = re.search(r"(\d+)\s*مرات?\s*(?:ب|في)?اليوم", numeric)
    if "مرتين" in numeric:
        out.update(schedule_type="times_per_day", times_per_day=2)
    elif m:
        out.update(schedule_type="times_per_day", times_per_day=int(m.group(1)))
    elif re.search(r"(?:حبه|كبسوله)\s*1\s*(?:ب|في)?اليوم|مره\s*(?:ب|في)?اليوم", numeric):
        out.update(schedule_type="times_per_day", times_per_day=1)
    times = [v for k, v in TIMES.items() if k in numeric]
    if times and "schedule_type" not in out:
        out.update(schedule_type="times_of_day", times_of_day=sorted(set(times)))
    for k, v in MEALS.items():
        if k in numeric:
            out["meal_relation"] = v
    pieces = re.search(r"(حبه|حبتين|كبسوله|ملعقه)", numeric)
    if pieces:
        out["dose_form_words"] = pieces.group(1)
    dur = re.search(r"لمده\s+(\d+)\s*(يوم|ايام|اسبوع|اسابيع|شهر|اشهر)", numeric)
    if dur:
        unit = {"يوم": "days", "ايام": "days", "اسبوع": "weeks", "اسابيع": "weeks",
                "شهر": "months", "اشهر": "months"}[dur.group(2)]
        out.update(duration_value=int(dur.group(1)), duration_unit=unit)
    return out


# ------------------------------------------------------------------ main


def extract_fields(segments, *, mode: str, catalog: dict, lab_tests: dict):
    """Return (fields, warnings). `catalog`: normalized name → display name.
    `lab_tests`: normalized Arabic name → {"id", "code", "name"}."""
    f: dict = {"chief_complaint": None, "duration": None, "symptoms": [], "negatives": [],
               "history": None, "current_medications": [], "allergies": [], "vitals": {},
               "examination": None, "diagnoses": [], "prescribed_medications": [],
               "lab_orders": [], "imaging_orders": [], "follow_up": None}
    warnings: list[str] = []
    history_parts: list[tuple[str, str]] = []

    for seg in segments:
        text = seg.text
        n = norm(text)
        numeric = numerify(text)
        sid = [seg.id]
        is_patient = seg.speaker == "patient"
        is_doctor = seg.speaker in ("doctor", "unknown")

        # complaint, symptoms, duration ---------------------------------
        mentions = [s for s in SYMPTOMS if s in n]
        if mentions and (is_patient or mode == "dictation" or seg.speaker == "unknown"):
            if f["chief_complaint"] is None:
                f["chief_complaint"] = _field(text, sid, speaker=seg.speaker,
                                              confidence=0.85 if is_patient else 0.7,
                                              needs_review=seg.speaker == "unknown",
                                              reason=("هوية المتحدث غير مؤكدة"
                                                      if seg.speaker == "unknown" else ""))
            elif is_patient:
                history_parts.append((seg.id, text))
            for s in mentions:
                negated = any(re.search(neg + r"\s+(?:\S+\s+){0,2}" + re.escape(s), n)
                              for neg in NEGATIONS)
                target = f["negatives"] if negated else f["symptoms"]
                if s not in [x["value"] for x in target]:
                    target.append(_field(s, sid, speaker=seg.speaker, confidence=0.8))
        dur = re.search(r"(?:صرلي|صرله|صرلها|من|منذ)\s+((?:\d+\s+)?(?:يوم|يومين|ايام|اسبوع|اسبوعين|"
                        r"اسابيع|شهر|شهرين|اشهر|شهور|سنه|سنتين|سنين))", numeric)
        if dur and f["duration"] is None and (is_patient or mode == "dictation"):
            f["duration"] = _field(dur.group(1), sid, speaker=seg.speaker, confidence=0.85)
        if mode == "dictation" and f["chief_complaint"] is None and seg is segments[0]:
            f["chief_complaint"] = _field(text, sid, speaker=seg.speaker, confidence=0.7)

        # allergies -----------------------------------------------------
        if "حساسيه" in n:
            if re.search(r"(?:ما عندي|ما عنده|ما عندها|بدون|لا يوجد)\s+حساسيه", n):
                f["negatives"].append(_field("نفى وجود حساسية", sid, speaker=seg.speaker))
            else:
                m = re.search(r"حساسيه\s+(?:من|على|ل)\s*(\S+)", n)
                if m:
                    start = m.start(1)
                    substance = text[start:start + len(m.group(1))]
                    reaction = re.search(r"(?:بيطلعلي|بتطلعلي|بيطلعله|بيسببلي|بتسببلي)\s+(\S+(?:\s+\S+)?)", n)
                    f["allergies"].append(_field(
                        {"substance": substance.strip("،,."),
                         "reaction": text[reaction.start(1):reaction.end(1)] if reaction else ""},
                        sid, speaker=seg.speaker, confidence=0.9))

        # vitals --------------------------------------------------------
        for key, pattern in (
            ("bp", r"(?:الضغط|ضغط)\s*(?:الدم\s*)?(?:اليوم\s*)?(\d{2,3})\s*(?:علي|على|/)\s*(\d{2,3})"),
            ("heart_rate", r"(?:النبض|نبض)\s*(\d{2,3})"),
            ("temperature_c", r"(?:الحراره|حراره)\s*(?:هلق\s*)?(\d{2}(?:\.\d)?)"),
            ("spo2", r"(?:الاكسجه|الاشباع)\s*(\d{2,3})"),
            ("glucose_mg_dl", r"السكر\s*(?:الصيامي\s*)?(?:اليوم\s*)?(\d{2,4})"),
            ("weight_kg", r"الوزن\s*(\d{1,3}(?:\.\d)?)"),
        ):
            m = re.search(pattern, numeric)
            if not m or not is_doctor:
                continue
            if key == "bp":
                pairs = (("bp_systolic", m.group(1)), ("bp_diastolic", m.group(2)))
            else:
                pairs = ((key, m.group(1)),)
            for vkey, raw in pairs:
                value = float(raw)
                low, high = VITAL_LIMITS[vkey]
                plausible = low <= value <= high
                f["vitals"][vkey] = _field(int(value) if value.is_integer() else value, sid,
                                           speaker=seg.speaker, confidence=0.9 if plausible else 0.3,
                                           needs_review=not plausible,
                                           reason="" if plausible else "قيمة غير منطقية — تحقق منها")

        # examination ---------------------------------------------------
        if is_doctor and (n.startswith("الفحص") or any(k in n for k in ("الاصوات", "الاصغاء", "وذمات"))):
            body = re.sub(r"^\s*الفحص\s*[:：]?\s*", "", text)
            f["examination"] = _field(body, sid, speaker=seg.speaker, confidence=0.85)

        # diagnoses (doctor / unknown only) -----------------------------
        ok, reason = _speaker_ok_for_assessment(seg)
        if ok:
            m = re.search(r"(?:التشخيص|تشخيص)\s*[:：]?\s*(.+)", n)
            certainty = None
            if m:
                certainty = "confirmed"
            else:
                m = re.search(r"(?:" + "|".join(UNCERTAIN) + r")\s+(?:يكون\s+)?(.+)", n)
                if m:
                    certainty = "suspected"
            if m:
                raw = text[m.start(1):m.end(1)]
                raw = re.split(r"[،,]\s*(?:بس|لكن|بدنا)|\s+بس\s+لازم", raw)[0].strip(" .،,")
                if any(u in n for u in UNCERTAIN):
                    certainty = "suspected"
                if raw:
                    f["diagnoses"].append(_field(
                        {"display": raw, "certainty": certainty}, sid, speaker=seg.speaker,
                        confidence=0.8 if certainty == "confirmed" else 0.6,
                        needs_review=bool(reason) or certainty == "suspected",
                        reason=reason or "عبارة غير مؤكدة — راجعها قبل اعتمادها كتشخيص"))

        # medications ---------------------------------------------------
        current = any(t in n for t in CURRENT_MED_TRIGGERS)
        prescribing = any(t in n for t in PRESCRIBE_TRIGGERS)
        if is_patient and current:
            parts = re.split(r"[،,]|\s+وكمان\s+|\s+و(?=دوا)", text)
            for part in parts:
                pn, pnum = norm(part), numerify(part)
                name, known = _find_drug(pn, catalog)
                amount, unit = _dose(pnum)
                if name:
                    f["current_medications"].append(_field(
                        {"name": name, "dose_amount": amount, "dose_unit": unit, "text": part.strip()},
                        [seg.id], speaker=seg.speaker, confidence=0.85))
                elif "دوا" in pn:
                    f["current_medications"].append(_field(
                        {"name": None, "dose_amount": None, "dose_unit": None, "text": part.strip()},
                        [seg.id], speaker=seg.speaker, confidence=0.3, needs_review=True,
                        reason="دواء غير محدد الاسم — اسأل المريض عن اسمه"))
        elif is_doctor and (prescribing or (mode == "dictation" and not current)):
            name, known = _find_drug(n, catalog)
            if name is None and prescribing:
                latin = re.search(r"\b([a-z][a-z\-]{3,})\b", n)
                if latin:
                    name, known = latin.group(1).capitalize(), False
            if name:
                amount, unit = _dose(numeric)
                schedule = _schedule(numeric)
                review = []
                if not known:
                    review.append("الدواء غير موجود في الكتالوج")
                if amount is None:
                    review.append("لم تُذكر الجرعة")
                if not schedule.get("schedule_type"):
                    review.append("لم يُذكر نظام التناول")
                if seg.speaker == "unknown":
                    review.append("هوية المتحدث غير مؤكدة")
                f["prescribed_medications"].append(_field(
                    {"name": name, "in_catalog": known, "dose_amount": amount, "dose_unit": unit,
                     **schedule, "text": text},
                    sid, speaker=seg.speaker, confidence=0.85 if not review else 0.5,
                    needs_review=bool(review), reason="؛ ".join(review)))

        # labs & imaging --------------------------------------------------
        if is_doctor:
            order_text = n
            labs_part = re.search(r"(?:تحليل|تحاليل)\s+(.+)", order_text)
            chunks = []
            if labs_part:
                chunks = [c.strip() for c in re.split(r"[،,]|\s+و(?=\S)", labs_part.group(1)) if c.strip()]
            for chunk in chunks:
                chunk = re.split(r"\s+بعد\s+", chunk)[0].strip()
                chunk = re.sub(r"^و", "", chunk).strip()
                if any(k in chunk for k, _ in IMAGING):
                    continue
                match = next((v for k, v in lab_tests.items() if k and (k in chunk or chunk in k)), None)
                if chunk and chunk not in [x["value"]["name"] for x in f["lab_orders"]]:
                    f["lab_orders"].append(_field(
                        {"name": chunk, "lab_test": match}, sid, speaker=seg.speaker,
                        confidence=0.85 if match else 0.6, needs_review=match is None,
                        reason="" if match else "اختر التحليل المقابل من القائمة"))
            if not n.startswith("الفحص"):
                found = set()
                for keyword, modality in IMAGING:
                    if keyword in n and not (modality == "ultrasound" and "ايكو قلب" in n) \
                            and not any(modality == x["value"]["modality"] for x in f["imaging_orders"]):
                        if modality == "xray" and "صوره" not in n and "اشعه" not in n:
                            continue
                        if modality in found:
                            continue
                        found.add(modality)
                        f["imaging_orders"].append(_field(
                            {"modality": modality, "description": keyword}, sid,
                            speaker=seg.speaker, confidence=0.8))

        # follow-up ---------------------------------------------------------
        m = re.search(r"(?:راجعني|راجعيني|المراجعه|مراجعه)\s+(بعد\s+\S+(?:\s+\S+)?)", numeric)
        if m and is_doctor:
            f["follow_up"] = _field(m.group(1), sid, speaker=seg.speaker, confidence=0.85)

    if history_parts:
        f["history"] = _field(" ".join(t for _, t in history_parts),
                              [i for i, _ in history_parts], speaker="patient", confidence=0.7)
    if mode == "dictation" and len(segments) > 0 and f["history"] is None:
        first = segments[0]
        if re.search(r"منذ|من\s+(?:سنه|سنتين|شهر)", numerify(first.text)):
            f["history"] = _field(first.text, [first.id], speaker=first.speaker, confidence=0.6)
    if any(s.speaker == "unknown" for s in segments):
        warnings.append("لم يتمكن محرك التفريغ من تمييز المتحدثين؛ راجع كل المعلومات بعناية.")
    return f, warnings
