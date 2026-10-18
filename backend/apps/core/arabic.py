"""Arabic text normalisation used for search and duplicate detection."""

import re
import unicodedata

_DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_SPACES = re.compile(r"\s+")
_LETTERS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ة": "ه", "ى": "ي",
                          "ؤ": "و", "ئ": "ي"})
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def normalize_digits(text: str | None) -> str:
    return (text or "").translate(_DIGITS)


def normalize_arabic(text: str | None) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = _DIACRITICS.sub("", text).translate(_LETTERS).translate(_DIGITS).lower()
    # "عبد الله" and "عبدالله" must match.
    text = re.sub(r"(^|\s)عبد\s+ال", r"\1عبدال", text)
    return _SPACES.sub(" ", text).strip()


def normalize_syrian_phone(raw: str | None) -> str:
    """Return E.164 (+963...) for Syrian numbers, or the cleaned input otherwise."""
    if not raw:
        return ""
    digits = re.sub(r"[^\d+]", "", normalize_digits(raw))
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if digits.startswith("+"):
        return digits
    if digits.startswith("963"):
        return "+" + digits
    if digits.startswith("09") and len(digits) == 10:
        return "+963" + digits[1:]
    if digits.startswith("9") and len(digits) == 9:
        return "+963" + digits
    return digits
