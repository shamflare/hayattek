from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import SimpleRouter

from apps.access.views import FacilityAccessViewSet, FacilityGrantsListView, MySharingViewSet
from apps.accounts import views as accounts
from apps.billing import views as billing
from apps.clinical.views import (
    AllergyViewSet,
    ConditionViewSet,
    EncounterViewSet,
    PatientSummaryView,
    TimelineView,
)
from apps.diagnostics.views import (
    ImagingReportViewSet,
    LabReportViewSet,
    LabTestTypeViewSet,
    ServiceRequestViewSet,
)
from apps.documents.ocr_views import DocumentOcrConvertView, DocumentOcrRunView, DocumentOcrView
from apps.documents.views import DocumentViewSet
from apps.medications.admin_views import AdminCatalogImportViewSet, AdminMedicationViewSet
from apps.medications.views import (
    FavoriteViewSet,
    MedicationViewSet,
    PrescriptionViewSet,
    PublicPrescriptionVerifyView,
    SigPreviewView,
    TemplateViewSet,
)
from apps.notifications.views import AdminOutboundMessageViewSet, NotificationViewSet
from apps.organizations import views as orgs
from apps.organizations.join import AdminJoinRequestViewSet, PublicJoinRequestView
from apps.patients.me_views import MyPatientViewSet
from apps.patients.merge_views import PatientMergeViewSet
from apps.patients.views import PatientViewSet, PublicCardView
from apps.referrals.views import ReferralViewSet
from apps.scribe.views import ScribeSessionViewSet, ScribeStatusView

router = SimpleRouter(trailing_slash=False)
# platform administration
router.register("admin/organizations", orgs.AdminOrganizationViewSet, basename="admin-org")
router.register("admin/practitioners", orgs.AdminPractitionerViewSet, basename="admin-pract")
router.register("admin/users", orgs.AdminUserViewSet, basename="admin-user")
router.register("admin/plans", orgs.AdminPlanViewSet, basename="admin-plan")
router.register("admin/subscriptions", orgs.AdminSubscriptionViewSet, basename="admin-sub")
router.register("admin/audit", orgs.AdminAuditViewSet, basename="admin-audit")
router.register("admin/catalog/imports", AdminCatalogImportViewSet, basename="admin-cat-import")
router.register("admin/catalog/medications", AdminMedicationViewSet, basename="admin-cat-med")
router.register("admin/join-requests", AdminJoinRequestViewSet, basename="admin-join")
router.register("admin/messages", AdminOutboundMessageViewSet, basename="admin-message")
# organization self-management
router.register("org/members", orgs.OrgMemberViewSet, basename="org-member")
router.register("org/departments", orgs.OrgDepartmentViewSet, basename="org-dept")
router.register("directory/organizations", orgs.DirectoryOrganizationViewSet,
                basename="dir-org")
router.register("directory/practitioners", orgs.DirectoryPractitionerViewSet,
                basename="dir-pract")
# patients & consent
router.register("patients", PatientViewSet, basename="patient")
router.register("patient-merges", PatientMergeViewSet, basename="patient-merge")
router.register("access", FacilityAccessViewSet, basename="access")
router.register("access-grants", FacilityGrantsListView, basename="access-grant")
router.register("me/sharing", MySharingViewSet, basename="my-sharing")
router.register("me/patients", MyPatientViewSet, basename="my-patient")
# clinical records
router.register("clinical/encounters", EncounterViewSet, basename="encounter")
router.register("clinical/conditions", ConditionViewSet, basename="condition")
router.register("clinical/allergies", AllergyViewSet, basename="allergy")
router.register("medications/catalog", MedicationViewSet, basename="medication")
router.register("medications/favorites", FavoriteViewSet, basename="favorite")
router.register("medications/templates", TemplateViewSet, basename="rx-template")
router.register("prescriptions", PrescriptionViewSet, basename="prescription")
router.register("diagnostics/lab-tests", LabTestTypeViewSet, basename="lab-test")
router.register("diagnostics/requests", ServiceRequestViewSet, basename="service-request")
router.register("diagnostics/lab-reports", LabReportViewSet, basename="lab-report")
router.register("diagnostics/imaging-reports", ImagingReportViewSet, basename="imaging-report")
router.register("documents", DocumentViewSet, basename="document")
router.register("referrals", ReferralViewSet, basename="referral")
router.register("notifications", NotificationViewSet, basename="notification")
# postpaid wallets (docs/POSTPAID_WALLET.md)
router.register("billing/admin/practitioners", billing.AdminWalletViewSet, basename="billing-wallet")
router.register("billing/admin/transactions", billing.AdminTransactionViewSet, basename="billing-tx")
router.register("billing/admin/plans", billing.AdminPlanViewSet, basename="billing-plan")
router.register("billing/me/transactions", billing.MyTransactionsViewSet, basename="billing-my-tx")
# HayatTek AI scribe (docs/AI_SCRIBE.md)
router.register("scribe/sessions", ScribeSessionViewSet, basename="scribe-session")


def health(request):
    """Liveness: the process answers and the database is reachable."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    return JsonResponse({"status": "ok"})


def readiness(request):
    """Readiness for the load balancer / monitoring. Reports dependencies, never secrets."""
    from django.core.cache import cache

    checks = {}
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        checks["database"] = "ok"
    except Exception:
        checks["database"] = "down"
    try:
        cache.set("hayat:ready", "1", 5)
        checks["cache"] = "ok" if cache.get("hayat:ready") == "1" else "down"
    except Exception:
        checks["cache"] = "down"
    ok = all(v == "ok" for v in checks.values())
    return JsonResponse({"status": "ok" if ok else "degraded", "checks": checks},
                        status=200 if ok else 503)


api_v1 = [
    path("auth/csrf", accounts.CsrfView.as_view()),
    path("auth/login", accounts.LoginView.as_view()),
    path("auth/token", accounts.TokenLoginView.as_view()),
    path("auth/logout", accounts.LogoutView.as_view()),
    path("auth/me", accounts.MeView.as_view()),
    path("auth/password/change", accounts.PasswordChangeView.as_view()),
    path("auth/password/reset", accounts.PasswordResetRequestView.as_view()),
    path("auth/password/reset/confirm", accounts.PasswordResetConfirmView.as_view()),
    path("auth/mfa/setup", accounts.MfaSetupView.as_view()),
    path("auth/mfa/enable", accounts.MfaEnableView.as_view()),
    path("admin/stats", orgs.AdminStatsView.as_view()),
    path("org/profile", orgs.OrgProfileView.as_view()),
    path("clinical/summary", PatientSummaryView.as_view()),
    path("clinical/timeline", TimelineView.as_view()),
    path("medications/sig-preview", SigPreviewView.as_view()),
    path("public/cards/<str:token>", PublicCardView.as_view()),
    path("public/prescriptions/<str:code>", PublicPrescriptionVerifyView.as_view()),
    path("public/join-requests", PublicJoinRequestView.as_view()),
    path("billing/admin/overview", billing.AdminOverviewView.as_view()),
    path("billing/admin/alerts", billing.AdminAlertsView.as_view()),
    path("billing/admin/settings", billing.AdminSettingsView.as_view()),
    path("billing/admin/export.csv", billing.AdminDebtExportView.as_view()),
    path("billing/me", billing.MyWalletView.as_view()),
    path("scribe/status", ScribeStatusView.as_view()),
    path("documents/<str:pk>/ocr", DocumentOcrView.as_view()),
    path("documents/<str:pk>/ocr/run", DocumentOcrRunView.as_view()),
    path("documents/<str:pk>/ocr/convert-to-lab-report", DocumentOcrConvertView.as_view()),
    path("dicom/", include("apps.dicom.urls")),
    path("", include(router.urls)),
]

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/v1/", include(api_v1)),
    path("api/health", health),
    path("api/health/ready", readiness),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="api-docs"),
]
