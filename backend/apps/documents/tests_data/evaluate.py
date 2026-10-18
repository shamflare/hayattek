"""Run the synthetic samples through the real OCR sidecar + parser and score the fields.

    docker compose up -d ocr
    cd backend && .venv/Scripts/python.exe apps/documents/tests_data/evaluate.py [--mode hybrid|single]

Prints a Markdown report (used for docs/OCR_EVALUATION.md). Synthetic data only; the sidecar
is local (127.0.0.1) and nothing leaves the machine.
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
import urllib.request
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2]))  # backend/

from apps.documents.ocr_parsing import parse_lines  # noqa: E402

MIME = {".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf"}
FIELDS = ("value", "unit", "low", "high")


def ocr(path: Path, url: str, mode: str, psm: str) -> dict:
    req = urllib.request.Request(f"{url}/ocr?lang=ara%2Beng&psm={psm}&mode={mode}",  # noqa: S310
                                 data=path.read_bytes(), method="POST",
                                 headers={"Content-Type": MIME[path.suffix]})
    with urllib.request.urlopen(req, timeout=300) as r:  # noqa: S310
        return json.loads(r.read().decode("utf-8"))


def norm_num(v):
    if v in (None, ""):
        return None
    try:
        return Decimal(str(v)).normalize()
    except Exception:
        return str(v).strip().lower()


def extracted_value(row, field):
    if field == "value":
        v = row["value_numeric"]["value"] or row["value_text"]["value"]
    elif field == "unit":
        v = row["unit"]["value"]
    elif field == "low":
        v = row["reference_low"]["value"]
    else:
        v = row["reference_high"]["value"]
    return v


def truth_value(t, field):
    return {"value": t["value"], "unit": t["unit"], "low": t["low"], "high": t["high"]}[field]


def same(a, b, field) -> bool:
    if field == "unit":
        return (a or "").replace("µ", "u").lower() == (b or "").replace("µ", "u").lower()
    na, nb = norm_num(a), norm_num(b)
    return na == nb


def score(truth: dict, parsed: dict) -> dict:
    rows = parsed["rows"]
    used = set()
    stats = {"rows": len(truth["rows"]), "found": 0, "name_ok": 0, "extra_rows": 0,
             "fields": 0, "correct": 0, "empty_flagged": 0, "wrong": 0, "wrong_flagged": 0,
             "flagged_rows": sum(1 for r in rows if r["needs_review"]), "errors": []}
    for t in truth["rows"]:
        best, best_ratio = None, 0.0
        for i, r in enumerate(rows):
            if i in used:
                continue
            ratio = difflib.SequenceMatcher(None, t["name"].lower(),
                                            (r["name"]["value"] or "").lower()).ratio()
            if ratio > best_ratio:
                best, best_ratio = i, ratio
        if best is None or best_ratio < 0.6:
            stats["errors"].append(f"row not found: {t['name']}")
            stats["fields"] += sum(1 for f in FIELDS if truth_value(t, f) is not None)
            continue
        used.add(best)
        r = rows[best]
        stats["found"] += 1
        if (r["name"]["value"] or "").strip().lower() == t["name"].lower():
            stats["name_ok"] += 1
        else:
            stats["errors"].append(f"name: {t['name']!r} → {r['name']['value']!r}")
        for f in FIELDS:
            expected = truth_value(t, f)
            got = extracted_value(r, f)
            if expected is None and got is None:
                continue
            if expected is None:
                stats["errors"].append(f"{t['name']}.{f}: extra value {got!r}")
                continue
            stats["fields"] += 1
            if got is not None and same(got, expected, f):
                stats["correct"] += 1
            elif got is None:
                stats["empty_flagged"] += 1 if r["needs_review"] else 0
                stats["errors"].append(f"{t['name']}.{f}: empty (expected {expected!r}; "
                                       f"flagged={r['needs_review']})")
            else:
                stats["wrong"] += 1
                stats["wrong_flagged"] += 1 if r["needs_review"] else 0
                stats["errors"].append(f"{t['name']}.{f}: WRONG {got!r} (expected {expected!r};"
                                       f" flagged={r['needs_review']}, issues={r['issues']})")
    stats["extra_rows"] = len(rows) - len(used)
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:58884")
    ap.add_argument("--mode", default="hybrid")
    ap.add_argument("--psm", default="4")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    truths = json.loads((HERE / "samples" / "truth.json").read_text(encoding="utf-8"))
    report, totals = [], {"fields": 0, "correct": 0, "wrong": 0, "wrong_flagged": 0,
                          "rows": 0, "found": 0}
    print("| Sample | ms | OCR conf | Rows found | Fields correct | Wrong (flagged) | "
          "Date | Issuer |\n|---|---|---|---|---|---|---|---|")
    for name, truth in truths.items():
        out = ocr(HERE / "samples" / name, args.url, args.mode, args.psm)
        parsed = parse_lines(out["lines"])
        st = score(truth, parsed)
        date_ok = parsed["date"]["value"] == truth["date"]
        issuer = parsed["issuer"]["value"] or ""
        issuer_ok = difflib.SequenceMatcher(None, issuer, truth["issuer"]).ratio() > 0.9
        for k in totals:
            totals[k] += st[k]
        pct = 100 * st["correct"] / st["fields"] if st["fields"] else 0
        print(f"| {name} | {out.get('duration_ms')} | {out.get('mean_confidence')} | "
              f"{st['found']}/{st['rows']} | {st['correct']}/{st['fields']} ({pct:.0f}%) | "
              f"{st['wrong']} ({st['wrong_flagged']}) | "
              f"{'✓' if date_ok else '✗ ' + str(parsed['date']['value'])} | "
              f"{'✓' if issuer_ok else '✗'} |")
        report.append({"sample": name, **st, "date_ok": date_ok, "issuer_ok": issuer_ok,
                       "lines": [ln["text"] for ln in out["lines"]]})
    pct = 100 * totals["correct"] / totals["fields"] if totals["fields"] else 0
    print(f"| **Total** | | | {totals['found']}/{totals['rows']} | "
          f"{totals['correct']}/{totals['fields']} ({pct:.0f}%) | "
          f"{totals['wrong']} ({totals['wrong_flagged']}) | | |")
    print()
    for r in report:
        print(f"### {r['sample']}")
        for e in r["errors"]:
            print(f"- {e}")
        print()
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
