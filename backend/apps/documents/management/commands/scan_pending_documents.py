from django.core.management.base import BaseCommand

from apps.documents.models import ClinicalDocument, ScanStatus
from apps.documents.scanning import get_scanner
from apps.documents.tasks import rescan_pending_documents


class Command(BaseCommand):
    help = "Scan quarantined (pending) uploads with the configured malware scanner."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=500)

    def handle(self, *args, limit, **options):
        scanner = get_scanner()
        if hasattr(scanner, "ping") and not scanner.ping():
            self.stderr.write(f"Scanner '{scanner.name}' is unreachable; files stay pending.")
            return
        done = rescan_pending_documents(limit=limit)
        left = ClinicalDocument.objects.filter(scan_status=ScanStatus.PENDING).count()
        self.stdout.write(f"scanned={done} still_pending={left}")
