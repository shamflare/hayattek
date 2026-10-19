"""Build a catalog import CSV from the WHO Model List of Essential Medicines (ADR-028).

    python manage.py who_eml_csv --out who_eml_catalog.csv
    python manage.py who_eml_csv --html saved_page.html --out who_eml_catalog.csv

The CSV is then uploaded by the platform administrator (preview → commit) with the source
name, date and licence text printed by this command.
"""

import urllib.request
from pathlib import Path

from django.core.management.base import BaseCommand

from apps.medications import who_eml


class Command(BaseCommand):
    help = "Download the WHO eEML and convert it to a medication catalog import CSV."

    def add_arguments(self, parser):
        parser.add_argument("--out", required=True, help="Output CSV path (UTF-8).")
        parser.add_argument("--html", help="Use a saved copy of the eEML page instead of downloading.")

    def handle(self, *args, out, html=None, **options):
        if html:
            page = Path(html).read_text(encoding="utf-8")
        else:
            request = urllib.request.Request(who_eml.SOURCE_URL, headers={"User-Agent": "hayat-catalog"})  # noqa: S310
            with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
                page = response.read().decode("utf-8")
        rows = who_eml.build_rows(page)
        Path(out).write_text(who_eml.to_csv(rows), encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(f"{len(rows)} rows → {out}"))
        self.stdout.write(f"Source name: {who_eml.SOURCE_NAME}")
        self.stdout.write(f"Source URL:  {who_eml.SOURCE_URL}")
        self.stdout.write(f"Licence:     {who_eml.LICENSE_TEXT}")
