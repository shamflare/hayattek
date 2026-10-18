"""Synthetic development data. Refuses to run when DEBUG is off (SECURITY_MODEL §9).

All people, facilities and medicines are fictional and labelled as test data.
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.diagnostics.models import LabTestType
from apps.medications.models import CatalogSource, Medication
from apps.organizations.models import (
    Membership,
    Organization,
    OrganizationKind,
    Role,
    Subscription,
    SubscriptionPlan,
)
from apps.patients.models import PatientRegistration
from apps.practitioners.models import Practitioner

DEMO_PASSWORD = "Hayat-Demo-2026!"  # noqa: S105 — synthetic dev accounts only

LAB_TESTS = [
    ("CBC", "تعداد دم كامل", "Complete blood count", "دمويات", "دم"),
    ("FBS", "سكر صيامي", "Fasting blood glucose", "كيمياء", "مصل"),
    ("RBS", "سكر عشوائي", "Random blood glucose", "كيمياء", "مصل"),
    ("HBA1C", "خضاب سكري", "HbA1c", "كيمياء", "دم"),
    ("UREA", "بولة", "Urea", "وظائف كلية", "مصل"),
    ("CREAT", "كرياتينين", "Creatinine", "وظائف كلية", "مصل"),
    ("ALT", "ALT", "Alanine aminotransferase", "وظائف كبد", "مصل"),
    ("AST", "AST", "Aspartate aminotransferase", "وظائف كبد", "مصل"),
    ("CHOL", "كولسترول كلي", "Total cholesterol", "شحوم", "مصل"),
    ("TG", "شحوم ثلاثية", "Triglycerides", "شحوم", "مصل"),
    ("HDL", "HDL", "HDL cholesterol", "شحوم", "مصل"),
    ("LDL", "LDL", "LDL cholesterol", "شحوم", "مصل"),
    ("TSH", "TSH", "Thyroid stimulating hormone", "هرمونات", "مصل"),
    ("CRP", "CRP", "C-reactive protein", "مناعة", "مصل"),
    ("ESR", "سرعة تثفل", "Erythrocyte sedimentation rate", "دمويات", "دم"),
    ("UA", "تحليل بول", "Urinalysis", "بول", "بول"),
    ("VITD", "فيتامين د", "Vitamin D (25-OH)", "فيتامينات", "مصل"),
    ("FERR", "فيريتين", "Ferritin", "دمويات", "مصل"),
]

# Fictional catalog entries: no active ingredients are claimed (§9).
SYNTHETIC_MEDS = [
    ("دواء تجريبي — مسكن", "500 mg", "tablet", "حبة", "oral"),
    ("دواء تجريبي — مسكن شراب", "120 mg/5 ml", "syrup", "مل", "oral"),
    ("دواء تجريبي — خافض حرارة", "200 mg", "tablet", "حبة", "oral"),
    ("دواء تجريبي — مضاد حيوي A", "500 mg", "capsule", "كبسولة", "oral"),
    ("دواء تجريبي — مضاد حيوي B", "250 mg/5 ml", "suspension", "مل", "oral"),
    ("دواء تجريبي — معدي", "20 mg", "capsule", "كبسولة", "oral"),
    ("دواء تجريبي — ضغط", "5 mg", "tablet", "حبة", "oral"),
    ("دواء تجريبي — سكري", "500 mg", "tablet", "حبة", "oral"),
    ("دواء تجريبي — حساسية", "10 mg", "tablet", "حبة", "oral"),
    ("دواء تجريبي — بخاخ ربو", "100 mcg", "inhaler", "بخة", "inhalation"),
    ("دواء تجريبي — كريم جلدي", "1%", "cream", "دهنة", "topical"),
    ("دواء تجريبي — قطرة عين", "0.3%", "drops", "نقطة", "ophthalmic"),
    ("دواء تجريبي — حقنة", "1 g", "injection", "أمبولة", "im"),
    ("دواء تجريبي — فيتامين", "1000 IU", "tablet", "حبة", "oral"),
    ("دواء تجريبي — أكياس إماهة", "", "sachet", "كيس", "oral"),
]


class Command(BaseCommand):
    help = "Create synthetic demo data for local development."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_demo runs only with DEBUG=True (never in production).")
        with transaction.atomic():
            self._catalogs()
            plan, _ = SubscriptionPlan.objects.get_or_create(
                code="starter", defaults={"name": "الباقة الأساسية", "max_members": 10})
            SubscriptionPlan.objects.get_or_create(
                code="center", defaults={"name": "باقة المجمعات", "max_members": 50})

            admin = self._user("admin@hayattek.test", "مدير المنصة (تجريبي)",
                               is_platform_admin=True, is_staff=True, is_superuser=True)
            center = self._org("مجمع الرقة الطبي (تجريبي)", OrganizationKind.MEDICAL_CENTER,
                               plan, admin, address="شارع تجريبي، الرقة", phone="022-000000",
                               print_footer="هذه بيانات تجريبية لأغراض التطوير")
            clinic = self._org("عيادة د. سلمى (تجريبية)", OrganizationKind.CLINIC, plan, admin)
            lab = self._org("مختبر الفرات (تجريبي)", OrganizationKind.LABORATORY, plan, admin)

            doctor = self._user("doctor@hayattek.test", "أحمد التجريبي")
            self._practitioner(doctor, "د. أحمد التجريبي", "internal_medicine", admin)
            self._member(doctor, center, [Role.PHYSICIAN], admin, "طبيب داخلية")

            doctor2 = self._user("doctor2@hayattek.test", "سلمى التجريبية")
            self._practitioner(doctor2, "د. سلمى التجريبية", "cardiology", admin)
            self._member(doctor2, clinic, [Role.PHYSICIAN, Role.ORG_ADMIN], admin, "طبيبة قلبية")

            desk = self._user("reception@hayattek.test", "موظفة الاستقبال (تجريبي)")
            self._member(desk, center, [Role.RECEPTIONIST], admin)
            manager = self._user("manager@hayattek.test", "مدير المجمع (تجريبي)")
            self._member(manager, center, [Role.ORG_ADMIN], admin)
            labtech = self._user("lab@hayattek.test", "فني المختبر (تجريبي)")
            self._member(labtech, lab, [Role.LAB_STAFF], admin)

            patient_user = self._user("patient@hayattek.test", "مريض تجريبي")
            patient_user.phone = "+963900000001"
            patient_user.save(update_fields=["phone"])
            self._patient(patient_user, center, desk)

        self.stdout.write(self.style.SUCCESS(
            "Demo data ready. Password for every demo account: " + DEMO_PASSWORD))
        for email in ("admin", "doctor", "doctor2", "reception", "manager", "lab", "patient"):
            self.stdout.write(f"  {email}@hayattek.test")

    # ------------------------------------------------------------------ helpers
    def _catalogs(self):
        for code, ar, en, category, specimen in LAB_TESTS:
            LabTestType.objects.get_or_create(code=code, defaults={
                "name_ar": ar, "name_en": en, "category": category, "specimen": specimen})
        for name, strength, form, unit, route in SYNTHETIC_MEDS:
            Medication.objects.get_or_create(name=name, strength=strength, defaults={
                "dosage_form": form, "unit": unit, "default_route": route,
                "source": CatalogSource.SYNTHETIC_TEST, "source_reference": "seed_demo"})

    def _user(self, email, name, **extra):
        user = User.objects.filter(email=email).first()
        if user is None:
            user = User.objects.create_user(email=email, password=DEMO_PASSWORD, full_name=name,
                                            **extra)
        return user

    def _org(self, name, kind, plan, admin, **extra):
        org, created = Organization.objects.get_or_create(
            name=name, defaults={"kind": kind, "status": "active", "city": "الرقة",
                                 "created_by": admin, **extra})
        if created:
            Subscription.objects.create(organization=org, plan=plan, status="trial",
                                        starts_on=timezone.localdate())
        return org

    def _practitioner(self, user, display, specialty, admin):
        Practitioner.objects.get_or_create(user=user, defaults={
            "display_name": display, "specialty": specialty, "license_number": "DEMO-0001",
            "license_authority": "جهة تجريبية", "verification_status": "verified",
            "verified_by": admin, "verified_at": timezone.now()})

    def _member(self, user, org, roles, admin, title=""):
        Membership.objects.get_or_create(user=user, organization=org,
                                         defaults={"roles": roles, "title": title,
                                                   "added_by": admin})

    def _patient(self, user, org, desk):
        from apps.access.context import PracticeContext
        from apps.patients.models import Patient
        from apps.patients.services import create_patient

        if Patient.objects.filter(user=user).exists():
            return
        membership = Membership.objects.get(user=desk, organization=org)
        ctx = PracticeContext(user=desk, membership=membership, roles=frozenset(membership.roles))
        patient = create_patient(ctx=ctx, data={
            "first_name": "مريض", "father_name": "تجريبي", "family_name": "أول",
            "sex": "male", "birth_date": "1980-01-01", "birth_date_precision": "year",
            "phone": "+963900000001", "governorate": "raqqa", "city": "الرقة"})
        patient.user = user
        patient.save(update_fields=["user"])
        PatientRegistration.objects.filter(patient=patient, organization=org).update(
            last_visit_at=timezone.now())
