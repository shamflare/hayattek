from django.db import models

from .ids import uuid7


class BaseModel(models.Model):
    """UUIDv7 primary key + timestamps for every HAYAT entity."""

    id = models.UUIDField(primary_key=True, default=uuid7, editable=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ("-created_at",)


class Governorate(models.TextChoices):
    RAQQA = "raqqa", "الرقة"
    DAMASCUS = "damascus", "دمشق"
    RIF_DIMASHQ = "rif_dimashq", "ريف دمشق"
    ALEPPO = "aleppo", "حلب"
    HOMS = "homs", "حمص"
    HAMA = "hama", "حماة"
    LATAKIA = "latakia", "اللاذقية"
    TARTUS = "tartus", "طرطوس"
    IDLIB = "idlib", "إدلب"
    DEIR_EZ_ZOR = "deir_ez_zor", "دير الزور"
    HASAKAH = "hasakah", "الحسكة"
    DARAA = "daraa", "درعا"
    SUWAYDA = "suwayda", "السويداء"
    QUNEITRA = "quneitra", "القنيطرة"
