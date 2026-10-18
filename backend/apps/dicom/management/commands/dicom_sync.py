from django.core.management.base import BaseCommand

from apps.dicom.services import sync_pending


class Command(BaseCommand):
    help = "Push DICOM documents that are not yet in the image store (e.g. scanned clean later)."

    def add_arguments(self, parser):
        parser.add_argument("--retry-failed", action="store_true")

    def handle(self, *args, retry_failed=False, **options):
        count = sync_pending(include_failed=retry_failed)
        self.stdout.write(f"processed {count} studies")
