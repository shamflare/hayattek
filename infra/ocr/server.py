"""Minimal HTTP wrapper around Tesseract (stdlib only).

POST /ocr            body = raw file bytes (image or PDF)
    headers:  Content-Type: application/pdf | image/*
    query:    lang=ara+eng (default)  psm=4 (default)
              mode=hybrid (default: Arabic words from the ara pass, Latin/digits from an
                    eng pass, merged by box geometry) | single (one pass)
    200 -> {"engine", "version", "lang", "psm", "pages", "text", "mean_confidence",
            "lines": [{"page", "text", "confidence", "words": [{"text","conf","box"}]}]}
GET  /health         -> {"status": "ok", "engine": "tesseract", "version": "..."}

No file is kept: every request works in a private temporary directory that is removed
afterwards. Nothing is logged except method, path, status and duration (no content).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("OCR_PORT", "8884"))
MAX_BYTES = int(os.environ.get("OCR_MAX_BYTES", str(25 * 1024 * 1024)))
MAX_PAGES = int(os.environ.get("OCR_MAX_PAGES", "10"))
TIMEOUT = int(os.environ.get("OCR_TIMEOUT", "90"))
# Fallback binarization when global Otsu finds no text: 1 = adaptive Otsu, 2 = Sauvola.
# Sauvola copes with phone photos (uneven light, grey borders) where global Otsu makes
# Tesseract see the whole page as a picture; it is slightly worse on clean scans.
THRESHOLDING = os.environ.get("OCR_THRESHOLDING", "2")
PDF_DPI = int(os.environ.get("OCR_PDF_DPI", "300"))
# Tesseract is CPU-bound: run at most N jobs at once, queue the rest.
SLOTS = threading.BoundedSemaphore(int(os.environ.get("OCR_CONCURRENCY", "2")))
ALLOWED_LANGS = {"ara", "eng", "ara+eng", "eng+ara"}
ALLOWED_PSM = {"3", "4", "6", "11"}


def tesseract_version() -> str:
    try:
        out = subprocess.run(["tesseract", "--version"], capture_output=True, text=True,
                             timeout=10, check=False)
        first = (out.stdout or out.stderr).splitlines()[0]
        return first.replace("tesseract", "").strip()
    except Exception:  # pragma: no cover - only when the binary is missing
        return "unknown"


VERSION = tesseract_version()
IMAGE_SUFFIX = {"image/png": ".png", "image/jpeg": ".jpg", "image/tiff": ".tif",
                "image/webp": ".webp", "image/bmp": ".bmp", "image/gif": ".gif"}


def sniff(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "image/tiff"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"BM"):
        return "image/bmp"
    return None


def pdf_to_images(pdf: Path, workdir: Path) -> list[Path]:
    subprocess.run(["pdftoppm", "-r", str(PDF_DPI), "-gray", "-png", "-l", str(MAX_PAGES),
                    str(pdf), str(workdir / "page")], check=True, timeout=TIMEOUT,
                   capture_output=True)
    return sorted(workdir.glob("page*.png"))


def ocr_image(image: Path, lang: str, psm: str) -> list[dict]:
    lines = _ocr_image(image, lang, psm, "0")
    if sum(len(ln["words"]) for ln in lines) < 5 and THRESHOLDING != "0":
        # Global Otsu failed (photo with uneven light): retry with adaptive thresholding.
        lines = _ocr_image(image, lang, psm, THRESHOLDING)
    return lines


def _ocr_image(image: Path, lang: str, psm: str, thresholding: str) -> list[dict]:
    proc = subprocess.run(
        ["tesseract", str(image), "stdout", "-l", lang, "--psm", psm,
         "-c", "preserve_interword_spaces=1", "-c", f"thresholding_method={thresholding}", "tsv"],
        capture_output=True, timeout=TIMEOUT, check=True,
    )
    lines: dict[tuple, dict] = {}
    rows = proc.stdout.decode("utf-8", "replace").splitlines()
    for row in rows[1:]:
        cols = row.split("\t")
        if len(cols) < 12 or cols[0] != "5":
            continue
        text = cols[11].replace("‏", "").replace("‎", "").strip()
        if not text:
            continue
        key = (int(cols[2]), int(cols[3]), int(cols[4]))
        left, top, width, height = (int(c) for c in cols[6:10])
        conf = float(cols[10])
        line = lines.setdefault(key, {"words": [], "top": top})
        line["words"].append({"text": text, "conf": round(max(conf, 0.0), 1),
                              "box": [left, top, width, height]})
    out = []
    for key in sorted(lines, key=lambda k: (lines[k]["top"], k)):
        words = lines[key]["words"]
        confs = [w["conf"] for w in words]
        out.append({"text": " ".join(w["text"] for w in words),
                    "confidence": round(sum(confs) / len(confs), 1), "words": words})
    return out


def _is_arabic(text: str) -> bool:
    return any("؀" <= c <= "ۿ" for c in text)


def _line_of(words: list[dict]) -> dict:
    confs = [w["conf"] for w in words]
    return {"text": " ".join(w["text"] for w in words),
            "confidence": round(sum(confs) / len(confs), 1), "words": words}


def _logical_rtl(words: list[dict]) -> list[dict]:
    """Visual boxes of an RTL line → logical order. Arabic words right-to-left; each LTR run
    (numbers, units, Latin names) left-to-right. A wide horizontal gap (table column) ends a
    run, so separate columns are never merged into one reversed run."""
    words = sorted(words, key=lambda w: -(w["box"][0] + w["box"][2]))
    heights = sorted(w["box"][3] for w in words) or [20]
    gap = heights[len(heights) // 2] * 1.6
    out, run = [], []
    prev_left = None
    for w in words:
        right = w["box"][0] + w["box"][2]
        if run and (_is_arabic(w["text"]) or (prev_left is not None and prev_left - right > gap)):
            out.extend(reversed(run))
            run = []
        if _is_arabic(w["text"]):
            out.append(w)
        else:
            run.append(w)
        prev_left = w["box"][0]
    out.extend(reversed(run))
    return out


def hybrid_lines(ara: list[dict], eng: list[dict]) -> list[dict]:
    """Merge an ara+eng pass and an eng pass by geometry.

    Tesseract's Arabic model misreads Latin digits inside RTL lines ("15 - 45" → "5 - 15").
    Arabic words are kept from the Arabic pass; every non-Arabic word comes from the English
    pass, then each line is put in logical order. English-only lines use the English pass.
    """
    eng_words = [w for line in eng for w in line["words"]]
    used: set[int] = set()
    merged_lines = []
    out = []
    for line in ara:
        arabic = [w for w in line["words"] if _is_arabic(w["text"])]
        tops = [w["box"][1] for w in line["words"]]
        bottoms = [w["box"][1] + w["box"][3] for w in line["words"]]
        top, bottom = min(tops), max(bottoms)
        latin, contested = [], {}
        for i, w in enumerate(eng_words):
            cy = w["box"][1] + w["box"][3] / 2
            if i in used or not top <= cy <= bottom:
                continue
            used.add(i)
            l, r = w["box"][0], w["box"][0] + w["box"][2]
            rivals = [a for a in arabic
                      if min(r, a["box"][0] + a["box"][2]) - max(l, a["box"][0])
                      > 0.3 * min(max(1, r - l), a["box"][2])]
            if not rivals:
                latin.append(w)
            elif w["conf"] > max(a["conf"] for a in rivals) + 5:
                # Latin text the Arabic model misread as Arabic letters ("mg/dL" → junk).
                arabic = [a for a in arabic if a not in rivals]
                latin.append(w)
            else:
                for a in rivals:
                    contested.setdefault(id(a), []).append(w)
        merged_lines.append([arabic, latin or ([] if arabic else line["words"]), top, contested])
    # Page direction, decided after junk Arabic (English misread by the ara model) is gone:
    # Latin-only rows of an Arabic table ("ALT 28 U/L 7-56") are laid out right-to-left.
    arabic_lines = sum(1 for entry in merged_lines if entry[0])
    rtl_page = arabic_lines >= 0.4 * max(1, len(merged_lines))
    if not rtl_page:
        # On an English page a contested word is English: the eng reading wins.
        for entry in merged_lines:
            arabic, latin, _top, contested = entry
            keep = []
            for a in arabic:
                if id(a) in contested:
                    latin.extend(w for w in contested[id(a)] if w not in latin)
                else:
                    keep.append(a)
            entry[0] = keep
    for arabic, latin, top, _contested in merged_lines:
        if not arabic and not latin:
            continue
        if rtl_page or len(arabic) >= len(latin):
            words = _logical_rtl(arabic + latin)
        else:
            words = sorted(latin, key=lambda w: w["box"][0])
        out.append({**_line_of(words), "top": top})
    for i, w in enumerate(eng_words):  # English text the Arabic pass did not see at all
        if i not in used:
            out.append({**_line_of([w]), "top": w["box"][1]})
    out.sort(key=lambda ln: ln["top"])
    merged: list[dict] = []
    for ln in out:  # re-join stray single English words that share a baseline
        if merged and len(ln["words"]) == 1 and not _is_arabic(ln["text"]) and                 abs(merged[-1]["top"] - ln["top"]) < ln["words"][0]["box"][3] / 2 and                 not any(_is_arabic(w["text"]) for w in merged[-1]["words"]):
            words = sorted(merged[-1]["words"] + ln["words"], key=lambda w: w["box"][0])
            merged[-1] = {**_line_of(words), "top": merged[-1]["top"]}
        else:
            merged.append(ln)
    for ln in merged:
        ln.pop("top", None)
    return merged


def run_ocr(data: bytes, content_type: str, lang: str, psm: str, mode: str = "hybrid") -> dict:
    mime = sniff(data) or content_type
    with tempfile.TemporaryDirectory(prefix="ocr-") as tmp:
        workdir = Path(tmp)
        if mime == "application/pdf":
            src = workdir / "input.pdf"
            src.write_bytes(data)
            images = pdf_to_images(src, workdir)
        elif mime in IMAGE_SUFFIX:
            src = workdir / f"input{IMAGE_SUFFIX[mime]}"
            src.write_bytes(data)
            images = [src]
        else:
            raise ValueError("unsupported_type")
        all_lines = []
        for page_no, image in enumerate(images, start=1):
            if mode == "hybrid" and "ara" in lang and "eng" in lang:
                lines = hybrid_lines(ocr_image(image, "ara", psm), ocr_image(image, "eng", psm))
            else:
                lines = ocr_image(image, lang, psm)
            for line in lines:
                all_lines.append({"page": page_no, **line})
    words = [w["conf"] for ln in all_lines for w in ln["words"]]
    return {
        "engine": "tesseract", "version": VERSION, "lang": lang, "psm": psm, "mode": mode,
        "pages": len(images),
        "text": "\n".join(ln["text"] for ln in all_lines),
        "mean_confidence": round(sum(words) / len(words), 1) if words else None,
        "lines": all_lines,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "hayat-ocr"
    sys_version = ""

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # never log request content
        sys.stderr.write(f"{self.command} {urlparse(self.path).path} {args[1] if len(args) > 1 else ''}\n")

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            return self._json(200, {"status": "ok", "engine": "tesseract", "version": VERSION})
        return self._json(404, {"error": "not_found"})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/ocr":
            return self._json(404, {"error": "not_found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return self._json(400, {"error": "empty_body"})
        if length > MAX_BYTES:
            return self._json(413, {"error": "too_large"})
        query = parse_qs(url.query)
        lang = query.get("lang", ["ara+eng"])[0]
        psm = query.get("psm", ["4"])[0]
        mode = query.get("mode", ["hybrid"])[0]
        if lang not in ALLOWED_LANGS or psm not in ALLOWED_PSM or mode not in ("hybrid", "single"):
            return self._json(400, {"error": "bad_parameters"})
        data = self.rfile.read(length)
        content_type = re.split(r"[;\s]", self.headers.get("Content-Type") or "")[0].lower()
        started = time.monotonic()
        try:
            with SLOTS:
                result = run_ocr(data, content_type, lang, psm, mode)
        except ValueError:
            return self._json(415, {"error": "unsupported_type"})
        except subprocess.TimeoutExpired:
            return self._json(504, {"error": "timeout"})
        except subprocess.CalledProcessError:
            return self._json(422, {"error": "unreadable"})
        result["duration_ms"] = int((time.monotonic() - started) * 1000)
        return self._json(200, result)


if __name__ == "__main__":
    ThreadingHTTPServer.daemon_threads = True
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)  # noqa: S104 - container only
    sys.stderr.write(f"hayat-ocr listening on :{PORT} (tesseract {VERSION})\n")
    httpd.serve_forever()
