"""OCR extraction parser (PHASE2 §4). Synthetic OCR text only. The key property: nothing is
invented — unreadable or missing parts stay empty and are flagged for review."""

from apps.documents.ocr_parsing import normalize, parse_lines, parse_number, parse_text


def rows_by_name(result):
    return {r["name"]["value"]: r for r in result["rows"]}


def val(row, field):
    return row[field]["value"]


MIXED = """مختبر الشفاء التجريبي للتحاليل الطبية
اسم المريض: مريض تجريبي      العمر: 52
التاريخ: 2026-04-02
التحليل النتيجة الوحدة القيم المرجعية
سكر الدم الصيامي 98 mg/dL 70 - 110
الكرياتينين ١٫١ mg/dL ٠٫٦ - ١٫٢
Hemoglobin 13,5 g/dL 12.0-16.0 L
WBC 11.4H 10^3/uL 4.0 - 10.0
Total Cholesterol 232 mg/dL < 200 H
HbA1c 6.1 % 4.0 - 5.6
HBsAg Non-reactive Non-reactive
"""


def test_mixed_arabic_english_lab_report():
    result = parse_text(MIXED, confidence=95)
    assert result["document_type"]["value"] == "lab_result"
    assert result["document_type"]["suggested_category"] == "lab_result"
    assert result["issuer"]["value"] == "مختبر الشفاء التجريبي للتحاليل الطبية"
    assert result["date"]["value"] == "2026-04-02" and not result["date"]["needs_review"]
    rows = rows_by_name(result)
    # Patient/header lines are not rows.
    assert set(rows) == {"سكر الدم الصيامي", "الكرياتينين", "Hemoglobin", "WBC",
                         "Total Cholesterol", "HbA1c", "HBsAg"}

    sugar = rows["سكر الدم الصيامي"]
    assert (val(sugar, "value_numeric"), val(sugar, "unit"), val(sugar, "reference_low"),
            val(sugar, "reference_high")) == ("98", "mg/dL", "70", "110")
    assert sugar["needs_review"] is False
    assert sugar["source_line"] == "سكر الدم الصيامي 98 mg/dL 70 - 110"

    # Arabic-Indic digits with the Arabic decimal separator.
    creat = rows["الكرياتينين"]
    assert (val(creat, "value_numeric"), val(creat, "reference_low"),
            val(creat, "reference_high")) == ("1.1", "0.6", "1.2")

    # Decimal comma + flag after the range.
    hb = rows["Hemoglobin"]
    assert val(hb, "value_numeric") == "13.5" and val(hb, "flag") == "L"
    # Flag glued to the value.
    wbc = rows["WBC"]
    assert val(wbc, "value_numeric") == "11.4" and val(wbc, "flag") == "H"
    assert val(wbc, "unit") == "10^3/uL"

    chol = rows["Total Cholesterol"]
    assert val(chol, "reference_low") is None and val(chol, "reference_high") == "200"
    assert val(chol, "reference_text") == "< 200" and val(chol, "flag") == "H"

    hbs = rows["HBsAg"]
    assert val(hbs, "value_numeric") is None and val(hbs, "value_text") == "Non-reactive"
    assert val(hbs, "reference_text") == "Non-reactive"
    # Every field carries a confidence and the row keeps its source text.
    assert all(r["confidence"] == 0.95 for r in result["rows"])


def test_noisy_text_is_never_repaired():
    result = parse_lines([
        {"text": "Creatinine 1O.5 mg/dL 0.6-1.2", "confidence": 70},
        {"text": "Glucose l2,5 mmol/L 3.9 - 6.1", "confidence": 88},
        {"text": "Platelets 265 1043/uL 150 - 400", "confidence": 91},
        {"text": "Ferritin 0) ng/mL 15 - 150", "confidence": 60},
        {"text": "Signature ___ ~~ ##", "confidence": 30},
        {"text": "دمشق - شارع تجريبي - هاتف 000000", "confidence": 92},
        {"text": "12 Synthetic Street, Test City - Tel 000-0000", "confidence": 95},
    ])
    rows = rows_by_name(result)
    creat = rows["Creatinine"]
    # The damaged value is NOT turned into 10.5, and the range is not mistaken for it.
    assert val(creat, "value_numeric") is None and val(creat, "value_text") is None
    assert creat["value_text"]["raw"] == "1O.5"
    assert "unreadable_value" in creat["issues"] and creat["needs_review"]
    assert (val(creat, "reference_low"), val(creat, "reference_high")) == ("0.6", "1.2")
    assert val(rows["Glucose"], "value_numeric") is None
    # "10^3/uL" read as "1043/uL": not a value, not silently repaired, flagged.
    plt = rows["Platelets"]
    assert val(plt, "value_numeric") == "265"
    assert val(plt, "unit") is None and plt["unit"]["raw"] == "1043/uL"
    assert "unit_unreadable" in plt["issues"]
    # "0)" is junk, not a result of zero.
    # The range "15" is never promoted to the result of the unreadable "0)".
    ferritin = rows["Ferritin"]
    assert val(ferritin, "value_numeric") is None and "unreadable_value" in ferritin["issues"]
    assert (val(ferritin, "unit"), val(ferritin, "reference_low")) == ("ng/mL", "15")
    blur = rows_by_name(parse_text("الفيريتين بن ng/mL 15 - 150"))
    assert val(next(iter(blur.values())), "value_numeric") is None
    assert "Signature ___ ~~ ##" not in rows
    assert set(rows) <= {"Creatinine", "Glucose", "Platelets", "Ferritin"}  # no contact lines


def test_missing_units_are_left_empty_and_flagged():
    result = parse_text("INR 1.1 0.8 - 1.2\nTSH 2.1\npH 6.0 5.0 - 8.0", confidence=96)
    rows = rows_by_name(result)
    for name in ("INR", "TSH", "pH"):
        assert val(rows[name], "unit") is None
        assert "missing_unit" in rows[name]["issues"] and rows[name]["needs_review"]
    assert val(rows["TSH"], "reference_low") is None and val(rows["TSH"], "reference_high") is None


def test_low_word_confidence_flags_only_that_row():
    result = parse_lines([
        {"text": "Urea 32 mg/dL 15 - 45", "confidence": 90,
         "words": [{"text": "Urea", "conf": 95}, {"text": "32", "conf": 41},
                   {"text": "mg/dL", "conf": 93}, {"text": "15", "conf": 94},
                   {"text": "-", "conf": 90}, {"text": "45", "conf": 94}]},
        {"text": "ALT 28 U/L 7 - 56", "confidence": 95},
    ])
    rows = rows_by_name(result)
    urea = rows["Urea"]
    assert urea["value_numeric"]["confidence"] == 0.41
    assert urea["unit"]["confidence"] == 0.93
    assert urea["low_confidence_fields"] == ["value_numeric"]
    assert "low_confidence" in urea["issues"] and urea["needs_review"]
    # The value is still shown to the reviewer (it is what the text says), but flagged.
    assert val(urea, "value_numeric") == "32"
    assert rows["ALT"]["needs_review"] is False
    assert result["rows_needing_review"] == 1


def test_numbers_and_separators():
    assert normalize("١٢٣٫٥") == "123.5"
    assert parse_number("5,6") == (__import__("decimal").Decimal("5.6"), [])
    value, issues = parse_number("250,000")
    assert value == 250000 and issues == ["ambiguous_separator"]
    assert parse_number("1.2.3")[0] is None


def test_dates():
    assert parse_text("Report Date: 3 Jul 2026")["date"]["value"] == "2026-07-03"
    arabic = parse_text("تاريخ السحب: 12 آذار 2026")["date"]
    assert arabic["value"] == "2026-03-12"
    ambiguous = parse_text("Date: 05/04/2026")["date"]
    assert ambiguous["value"] == "2026-04-05" and "ambiguous_day_month" in ambiguous["issues"]
    assert ambiguous["needs_review"]
    unambiguous = parse_text("Collected: 14/03/2026")["date"]
    assert unambiguous["value"] == "2026-03-14" and not unambiguous["needs_review"]
    indic = parse_text("التاريخ: ١١/٠٦/٢٠٢٦")["date"]
    assert indic["value"] == "2026-06-11"
    missing = parse_text("Hemoglobin 13 g/dL")["date"]
    assert missing["value"] is None and missing["needs_review"]
    assert parse_text("Hemoglobin 13 g/dL")["issuer"]["value"] is None


def test_document_type_guess_and_non_lab_documents():
    imaging = parse_text("Ultrasound abdomen\nFindings: liver 14 cm\nImpression: normal")
    assert imaging["document_type"]["value"] == "imaging_report"
    assert imaging["document_type"]["suggested_category"] == "ultrasound"
    assert imaging["rows"] == []  # measurements of a report are not lab observations
    rx = parse_text("وصفة طبية\nAmoxicillin 500 mg caps 3 مرات يومياً")
    assert rx["document_type"]["value"] == "prescription"
    other = parse_text("hello world")
    assert other["document_type"]["value"] == "other"
    empty = parse_lines([])
    assert empty["rows"] == [] and empty["needs_review"] is True


def test_tesseract_provider_request_and_errors(monkeypatch, settings):
    import json
    import urllib.error

    from apps.documents import ocr

    seen = {}

    class Resp:
        def __init__(self, body):
            self.body = body

        def read(self):
            return self.body

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout):
        seen["url"], seen["type"], seen["timeout"] = req.full_url, req.headers["Content-type"], timeout
        return Resp(json.dumps({"text": "Hb 13 g/dL", "mean_confidence": 91.5, "version": "5.3.0",
                                "lang": "ara+eng", "psm": "4", "pages": 1,
                                "lines": [{"text": "Hb 13 g/dL", "confidence": 91.5}]}).encode())

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    out = ocr.TesseractHttpOcrProvider(url="http://ocr.local:1", timeout=7).extract(b"x", "image/png")
    assert seen == {"url": "http://ocr.local:1/ocr?lang=ara%2Beng&psm=4", "type": "image/png",
                    "timeout": 7}
    assert out.engine == "tesseract-ara+eng-psm4" and out.engine_version == "5.3.0"
    assert out.lines[0]["text"] == "Hb 13 g/dL" and out.pages == 1

    def refuse(req, timeout):
        raise urllib.error.URLError("refused")

    monkeypatch.setattr(ocr.urllib.request, "urlopen", refuse)
    try:
        ocr.TesseractHttpOcrProvider().extract(b"x", "image/png")
    except ocr.OcrError as exc:
        assert exc.code == "engine_unreachable"
    else:
        raise AssertionError("expected OcrError")
    try:
        ocr.TesseractHttpOcrProvider().extract(b"x", "application/dicom")
    except ocr.OcrError as exc:
        assert exc.code == "unsupported_type"
