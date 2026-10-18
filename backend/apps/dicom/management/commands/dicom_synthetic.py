from pathlib import Path

from django.core.management.base import BaseCommand

from apps.dicom.synthetic import make_series, make_zip


class Command(BaseCommand):
    help = "Write a SYNTHETIC CT-like DICOM series (ZIP, or one .dcm with --single) for demos."

    def add_arguments(self, parser):
        parser.add_argument("output")
        parser.add_argument("--slices", type=int, default=10)
        parser.add_argument("--size", type=int, default=64, help="pixels per side")
        parser.add_argument("--single", action="store_true", help="write one .dcm slice")

    def handle(self, output, slices=10, size=64, single=False, **options):
        files = make_series(slices=1 if single else slices, size=size)
        Path(output).write_bytes(files[0] if single else make_zip(files))
        self.stdout.write(f"wrote {output}")
