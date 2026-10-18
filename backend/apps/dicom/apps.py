from django.apps import AppConfig


class DicomConfig(AppConfig):
    name = "apps.dicom"
    label = "dicom"
    verbose_name = "DICOM"

    def ready(self) -> None:
        from . import signals  # noqa: F401
