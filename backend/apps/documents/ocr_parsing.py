"""Turn OCR lines into a *suggested* structure for human review (§4).

Rules (PHASE2 §4, governing rule 6):
- Nothing is invented. A field is filled only from characters actually present in the
  OCR text; anything missing or unreadable stays empty and the row is flagged.
- Every field carries a confidence (0..1, from the OCR word confidences of the exact
  characters it was taken from) and the source line text.
- Rows/fields below the review threshold, or with any parsing doubt, get `needs_review`.

Input lines: [{"text": str, "confidence": 0..100, "page": int?, "words": [{"text", "conf"}]?}]
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

PARSER_VERSION = 1
REVIEW_THRESHOLD = 0.80

# ------------------------------------------------------------------ normalization

_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
# All replacements are 1:1 so character offsets keep pointing at the same OCR words.
_CHARS = str.maketrans({
    "٫": ".", "٬": ",", "،": ",", "–": "-", "—": "-", "−": "-", "‐": "-", "‑": "-",
    "|": " ", "¦": " ", "μ": "µ", " ": " ", "≤": "<", "≥": ">", "：": ":",
    "‏": " ", "‎": " ", "؜": " ",
})


def normalize(text: str) -> str:
    """Arabic-Indic digits → ASCII, unify dashes/separators. Length-preserving."""
    return (text or "").translate(_DIGITS).translate(_CHARS)


_LETTER = re.compile(r"[A-Za-z؀-ۿ]")
_ARABIC = re.compile(r"[؀-ۿ]")


def _letters(s: str) -> int:
    return len(_LETTER.findall(s))


# ------------------------------------------------------------------ line model


@dataclass
class _Line:
    index: int
    raw: str
    norm: str
    conf: float  # 0..1
    char_conf: list[float]
    page: int = 1

    def span_conf(self, start: int, end: int) -> float:
        values = [c for c in self.char_conf[start:end] if c >= 0]
        return round(min(values), 2) if values else round(self.conf, 2)


def _build_line(index: int, item: dict) -> _Line:
    raw = str(item.get("text") or "")
    line_conf = _unit_interval(item.get("confidence"))
    words = item.get("words") or []
    char_conf = [-1.0] * len(raw)
    pos = 0
    for word in words:
        wt = str(word.get("text") or "")
        if not wt:
            continue
        found = raw.find(wt, pos)
        if found < 0:
            continue
        wc = _unit_interval(word.get("conf"))
        for i in range(found, found + len(wt)):
            char_conf[i] = wc
        pos = found + len(wt)
    if not words:
        char_conf = [line_conf] * len(raw)
    return _Line(index=index, raw=raw, norm=normalize(raw), conf=line_conf,
                 char_conf=char_conf, page=int(item.get("page") or 1))


def _unit_interval(value) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, v / 100 if v > 1 else v))


# ------------------------------------------------------------------ vocabulary

_NUM = r"\d+(?:[.,]\d+)?"
_UNITS = [
    r"x?\s?10\^?\s?(?:3|6|9|12)\s?/\s?(?:µL|uL|ul|mm3|L|l)", r"10\s?\*\s?(?:3|6|9|12)/(?:µL|uL|L)",
    r"mL/min/1\.73\s?m2", r"mg/dL", r"mg/dl", r"g/dL", r"g/dl", r"mmol/L", r"mmol/l",
    r"µmol/L", r"umol/L", r"µmol/l", r"umol/l", r"mEq/L", r"mEq/l", r"U/L", r"IU/L", r"U/l",
    r"IU/l", r"mIU/L", r"mIU/mL", r"µIU/mL", r"uIU/mL", r"mIU/ml", r"µIU/ml", r"uIU/ml",
    r"IU/mL", r"ng/mL", r"ng/ml", r"pg/mL", r"pg/ml", r"ng/dL", r"ng/dl", r"µg/dL", r"ug/dL",
    r"µg/dl", r"ug/dl", r"µg/L", r"ug/L", r"mg/L", r"mg/l", r"g/L", r"g/l", r"pmol/L",
    r"nmol/L", r"mL/min", r"mm/hr?", r"mm/1st\s?hr", r"cells/µL", r"cells/uL", r"cells/mm3",
    r"/µL", r"/uL", r"/mm3", r"/HPF", r"/LPF", r"fL", r"fl", r"pg", r"sec", r"%",
    r"ملغ/دل", r"ملغ/دسل", r"مغ/دل", r"غ/دل", r"ملمول/ل", r"ميلي مول/ل", r"وحدة/ل",
]
_UNIT_RE = re.compile(r"(?:" + "|".join(_UNITS) + r")(?![A-Za-z0-9])")
_FLAG_RE = re.compile(
    r"(?:(?<![A-Za-z])(HH|LL|H|L|High|Low|HIGH|LOW)(?![A-Za-z])|(مرتفع|منخفض)|([↑↓*]))")
_QUAL = (r"Positive|Negative|Non[\s-]?reactive|Reactive|Not\s+detected|Detected|Nil|Trace|"
         r"Absent|Present|Normal|إيجابي|ايجابي|سلبي|طبيعي|موجود|غير\s+موجود")
_QUAL_RE = re.compile(r"(?<![A-Za-z])(" + _QUAL + r")(?![A-Za-z])", re.IGNORECASE)
_RANGE_RE = re.compile(r"(" + _NUM + r")\s*-\s*(" + _NUM + r")")
_UPPER_RE = re.compile(r"(?:<=?|less\s+than|up\s+to|upto|حتى|أقل\s+من|اقل\s+من)\s*(" + _NUM + r")",
                       re.IGNORECASE)
_LOWER_RE = re.compile(r"(?:>=?|more\s+than|greater\s+than|أكثر\s+من|اكثر\s+من)\s*(" + _NUM + r")",
                       re.IGNORECASE)
# A number token damaged by OCR ("1O.5", "l2,5", "O.8"): never repaired, only reported.
_GARBLED_RE = re.compile(r"(?<![\w.,])(?=[0-9OoIlS]*[0-9])(?:[0-9][0-9OoIlS]*(?:[.,][0-9OoIlS]+)?|"
                         r"[0-9OoIlS]+[.,][0-9OoIlS]+)(?![\w.,])")
# Digits glued to stray punctuation ("0)", "4]") are OCR debris standing where a value was.
_JUNK_NUMBER_RE = re.compile(r"(?<!\S)[\d.,]+[)\]}|!]+(?!\S)")
# A flag letter may be glued to the value ("6.1H").
# A number glued to "/" or ")" is part of a unit or OCR junk ("1043/uL", "0)"), never a value.
_VALUE_RE = re.compile(r"(?<![\w.,/^(])([<>]?)(" + _NUM + r")(?=[HL](?![A-Za-z])|(?![\w^/)]))")
# "10^3/uL" read as "1043/uL" or "10*3/uL": looks like a unit, but is not repaired.
_SUSPECT_UNIT_RE = re.compile(r"10[4*^]?[369]\s?/\s?(?:µL|uL|ul|L|mm3)(?![A-Za-z0-9])")

_HEADER_WORDS = {"test", "tests", "result", "results", "unit", "units", "reference", "range",
                 "normal", "value", "values", "flag", "التحليل", "الفحص", "النتيجة", "الوحدة",
                 "المرجع", "المرجعي", "الطبيعي", "الطبيعية", "القيم", "المجال", "الحدود"}
_META_KEYS = re.compile(
    r"^\s*(patient|name|age|sex|gender|date|doctor|dr\.?|ref\.?|referred|ref\s+by|sample|"
    r"specimen|collected|collection|reported|report|received|printed|tel|phone|mobile|id|mrn|"
    r"file|lab\s+no|address|page|الاسم|اسم|المريض|العمر|الجنس|التاريخ|تاريخ|الطبيب|د\.|الهاتف|"
    r"هاتف|رقم|العنوان|الصفحة|الإحالة|محول)\b[^:\n]{0,25}:", re.IGNORECASE)

# Contact/address lines are never results, even without "key:" ("… - هاتف 000000").
_CONTACT_RE = re.compile(r"(?<![A-Za-z])(tel|phone|mobile|fax|e-?mail|address|street|p\.?o\.?\s*box)"
                         r"(?![A-Za-z])|هاتف|جوال|موبايل|فاكس|العنوان|شارع|ص\.ب", re.IGNORECASE)
_ISSUER_RE = re.compile(
    r"(laborator(?:y|ies)|\blabs?\b|diagnostic|medical\s+cent(?:er|re)|hospital|clinic|"
    r"radiology|imaging|مختبر|مخبر|مخابر|مختبرات|مركز|مشفى|مستشفى|عيادة|للتحاليل|التحاليل\s+الطبية)",
    re.IGNORECASE)

_DOC_KEYWORDS = {
    "lab_result": [r"\bCBC\b", r"hemoglobin|haemoglobin|glucose|creatinine|cholesterol|"
                   r"WBC|RBC|platelet|TSH|HbA1c|urea|ALT|AST|ferritin|vitamin",
                   r"reference\s+range|normal\s+range|\bresult\b", r"mg/dL|mmol/L|g/dL|U/L",
                   r"مختبر|مخبر|تحليل|تحاليل|النتيجة|القيم\s+الطبيعية|هيموغلوبين|سكر|كرياتينين"],
    "imaging_report": [r"x-?ray|radiograph|ultrasound|sonograph|\bCT\b|\bMRI\b|mammogra",
                       r"impression|findings|conclusion", r"أشعة|إيكو|ايكو|طبقي|رنين|تصوير",
                       r"الانطباع|الموجودات|الخلاصة"],
    "prescription": [r"\bRx\b|\btab(?:let)?s?\b|\bcaps?(?:ule)?s?\b|syrup|\bmg\b.*\b(?:daily|bid|tid)\b",
                     r"وصفة|حبة|حبوب|كبسولة|شراب|مرات\s+يومي|يومياً|قبل\s+الطعام|بعد\s+الطعام"],
}
_IMAGING_CATEGORY = [(r"x-?ray|radiograph|أشعة\s+بسيطة|صورة\s+شعاعية", "xray"),
                     (r"\bMRI\b|رنين", "mri"), (r"\bCT\b|طبقي", "ct"),
                     (r"echocardio|إيكو\s+قلب|ايكو\s+قلب", "echo"),
                     (r"ultrasound|sonograph|إيكو|ايكو", "ultrasound"),
                     (r"\bECG\b|\bEKG\b|تخطيط\s+قلب", "ecg")]


# ------------------------------------------------------------------ numbers


def parse_number(raw: str) -> tuple[Decimal | None, list[str]]:
    """'5,6' → 5.6 ; '250,000' → 250000 (flagged as ambiguous) ; garbage → None."""
    issues: list[str] = []
    s = normalize(raw).strip()
    if "," in s:
        head, _, tail = s.rpartition(",")
        if len(tail) == 3 and head.replace(",", "").isdigit() and "." not in head:
            s = s.replace(",", "")
            issues.append("ambiguous_separator")
        elif "." not in s and s.count(",") == 1:
            s = s.replace(",", ".")
        else:
            return None, ["unreadable_value"]
    try:
        value = Decimal(s)
    except InvalidOperation:
        return None, ["unreadable_value"]
    if not value.is_finite() or abs(value) >= Decimal("1e10"):
        return None, ["unreadable_value"]
    return value, issues


def _dec_str(value: Decimal | None) -> str | None:
    if value is None:
        return None
    text = format(value.normalize(), "f")
    return text


# ------------------------------------------------------------------ rows


def _field(value, line: _Line, start: int, end: int) -> dict:
    return {"value": value, "confidence": line.span_conf(start, end),
            "raw": line.raw[start:end].strip()}


def _empty_field() -> dict:
    return {"value": None, "confidence": None, "raw": ""}


def _is_header(line: _Line) -> bool:
    words = {w.strip(":.").lower() for w in re.split(r"\s+", line.norm) if w}
    return len(words & _HEADER_WORDS) >= 2 and not _VALUE_RE.search(line.norm)


def _clean_name(text: str) -> str:
    return re.sub(r"\s{2,}", " ", text.strip(" .:-_=*•·\t")).strip()


def parse_row(line: _Line) -> dict | None:
    s = line.norm
    if not s.strip() or _META_KEYS.search(s) or _CONTACT_RE.search(s) or _is_header(line):
        return None

    # Candidate value: first number with a ≥2-letter name before it (name first, LTR or
    # logical RTL order). Otherwise a qualitative result word after the name.
    value_match = None
    for m in _VALUE_RE.finditer(s):
        if _letters(s[:m.start()]) >= 2:
            value_match = m
            break
    qual = None
    if value_match is None:
        qual = _QUAL_RE.search(s)
        if qual is None or _letters(s[:qual.start()]) < 2:
            return None
    vstart = value_match.start() if value_match else qual.start()
    vend = value_match.end() if value_match else qual.end()
    garbled = None
    prefix = s[:vstart]
    for g in _GARBLED_RE.finditer(prefix):
        if _letters(prefix[:g.start()]) >= 2 and re.search(r"[A-Za-z]", g.group(0)):
            garbled = (g.start(), g.end())
            break
    junk = _JUNK_NUMBER_RE.search(prefix)
    if junk and _letters(prefix[:junk.start()]) >= 2 and (garbled is None or junk.start() < garbled[0]):
        garbled = (junk.start(), junk.end())
    unit_in_name = _UNIT_RE.search(prefix)
    if (unit_in_name and _letters(prefix[:unit_in_name.start()]) >= 2
            and (garbled is None or unit_in_name.start() < garbled[0])):
        # "Name <unreadable> mg/dL 15 - 150": a unit before the first number means the
        # result itself was not read; the next number is the range, never the value.
        garbled = (unit_in_name.start(), unit_in_name.start())
    if garbled is not None:
        vstart, vend, value_match, qual = garbled[0], garbled[1], None, None
    name_text = s[:vstart]

    issues: list[str] = []
    name_value = _clean_name(line.raw[:vstart])
    if _letters(name_value) < 2:
        return None
    row = {
        "line_index": line.index, "page": line.page, "source_line": line.raw,
        "name": _field(name_value, line, 0, len(name_text.rstrip())),
        "value_numeric": _empty_field(), "value_text": _empty_field(),
        "unit": _empty_field(), "reference_low": _empty_field(),
        "reference_high": _empty_field(), "reference_text": _empty_field(),
        "flag": _empty_field(),
    }
    if garbled is not None:
        row["value_text"] = {**_empty_field(), "raw": line.raw[vstart:vend] or "?"}
        issues.append("unreadable_value")
    elif value_match:
        qualifier, number = value_match.group(1), value_match.group(2)
        if qualifier:
            row["value_text"] = _field(qualifier + number, line, vstart, vend)
            issues.append("qualified_value")
        else:
            parsed, num_issues = parse_number(number)
            issues += num_issues
            if parsed is None:
                row["value_text"] = {**_empty_field(), "raw": line.raw[vstart:vend]}
            else:
                row["value_numeric"] = _field(_dec_str(parsed), line, vstart, vend)
    else:
        row["value_text"] = _field(_clean_name(line.raw[vstart:vend]), line, vstart, vend)

    # Remainder: flag / unit / reference in any order. Unknown text is reported, not used.
    pos, leftovers = vend, []
    while pos < len(s):
        if s[pos].isspace():
            pos += 1
            continue
        rest = s[pos:]
        for kind, regex in (("unit", _UNIT_RE), ("suspect_unit", _SUSPECT_UNIT_RE),
                            ("range", _RANGE_RE), ("upper", _UPPER_RE),
                            ("lower", _LOWER_RE), ("qual", _QUAL_RE), ("flag", _FLAG_RE)):
            m = regex.match(rest)
            if not m:
                continue
            a, b = pos + m.start(), pos + m.end()
            if kind == "unit" and row["unit"]["value"] is None:
                row["unit"] = _field(line.raw[a:b].strip(), line, a, b)
            elif kind == "suspect_unit" and row["unit"]["value"] is None:
                row["unit"] = {**_empty_field(), "raw": line.raw[a:b].strip()}
                issues.append("unit_unreadable")
            elif kind == "range" and row["reference_low"]["value"] is None:
                lo, lo_issues = parse_number(m.group(1))
                hi, hi_issues = parse_number(m.group(2))
                issues += lo_issues + hi_issues
                if lo is not None and hi is not None:
                    row["reference_low"] = _field(_dec_str(lo), line, pos + m.start(1),
                                                  pos + m.end(1))
                    row["reference_high"] = _field(_dec_str(hi), line, pos + m.start(2),
                                                   pos + m.end(2))
                    if lo > hi:
                        issues.append("range_inverted")
            elif kind == "upper" and row["reference_high"]["value"] is None:
                hi, hi_issues = parse_number(m.group(1))
                issues += hi_issues
                if hi is not None:
                    row["reference_high"] = _field(_dec_str(hi), line, a, b)
                    row["reference_text"] = _field(line.raw[a:b].strip(), line, a, b)
            elif kind == "lower" and row["reference_low"]["value"] is None:
                lo, lo_issues = parse_number(m.group(1))
                issues += lo_issues
                if lo is not None:
                    row["reference_low"] = _field(_dec_str(lo), line, a, b)
                    row["reference_text"] = _field(line.raw[a:b].strip(), line, a, b)
            elif kind == "qual" and row["value_text"]["value"] and not row["reference_text"]["value"]:
                row["reference_text"] = _field(line.raw[a:b].strip(), line, a, b)
            elif kind == "flag" and row["flag"]["value"] is None:
                token = m.group(0)
                flag = ("H" if token.upper() in ("H", "HH", "HIGH") or token in ("مرتفع", "↑")
                        else "L" if token.upper() in ("L", "LL", "LOW") or token in ("منخفض", "↓")
                        else "*")
                row["flag"] = _field(flag, line, a, b)
            else:
                leftovers.append(line.raw[a:b])
            pos = b
            break
        else:
            end = pos
            while end < len(s) and not s[end].isspace():
                end += 1
            leftovers.append(line.raw[pos:end])
            pos = end

    is_numeric = row["value_numeric"]["value"] is not None
    if not is_numeric and not row["value_text"]["value"]:
        issues.append("unreadable_value")
    if is_numeric and row["unit"]["value"] is None and not row["unit"]["raw"]:
        issues.append("missing_unit")
    if leftovers:
        issues.append("unparsed_text")
        row["unparsed"] = " ".join(leftovers)[:200]
    confs = [f["confidence"] for k, f in row.items()
             if isinstance(f, dict) and f.get("confidence") is not None]
    row["confidence"] = round(min(confs), 2) if confs else 0.0
    low = sorted(k for k, f in row.items() if isinstance(f, dict)
                 and f.get("confidence") is not None and f["confidence"] < REVIEW_THRESHOLD)
    if low:
        issues.append("low_confidence")
    row["low_confidence_fields"] = low
    row["issues"] = sorted(set(issues))
    row["needs_review"] = bool(row["issues"])
    return row


# ------------------------------------------------------------------ date / issuer / type

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9,
    "oct": 10, "nov": 11, "dec": 12,
    "كانون الثاني": 1, "شباط": 2, "آذار": 3, "اذار": 3, "نيسان": 4, "أيار": 5, "ايار": 5,
    "حزيران": 6, "تموز": 7, "آب": 8, "اب": 8, "أيلول": 9, "ايلول": 9, "تشرين الأول": 10,
    "تشرين الاول": 10, "تشرين الثاني": 11, "كانون الأول": 12, "كانون الاول": 12,
    "يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "ابريل": 4, "مايو": 5, "يونيو": 6,
    "يوليو": 7, "أغسطس": 8, "اغسطس": 8, "سبتمبر": 9, "أكتوبر": 10, "اكتوبر": 10,
    "نوفمبر": 11, "ديسمبر": 12,
}
_DMY = re.compile(r"(?<!\d)(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4}|\d{2})(?!\d)")
_YMD = re.compile(r"(?<!\d)(\d{4})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?!\d)")
_TEXT_DATE = re.compile(
    r"(?<!\d)(\d{1,2})\s+(" + "|".join(sorted(map(re.escape, _MONTHS), key=len, reverse=True))
    + r")[a-z]*\.?,?\s+(\d{4})", re.IGNORECASE)
_DATE_HINT = re.compile(r"date|collected|collection|reported|issued|تاريخ|التاريخ|سحب|صدور",
                        re.IGNORECASE)


def _year(y: str) -> int:
    n = int(y)
    return n + 2000 if n < 100 else n


def extract_date(lines: list[_Line]) -> dict:
    candidates = []
    for line in lines:
        s = line.norm
        for regex, order in ((_YMD, "ymd"), (_DMY, "dmy"), (_TEXT_DATE, "text")):
            for m in regex.finditer(s):
                issues = []
                try:
                    if order == "ymd":
                        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                    elif order == "dmy":
                        d, mo, y = int(m.group(1)), int(m.group(2)), _year(m.group(3))
                        if d <= 12 and mo <= 12 and d != mo:
                            issues.append("ambiguous_day_month")
                        if len(m.group(3)) == 2:
                            issues.append("two_digit_year")
                    else:
                        d, y = int(m.group(1)), int(m.group(3))
                        mo = _MONTHS[m.group(2).lower()[:3] if m.group(2).isascii()
                                     else m.group(2)]
                    value = date(y, mo, d)
                except (ValueError, KeyError):
                    continue
                if not 1990 <= value.year <= 2100:
                    continue
                score = (2 if _DATE_HINT.search(s) else 0) + (1 if order != "dmy" else 0)
                candidates.append((score, -line.index, value, line, m, issues))
    if not candidates:
        return {"value": None, "confidence": None, "raw": "", "source_line": "",
                "needs_review": True, "issues": ["not_found"]}
    candidates.sort(key=lambda c: (c[0], c[1]), reverse=True)
    _score, _i, value, line, m, issues = candidates[0]
    conf = line.span_conf(m.start(), m.end())
    if len({c[2] for c in candidates}) > 1:
        issues.append("multiple_dates")
    if conf < REVIEW_THRESHOLD:
        issues.append("low_confidence")
    return {"value": value.isoformat(), "confidence": conf, "raw": line.raw[m.start():m.end()],
            "source_line": line.raw, "line_index": line.index,
            "needs_review": bool(issues), "issues": issues}


def extract_issuer(lines: list[_Line]) -> dict:
    for line in lines[:8]:
        m = _ISSUER_RE.search(line.norm)
        if m and not _META_KEYS.search(line.norm) and _letters(line.norm) >= 4:
            text = _clean_name(line.raw)[:200]
            conf = line.span_conf(0, len(line.raw))
            issues = ["low_confidence"] if conf < REVIEW_THRESHOLD else []
            return {"value": text, "confidence": conf, "raw": text, "source_line": line.raw,
                    "line_index": line.index, "needs_review": bool(issues), "issues": issues}
    return {"value": None, "confidence": None, "raw": "", "source_line": "",
            "needs_review": True, "issues": ["not_found"]}


def guess_document_type(text: str, row_count: int) -> dict:
    scores = {}
    for kind, patterns in _DOC_KEYWORDS.items():
        scores[kind] = sum(1 for p in patterns if re.search(p, text, re.IGNORECASE))
    scores["lab_result"] += min(row_count, 5) // 2
    best = max(scores, key=lambda k: scores[k])
    total = sum(scores.values())
    if scores[best] == 0:
        return {"value": "other", "confidence": None, "suggested_category": "",
                "needs_review": True, "scores": scores}
    category = ""
    if best == "lab_result":
        category = "lab_result"
    elif best == "prescription":
        category = "prescription_scan"
    else:
        for pattern, cat in _IMAGING_CATEGORY:
            if re.search(pattern, text, re.IGNORECASE):
                category = cat
                break
    conf = round(scores[best] / total, 2)
    return {"value": best, "confidence": conf, "suggested_category": category,
            "needs_review": conf < 0.6, "scores": scores}


# ------------------------------------------------------------------ entry point


def parse_lines(raw_lines: list[dict]) -> dict:
    lines = [_build_line(i, item) for i, item in enumerate(raw_lines or [])]
    rows = [row for row in (parse_row(line) for line in lines) if row]
    text = "\n".join(line.norm for line in lines)
    doc_type = guess_document_type(text, len(rows))
    if doc_type["value"] not in ("lab_result", "other"):
        # Value/unit rows of an imaging report or prescription are not lab observations.
        rows = []
    return {
        "parser_version": PARSER_VERSION,
        "review_threshold": REVIEW_THRESHOLD,
        "document_type": doc_type,
        "date": extract_date(lines),
        "issuer": extract_issuer(lines),
        "rows": rows,
        "needs_review": True,  # machine output is always a suggestion
        "rows_needing_review": sum(1 for r in rows if r["needs_review"]),
    }


def parse_text(text: str, confidence: float = 90.0) -> dict:
    """Convenience for providers that return plain text only."""
    return parse_lines([{"text": t, "confidence": confidence} for t in (text or "").splitlines()])
