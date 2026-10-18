"""Render SYNTHETIC lab-report images for the OCR evaluation (docs/OCR_EVALUATION.md).

All names, labs and values are invented. Run from backend/:
    .venv/Scripts/python.exe apps/documents/tests_data/make_samples.py
Writes samples/*.png|*.jpg|*.pdf and samples/truth.json (ground truth per sample).

Pillow on Windows has no raqm (complex-script shaping), so Arabic is shaped here with
Unicode presentation forms and laid out right-to-left cell by cell. Uses the system Arial
font (not redistributed; only the rendered synthetic images are kept).
"""

from __future__ import annotations

import json
import random
import sys
import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent / "samples"
FONT = "C:/Windows/Fonts/arial.ttf" if sys.platform == "win32" else (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
FONT_BOLD = "C:/Windows/Fonts/arialbd.ttf" if sys.platform == "win32" else FONT

# ------------------------------------------------------------------ minimal Arabic shaping

_RIGHT_JOINING = set("اأإآٱدذرزوؤةى")
_ALEFS = {"ا": "", "أ": " WITH HAMZA ABOVE", "إ": " WITH HAMZA BELOW", "آ": " WITH MADDA ABOVE"}


def _is_arabic_letter(ch: str) -> bool:
    return "\u0620" <= ch <= "\u064a" and ch not in "ـ"


def _dual(ch: str) -> bool:
    return _is_arabic_letter(ch) and ch not in _RIGHT_JOINING and ch != "ء"


def _form(ch: str, form: str) -> str:
    try:
        return unicodedata.lookup(f"{unicodedata.name(ch)} {form} FORM")
    except KeyError:
        return ch


def shape(word: str) -> str:
    """Logical Arabic → contextual presentation forms (still logical order)."""
    out, i = [], 0
    while i < len(word):
        ch = word[i]
        prev = word[i - 1] if i else ""
        nxt = word[i + 1] if i + 1 < len(word) else ""
        joins_prev = bool(prev) and _dual(prev) and _is_arabic_letter(ch)
        if ch == "ل" and nxt in _ALEFS:
            name = f"ARABIC LIGATURE LAM WITH ALEF{_ALEFS[nxt]} {'FINAL' if joins_prev else 'ISOLATED'} FORM"
            out.append(unicodedata.lookup(name))
            i += 2
            continue
        if not _is_arabic_letter(ch):
            out.append(ch)
        else:
            joins_next = _dual(ch) and _is_arabic_letter(nxt)
            form = ("MEDIAL" if joins_prev and joins_next else "FINAL" if joins_prev
                    else "INITIAL" if joins_next else "ISOLATED")
            out.append(_form(ch, form))
        i += 1
    return "".join(out)


def has_arabic(text: str) -> bool:
    return any("\u0600" <= c <= "\u06ff" for c in text)


def visual_rtl(text: str) -> str:
    """Logical RTL cell text → left-to-right drawing order (word-level bidi)."""
    words = text.split(" ")
    return " ".join(shape(w)[::-1] if has_arabic(w) else w for w in reversed(words))


# ------------------------------------------------------------------ page rendering


class Page:
    def __init__(self, width=1654, height=2339, rtl=False):
        self.img = Image.new("L", (width, height), 255)
        self.draw = ImageDraw.Draw(self.img)
        self.rtl = rtl
        self.w = width
        self.y = 90
        self.margin = 110

    def font(self, size, bold=False):
        return ImageFont.truetype(FONT_BOLD if bold else FONT, size)

    def text(self, x, y, s, size=34, bold=False, anchor="la"):
        rendered = visual_rtl(s) if has_arabic(s) else s
        self.draw.text((x, y), rendered, font=self.font(size, bold), fill=0, anchor=anchor)

    def line(self, s, size=34, bold=False, align=None, gap=1.7):
        align = align or ("right" if self.rtl else "left")
        if align == "right":
            self.text(self.w - self.margin, self.y, s, size, bold, anchor="ra")
        elif align == "center":
            self.text(self.w // 2, self.y, s, size, bold, anchor="ma")
        else:
            self.text(self.margin, self.y, s, size, bold)
        self.y += int(size * gap)

    def rule(self):
        self.draw.line((self.margin, self.y, self.w - self.margin, self.y), fill=0, width=2)
        self.y += 24

    def table(self, header, rows, cols, size=32, gap=1.8):
        """cols: x start positions as fractions of the content width (LTR) — mirrored if rtl."""
        content = self.w - 2 * self.margin

        def put(cells, bold):
            for frac, cell in zip(cols, cells, strict=False):
                if self.rtl:
                    x = self.w - self.margin - int(frac * content)
                    self.text(x, self.y, cell, size, bold, anchor="ra")
                else:
                    self.text(self.margin + int(frac * content), self.y, cell, size, bold)
            self.y += int(size * gap)

        put(header, True)
        self.rule()
        for row in rows:
            put(row, False)


def degrade(img: Image.Image, seed: int, angle=1.2, scale=0.62, blur=1.1, noise=18):
    rnd = random.Random(seed)  # noqa: S311 - synthetic image noise, not security
    img = img.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=235)
    img = img.resize((int(img.width * scale), int(img.height * scale)), Image.BILINEAR)
    img = img.filter(ImageFilter.GaussianBlur(blur))
    px = img.load()
    for _ in range(img.width * img.height // 40):
        x, y = rnd.randrange(img.width), rnd.randrange(img.height)
        px[x, y] = max(0, min(255, px[x, y] + rnd.randint(-noise * 4, noise * 4)))
    # uneven lighting (phone photo): darken towards one corner
    shade = Image.linear_gradient("L").resize(img.size).point(lambda v: 255 - v // 5)
    return Image.composite(img, Image.new("L", img.size, 0), shade)


# ------------------------------------------------------------------ samples (synthetic)


def row(name, value, unit, low=None, high=None, ref_text=None, flag=""):
    return {"name": name, "value": value, "unit": unit, "low": low, "high": high,
            "ref_text": ref_text, "flag": flag}


def sample_en_cbc():
    truth = {"issuer": "Nour Synthetic Medical Laboratory", "date": "2026-03-14", "rows": [
        row("Hemoglobin", "13.2", "g/dL", "12.0", "16.0"),
        row("Hematocrit", "39.8", "%", "36", "46"),
        row("RBC Count", "4.52", "10^6/uL", "4.2", "5.4"),
        row("WBC Count", "11.4", "10^3/uL", "4.0", "10.0", flag="H"),
        row("Platelets", "265", "10^3/uL", "150", "400"),
        row("MCV", "88.1", "fL", "80", "100"),
        row("MCH", "29.2", "pg", "27", "33"),
        row("Neutrophils", "72", "%", "40", "75"),
    ]}
    p = Page()
    p.line(truth["issuer"], 46, True, "center")
    p.line("12 Synthetic Street, Test City - Tel 000-0000", 28, align="center")
    p.rule()
    p.line("Patient: Test Patient One        Age: 41 Y        Sex: F", 32)
    p.line("Collected: 14/03/2026  09:20        Lab No: SYN-0001", 32)
    p.line("COMPLETE BLOOD COUNT (CBC)", 36, True, "center")
    rows = [[r["name"], r["value"] + (f" {r['flag']}" if r["flag"] else ""), r["unit"],
             f"{r['low']} - {r['high']}"] for r in truth["rows"]]
    p.table(["Test", "Result", "Unit", "Reference Range"], rows, [0, 0.38, 0.55, 0.75])
    p.rule()
    p.line("Verified by: Synthetic Pathologist", 28)
    return p.img, truth, "png"


def sample_ar_mixed():
    truth = {"issuer": "مختبر الشفاء التجريبي للتحاليل الطبية", "date": "2026-04-02", "rows": [
        row("سكر الدم الصيامي", "98", "mg/dL", "70", "110"),
        row("البولة", "32", "mg/dL", "15", "45"),
        row("الكرياتينين", "1.1", "mg/dL", "0.6", "1.2"),
        row("الكوليسترول الكلي", "232", "mg/dL", None, "200", ref_text="< 200", flag="H"),
        row("الدهون الثلاثية", "150", "mg/dL", None, "150", ref_text="< 150"),
        row("ALT", "28", "U/L", "7", "56"),
        row("HbA1c", "6.1", "%", "4.0", "5.6", flag="H"),
    ]}
    p = Page(rtl=True)
    p.line(truth["issuer"], 46, True, "center")
    p.line("دمشق - شارع تجريبي - هاتف 000000", 30, align="center")
    p.rule()
    p.line("اسم المريض: مريض تجريبي          العمر: 52", 32)
    p.line("التاريخ: 2026-04-02", 32)
    p.line("الكيمياء الحيوية", 38, True, "center")

    def ref(r):
        return r["ref_text"] if r["ref_text"] else f"{r['low']} - {r['high']}"
    rows = [[r["name"], r["value"] + (f" {r['flag']}" if r["flag"] else ""), r["unit"], ref(r)]
            for r in truth["rows"]]
    p.table(["التحليل", "النتيجة", "الوحدة", "القيم المرجعية"], rows, [0, 0.42, 0.58, 0.75])
    p.rule()
    p.line("النتائج للاستخدام التجريبي فقط", 28)
    return p.img, truth, "png"


def sample_en_noisy():
    truth = {"issuer": "Al-Amal Synthetic Diagnostic Center", "date": "2026-05-20", "rows": [
        row("Total Cholesterol", "214", "mg/dL", None, "200", ref_text="< 200", flag="H"),
        row("HDL Cholesterol", "42", "mg/dL", "40", "60"),
        row("LDL Cholesterol", "145", "mg/dL", None, "130", ref_text="< 130", flag="H"),
        row("Triglycerides", "180", "mg/dL", None, "150", ref_text="< 150", flag="H"),
        row("TSH", "2.35", "uIU/mL", "0.4", "4.0"),
        row("Ferritin", "18", "ng/mL", "15", "150"),
        row("Vitamin B12", "310", "pg/mL", "200", "900"),
    ]}
    p = Page()
    p.line(truth["issuer"], 44, True, "center")
    p.rule()
    p.line("Name: Test Patient Two      Date: 20-05-2026", 32)
    p.line("LIPID PROFILE / THYROID / IRON", 36, True, "center")

    def ref(r):
        return r["ref_text"] if r["ref_text"] else f"{r['low']} - {r['high']}"
    rows = [[r["name"], r["value"] + (f" {r['flag']}" if r["flag"] else ""), r["unit"], ref(r)]
            for r in truth["rows"]]
    p.table(["Test", "Result", "Unit", "Normal Range"], rows, [0, 0.40, 0.56, 0.76])
    return degrade(p.img, seed=7), truth, "jpg"


def sample_ar_indic():
    truth = {"issuer": "مخبر النور التجريبي", "date": "2026-06-11", "rows": [
        row("الهيموغلوبين", "11.8", "g/dL", "12", "16", flag="L"),
        row("الكريات البيض", "6.4", "10^3/uL", "4", "10"),
        row("الصفيحات", "310", "10^3/uL", "150", "400"),
        row("الحديد", "48", "ug/dL", "60", "170", flag="L"),
        row("الفيريتين", "9.5", "ng/mL", "15", "150", flag="L"),
    ]}
    to_indic = str.maketrans("0123456789.", "٠١٢٣٤٥٦٧٨٩٫")
    p = Page(rtl=True)
    p.line(truth["issuer"], 46, True, "center")
    p.rule()
    p.line("المريض: مريضة تجريبية", 32)
    p.line("تاريخ السحب: " + "11/06/2026".translate(to_indic), 32)
    flag_ar = {"L": "منخفض", "H": "مرتفع", "": ""}
    rows = [[r["name"], r["value"].translate(to_indic), r["unit"],
             f"{r['low']} - {r['high']}".translate(to_indic), flag_ar[r["flag"]]]
            for r in truth["rows"]]
    p.table(["الفحص", "النتيجة", "الوحدة", "المجال الطبيعي", "ملاحظة"], rows,
            [0, 0.30, 0.46, 0.64, 0.86])
    return p.img, truth, "png"


def sample_en_missing_units_pdf():
    truth = {"issuer": "Hayat Synthetic Labs", "date": "2026-07-03", "rows": [
        row("INR", "1.1", None, "0.8", "1.2"),
        row("Specific Gravity", "1.020", None, "1.005", "1.030"),
        row("pH", "6.0", None, "5.0", "8.0"),
        row("Urine Protein", "Negative", None, ref_text="Negative"),
        row("Urine Glucose", "Negative", None, ref_text="Negative"),
        row("HBsAg", "Non-reactive", None, ref_text="Non-reactive"),
    ]}
    p = Page()
    p.line(truth["issuer"], 44, True, "center")
    p.rule()
    p.line("Report Date: 3 Jul 2026", 32)
    p.line("COAGULATION / URINALYSIS / SEROLOGY", 34, True, "center")
    rows = [[r["name"], r["value"], r["ref_text"] or f"{r['low']} - {r['high']}"]
            for r in truth["rows"]]
    p.table(["Test", "Result", "Reference"], rows, [0, 0.45, 0.70])
    return p.img, truth, "pdf"


SAMPLES = {
    "s1_en_cbc_clean": sample_en_cbc,
    "s2_ar_mixed_chemistry": sample_ar_mixed,
    "s3_en_noisy_photo": sample_en_noisy,
    "s4_ar_indic_digits": sample_ar_indic,
    "s5_en_no_units_pdf": sample_en_missing_units_pdf,
}


def main():
    OUT.mkdir(exist_ok=True)
    truths = {}
    for name, fn in SAMPLES.items():
        img, truth, ext = fn()
        path = OUT / f"{name}.{ext}"
        if ext == "pdf":
            img.convert("RGB").save(path, "PDF", resolution=200)
        elif ext == "jpg":
            img.convert("RGB").save(path, "JPEG", quality=60)
        else:
            img.save(path, "PNG", optimize=True)
        truths[path.name] = truth
        print("wrote", path.name)
    (OUT / "truth.json").write_text(json.dumps(truths, ensure_ascii=False, indent=1),
                                    encoding="utf-8")


if __name__ == "__main__":
    main()
