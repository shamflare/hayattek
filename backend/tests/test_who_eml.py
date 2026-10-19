"""WHO eEML page → catalog import CSV (ADR-028). Pure parsing, no database."""

from apps.medications.catalog import parse_file, validate_row
from apps.medications.who_eml import build_rows, to_csv

PAGE = """
<h5 class="medicine-name" title="Paracetamol (acetaminophen)"><span>Paracetamol</span></h5>
<div class="formulations"><ul>
  <li>Oral &gt; Liquid: 125 mg per 5 mL; 250 mg per 5 mL</li>
  <li>Oral &gt; Solid &gt; tablet: 500 mg</li>
  <li>Local &gt; Rectal &gt; Suppository: 100 mg</li>
</ul></div>
<div class="formulations"><ul><li>Oral &gt; Solid &gt; tablet: 500 mg</li></ul></div>
<h5 class="medicine-name" title="Oseltamivir"></h5>
<div class="formulations"><ul><li>Oral &gt; Solid: 75 mg capsule (as phosphate)</li></ul></div>
<h5 class="medicine-name" title="Verapamil"></h5>
<div class="formulations"><ul>
  <li>Oral &gt; Solid &gt; tablet: 120 mg (immediate-release); 120 mg (extended-release)</li>
</ul></div>
<h5 class="medicine-name" title="Acetylsalicylic acid"></h5>
<div class="formulations"><ul><li>Oral &gt; Solid &gt; tablet: 75 to 500 mg</li></ul></div>
<h5 class="medicine-name" title="Salbutamol"></h5>
<div class="formulations"><ul><li>Respiratory &gt; Inhalation: 100 µg per actuation</li></ul></div>
<h5 class="medicine-name" title="Measles vaccine"></h5>
<div class="formulations"><ul>
  <li>All vaccines should comply with the WHO requirements for biological substances.</li>
</ul></div>
<h5 class="medicine-name" title="Condoms"></h5>
<div class="formulations"><ul><li>-</li></ul></div>
"""


def _by_name():
    return {(r["name"], r["strength"], r["dosage_form"]): r for r in build_rows(PAGE)}


def test_formulations_become_one_row_per_strength():
    rows = _by_name()
    assert ("Paracetamol (acetaminophen)", "125 mg/5 mL", "syrup") in rows
    assert ("Paracetamol (acetaminophen)", "500 mg", "tablet") in rows  # listed twice, kept once
    assert rows[("Paracetamol (acetaminophen)", "100 mg", "suppository")]["route"] == "rectal"
    assert ("Oseltamivir", "75 mg", "capsule") in rows
    assert ("Verapamil (extended-release)", "120 mg", "tablet") in rows
    assert ("Verapamil", "120 mg", "tablet") in rows
    assert ("Acetylsalicylic acid", "", "tablet") in rows  # ranges are not product strengths
    assert rows[("Salbutamol", "100 mcg/actuation", "inhaler")]["route"] == "inhalation"
    assert ("Measles vaccine", "", "injection") in rows
    assert not any(name == "Condoms" for name, _s, _f in rows)


def test_output_passes_catalog_validation_with_stable_ids():
    rows = build_rows(PAGE)
    assert [r["external_id"] for r in rows] == [r["external_id"] for r in build_rows(PAGE)]
    parsed, fmt = parse_file(to_csv(rows).encode(), "who.csv")
    assert fmt == "csv" and len(parsed) == len(rows)
    for _line, row in parsed:
        _clean, errors = validate_row(row)
        assert errors == []
