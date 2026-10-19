"""WHO Model List of Essential Medicines → catalog import CSV (ADR-028).

Source: WHO electronic EML, https://list.essentialmeds.org/ — licence CC BY 3.0 IGO (commercial
use allowed with attribution). The page lists every medicine with formulations such as
"Oral > Solid > tablet: 250 mg; 500 mg". Each strength becomes one catalog row (generic name,
no brand/manufacturer). The output goes through the normal upload → preview → commit flow; no
drug data is stored in the repository.
"""

from __future__ import annotations

import csv
import hashlib
import html
import io
import re

SOURCE_URL = "https://list.essentialmeds.org/"
SOURCE_NAME = "WHO Model List of Essential Medicines (eEML)"
LICENSE_TEXT = (
    "WHO electronic Essential Medicines List (eEML), World Health Organization. "
    "https://list.essentialmeds.org/ Licence: CC BY 3.0 IGO. This is an adaptation of an "
    "original work by WHO; WHO does not endorse it."
)
COLUMNS = ("external_id", "name", "active_ingredient", "strength", "dosage_form", "route")

# (route/category path prefix, dosage_form, route) — first match wins; None form = skip.
PATH_RULES = [
    ("oral > solid > capsule", "capsule", "oral"),
    ("oral > solid > granules", "sachet", "oral"),
    ("oral > solid > lozenge", "other", "oral"),
    ("oral > solid", "tablet", "oral"),
    ("oral > liquid", "syrup", "oral"),
    ("oral > other", "other", "oral"),
    ("parenteral > general injections > iv", "injection", "iv"),
    ("parenteral > general injections > im", "injection", "im"),
    ("parenteral > general injections > sc", "injection", "sc"),
    ("parenteral > general injections", "injection", "other"),
    ("parenteral > locoregional injections", "injection", "other"),
    ("local > topical > cream", "cream", "topical"),
    ("local > topical > ointment", "ointment", "topical"),
    ("local > topical > gel", "gel", "topical"),
    ("local > topical > transdermal patch", "patch", "topical"),
    ("local > topical", "other", "topical"),
    ("local > ophthalmological > ointment", "ointment", "ophthalmic"),
    ("local > ophthalmological", "drops", "ophthalmic"),
    ("local > otological", "drops", "otic"),
    ("local > nasal > spray", "nasal_spray", "nasal"),
    ("local > nasal", "drops", "nasal"),
    ("local > rectal > suppository", "suppository", "rectal"),
    ("local > rectal", "other", "rectal"),
    ("local > vaginal > tablet", "tablet", "vaginal"),
    ("local > vaginal", "other", "vaginal"),
    ("local > buccal", "other", "oral"),
    ("local > dental", "other", "topical"),
    ("respiratory", "inhaler", "inhalation"),
    ("implant", "other", "other"),
]

_UNIT = r"(?:mg|g|mcg|micrograms?|µg|μg|mL|ml|L|IU|million IU|mmol|mEq|%)"
_AMOUNT = rf"\d+(?:[.,]\d+)?\s*{_UNIT}?"
_STRENGTH = re.compile(
    rf"^\s*(?P<s>{_AMOUNT}(?:\s*(?:\+|to)\s*{_AMOUNT})*"
    rf"(?:\s*(?:per|/)\s*(?:\d+(?:\.\d+)?\s*)?(?:mL|ml|g|L|dose|actuation|puff))?)",
    re.I,
)
_RELEASE = re.compile(r"(extended|modified|prolonged|sustained)[- ]release", re.I)


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", text))).strip()


def parse_medicines(page: str) -> list[tuple[str, list[str]]]:
    """[(medicine name, [formulation lines])] — formulations de-duplicated across sections."""
    out = []
    for block in re.split(r'<h5 class="medicine-name"', page)[1:]:
        title = re.search(r'title="([^"]*)"', block)
        if not title:
            continue
        lines: list[str] = []
        for ul in re.findall(r'<div class="formulations">\s*<ul>(.*?)</ul>', block, re.S):
            for li in re.findall(r"<li>(.*?)</li>", ul, re.S):
                line = _clean(li)
                if line and line not in lines:
                    lines.append(line)
        out.append((html.unescape(title.group(1)).strip(), lines))
    return out


def _rule(path: str) -> tuple[str, str] | None:
    key = path.lower()
    for prefix, form, route in PATH_RULES:
        if key.startswith(prefix):
            return form, route
    return None


def normalise_strength(raw: str) -> str:
    s = re.sub(r"micrograms?|µg|μg", "mcg", raw)
    s = re.sub(r"\s+to\s+", "-", s)
    s = re.sub(r"\s*per\s*", "/", s)
    s = re.sub(r"\s*/\s*", "/", s)
    return re.sub(r"\s+", " ", s).strip()


def rows_for(name: str, line: str) -> list[dict]:
    path, sep, rest = line.partition(":")
    if not sep or ">" not in path:
        return []  # explanatory notes (vaccines, composite products) are not prescribable rows
    rule = _rule(path.strip())
    if rule is None:
        return []
    base_form, route = rule
    rows = []
    for item in rest.split(";"):
        item = item.strip()
        match = _STRENGTH.match(item)
        if not item or not match or not re.search(r"\d", match.group("s")):
            continue
        tail = item[match.end():].lower()
        form = base_form
        if base_form == "tablet" and "capsule" in tail:
            form = "capsule"
        elif base_form == "syrup" and ("suspension" in tail or "granules" in tail):
            form = "suspension"
        elif base_form == "syrup" and "drops" in tail:
            form = "drops"
        display = name
        if _RELEASE.search(tail):
            display = f"{name} (extended-release)"
        elif "dispersible" in path.lower() or "dispersible" in tail:
            display = f"{name} (dispersible)"
        strength = normalise_strength(match.group("s"))
        if re.search(r"\d-\d", strength):
            strength = ""  # a WHO range ("75-500 mg") is not a product strength
        rows.append({"name": display, "active_ingredient": name, "strength": strength,
                     "dosage_form": form, "route": route})
    return rows


def fallback_row(name: str, lines: list[str]) -> dict | None:
    """One strength-less row for a medicine whose formulations give no strength (vaccines,
    infusion fluids, lotions). Devices and notes without a dosage path are left out."""
    if name.lower().endswith("vaccine"):
        return {"name": name, "active_ingredient": name, "strength": "",
                "dosage_form": "injection", "route": "other"}
    for line in lines:
        rule = _rule(line.partition(":")[0].strip())
        if rule:
            return {"name": name, "active_ingredient": name, "strength": "",
                    "dosage_form": rule[0], "route": rule[1]}
    return None


def build_rows(page: str) -> list[dict]:
    seen: set[tuple[str, str, str]] = set()
    rows = []
    for name, lines in parse_medicines(page):
        candidates = [row for line in lines for row in rows_for(name, line)]
        if not candidates and (fallback := fallback_row(name, lines)):
            candidates = [fallback]
        for row in candidates:
            key = (row["name"].lower(), row["strength"].lower().replace(" ", ""),
                   row["dosage_form"])
            if key in seen:
                continue
            seen.add(key)
            digest = hashlib.sha256("|".join(key).encode()).hexdigest()[:12]
            rows.append({"external_id": f"WHO-EML-{digest}", **row})
    rows.sort(key=lambda r: (r["name"].lower(), r["dosage_form"], r["strength"]))
    return rows


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()
