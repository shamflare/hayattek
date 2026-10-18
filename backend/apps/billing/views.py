"""Wallet API. Admin endpoints require `is_platform_admin`; doctors only read their own wallet.
Facility admins have no access to doctors' finances (no explicit delegation exists yet)."""

import csv

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.access.context import IsPlatformAdmin
from apps.core.exceptions import DomainError
from apps.core.pagination import StandardPagination
from apps.practitioners.models import Practitioner

from . import reports, services
from .models import AIAccessEvent, BillingSettings, LedgerTransaction, PricingPlan, TxKind
from .serializers import (
    AdjustmentInputSerializer,
    AdminWalletSummarySerializer,
    AIAccessEventSerializer,
    AIAccessInputSerializer,
    AlertSerializer,
    BillingSettingsSerializer,
    OverviewSerializer,
    PaymentInputSerializer,
    PaymentResultSerializer,
    PriceInputSerializer,
    PricingPlanSerializer,
    ReasonSerializer,
    ReceiptSerializer,
    TransactionSerializer,
    WalletRowSerializer,
    WalletSummarySerializer,
)


def _practitioner(pk) -> Practitioner:
    return get_object_or_404(Practitioner, pk=pk)


def _receipt(tx: LedgerTransaction) -> dict:
    if tx.kind != TxKind.PAYMENT:
        raise DomainError(_("هذه العملية ليست دفعة."), code="not_a_payment", status_code=404)
    owner = tx.wallet.practitioner or tx.wallet.organization
    return {
        "receipt_number": tx.receipt_number, "amount": tx.amount, "currency": tx.currency,
        "paid_at": tx.occurred_at, "method": tx.payment_method, "reference": tx.reference,
        "notes": tx.description, "received_by": tx.created_by.full_name if tx.created_by else None,
        "practitioner_name": getattr(owner, "display_name", None) or getattr(owner, "name", ""),
        "balance_after": tx.balance_after, "is_reversed": hasattr(tx, "reversed_by"),
    }


class AdminWalletViewSet(viewsets.GenericViewSet):
    """`/billing/admin/practitioners/{practitioner_id}/…` — one doctor's wallet."""

    permission_classes = [IsPlatformAdmin]
    queryset = Practitioner.objects.none()
    lookup_value_regex = "[0-9a-f-]{36}"
    pagination_class = None  # the doctor list is a plain array; statements paginate explicitly

    @extend_schema(parameters=[OpenApiParameter("q", str), OpenApiParameter("status", str),
                               OpenApiParameter("ai", str), OpenApiParameter("ordering", str)],
                   responses=WalletRowSerializer(many=True))
    def list(self, request):
        p = request.query_params
        rows = reports.practitioner_rows(q=p.get("q", ""), status=p.get("status", ""),
                                         ai=p.get("ai", ""), ordering=p.get("ordering", ""))
        return Response(WalletRowSerializer(rows, many=True).data)

    @extend_schema(responses=AdminWalletSummarySerializer)
    def retrieve(self, request, pk=None):
        practitioner = _practitioner(pk)
        wallet = practitioner.wallets.filter(owner_type="practitioner").first()
        return Response(AdminWalletSummarySerializer(
            reports.wallet_summary(wallet, practitioner, include_internal=True)).data)

    @extend_schema(responses=TransactionSerializer(many=True))
    @action(detail=True, methods=["get"], pagination_class=StandardPagination)
    def transactions(self, request, pk=None):
        wallet = services.practitioner_wallet(_practitioner(pk))
        qs = wallet.transactions.select_related("created_by", "organization", "reverses",
                                                "reversed_by").order_by("-created_at")
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        return paginator.get_paginated_response(TransactionSerializer(page, many=True).data)

    @extend_schema(request=PaymentInputSerializer, responses={201: PaymentResultSerializer})
    @action(detail=True, methods=["post"])
    def payments(self, request, pk=None):
        practitioner = _practitioner(pk)
        data = PaymentInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        wallet = services.practitioner_wallet(practitioner, v["currency"])
        key = v.get("idempotency_key")
        tx = services.record_payment(
            wallet, amount=v["amount"], currency=v["currency"], paid_at=v.get("paid_at"),
            method=v["method"], reference=v.get("reference", ""), notes=v.get("notes", ""),
            actor=request.user, request=request,
            idempotency_key=f"payment:{wallet.pk}:{key}" if key else None)
        wallet.refresh_from_db()
        due = -wallet.balance if wallet.balance < 0 else 0
        return Response({"transaction": TransactionSerializer(tx).data, "balance": wallet.balance,
                         "amount_due": due}, status=status.HTTP_201_CREATED)

    @extend_schema(request=AdjustmentInputSerializer, responses={201: TransactionSerializer})
    @action(detail=True, methods=["post"])
    def adjustments(self, request, pk=None):
        data = AdjustmentInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        wallet = services.practitioner_wallet(_practitioner(pk))
        tx = services.adjust(wallet, actor=request.user, request=request, **data.validated_data)
        return Response(TransactionSerializer(tx).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=PriceInputSerializer, responses=AdminWalletSummarySerializer)
    @action(detail=True, methods=["post"])
    def price(self, request, pk=None):
        practitioner = _practitioner(pk)
        data = PriceInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        if v.get("plan_id"):
            plan = get_object_or_404(PricingPlan, pk=v["plan_id"], is_active=True)
            services.assign_plan(practitioner, plan, actor=request.user, request=request)
        else:
            services.set_custom_rate(practitioner, v["price_per_minute"], actor=request.user,
                                     rounding_mode=v["rounding_mode"], request=request)
        wallet = practitioner.wallets.filter(owner_type="practitioner").first()
        return Response(AdminWalletSummarySerializer(
            reports.wallet_summary(wallet, practitioner, include_internal=True)).data)

    @extend_schema(request=AIAccessInputSerializer, responses=AdminWalletSummarySerializer)
    @action(detail=True, methods=["post"], url_path="ai-access")
    def ai_access(self, request, pk=None):
        practitioner = _practitioner(pk)
        data = AIAccessInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        services.set_ai_access(practitioner, actor=request.user, request=request,
                               **data.validated_data)
        wallet = practitioner.wallets.filter(owner_type="practitioner").first()
        return Response(AdminWalletSummarySerializer(
            reports.wallet_summary(wallet, practitioner, include_internal=True)).data)

    @extend_schema(responses=AIAccessEventSerializer(many=True))
    @action(detail=True, methods=["get"], url_path="ai-access-events", pagination_class=None)
    def ai_access_events(self, request, pk=None):
        events = AIAccessEvent.objects.filter(practitioner=_practitioner(pk)).select_related(
            "changed_by").order_by("-created_at")[:50]
        return Response(AIAccessEventSerializer(events, many=True).data)


class AdminTransactionViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsPlatformAdmin]
    serializer_class = TransactionSerializer
    queryset = LedgerTransaction.objects.select_related("wallet", "created_by", "organization")

    @extend_schema(request=ReasonSerializer, responses={201: TransactionSerializer})
    @action(detail=True, methods=["post"])
    def reverse(self, request, pk=None):
        data = ReasonSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        tx = services.reverse_transaction(self.get_object(), reason=data.validated_data["reason"],
                                          actor=request.user, request=request)
        return Response(TransactionSerializer(tx).data, status=status.HTTP_201_CREATED)

    @extend_schema(responses=ReceiptSerializer)
    @action(detail=True, methods=["get"])
    def receipt(self, request, pk=None):
        return Response(ReceiptSerializer(_receipt(self.get_object())).data)


class AdminPlanViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.UpdateModelMixin,
                       viewsets.GenericViewSet):
    """Plans can be created and edited (editing never changes past usage) but not deleted."""

    permission_classes = [IsPlatformAdmin]
    serializer_class = PricingPlanSerializer
    queryset = PricingPlan.objects.all()
    pagination_class = None
    http_method_names = ["get", "post", "patch", "head", "options"]

    def perform_create(self, serializer):
        if serializer.validated_data.get("is_default"):
            PricingPlan.objects.filter(is_default=True).update(is_default=False)
        serializer.save()

    def perform_update(self, serializer):
        if serializer.validated_data.get("is_default"):
            PricingPlan.objects.filter(is_default=True).exclude(pk=serializer.instance.pk).update(
                is_default=False)
        serializer.save()


class AdminOverviewView(APIView):
    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses=OverviewSerializer)
    def get(self, request):
        return Response(OverviewSerializer(reports.overview()).data)


class AdminAlertsView(APIView):
    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses=AlertSerializer(many=True))
    def get(self, request):
        return Response(AlertSerializer(reports.alerts(), many=True).data)


class AdminSettingsView(APIView):
    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses=BillingSettingsSerializer)
    def get(self, request):
        return Response(BillingSettingsSerializer(BillingSettings.load()).data)

    @extend_schema(request=BillingSettingsSerializer, responses=BillingSettingsSerializer)
    def patch(self, request):
        serializer = BillingSettingsSerializer(BillingSettings.load(), data=request.data,
                                               partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class AdminDebtExportView(APIView):
    """CSV of doctors' balances (no patient or clinical data). PDF = printable web page."""

    permission_classes = [IsPlatformAdmin]

    @extend_schema(responses={(200, "text/csv"): bytes})
    def get(self, request):
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="hayattek-doctor-balances.csv"'
        response.write("﻿")  # Excel-friendly UTF-8 BOM for Arabic
        writer = csv.writer(response)
        writer.writerow(["الطبيب", "الاختصاص", "المنشآت", "سعر الدقيقة", "الجلسات",
                         "إجمالي الرسوم", "إجمالي المدفوعات", "الرصيد", "الدين", "آخر دفعة",
                         "المساعد الذكي"])
        for r in reports.practitioner_rows(ordering="-debt"):
            writer.writerow([r["name"], r["specialty"], "، ".join(r["organizations"]),
                             r["price_per_minute"], r["sessions"], r["total_charges"],
                             r["total_payments"], r["balance"], r["debt"],
                             r["last_payment_at"].date().isoformat() if r["last_payment_at"] else "",
                             "مفعل" if r["ai_enabled"] else "موقوف"])
        return response


# ------------------------------------------------------------------ doctor self-service


def _own_practitioner(request) -> Practitioner:
    practitioner = getattr(request.user, "practitioner", None)
    if practitioner is None:
        raise DomainError(_("هذه الصفحة للأطباء فقط."), code="not_practitioner", status_code=403)
    return practitioner


class MyWalletView(APIView):
    @extend_schema(responses=WalletSummarySerializer)
    def get(self, request):
        practitioner = _own_practitioner(request)
        wallet = practitioner.wallets.filter(owner_type="practitioner").first()
        return Response(WalletSummarySerializer(
            reports.wallet_summary(wallet, practitioner, include_internal=False)).data)


class MyTransactionsViewSet(viewsets.GenericViewSet):
    serializer_class = TransactionSerializer
    queryset = LedgerTransaction.objects.none()

    def list(self, request):
        wallet = services.practitioner_wallet(_own_practitioner(request))
        qs = wallet.transactions.select_related("created_by", "organization", "reverses",
                                                "reversed_by").order_by("-created_at")
        page = self.paginate_queryset(qs)
        return self.get_paginated_response(TransactionSerializer(page, many=True).data)

    @extend_schema(responses=ReceiptSerializer)
    @action(detail=True, methods=["get"])
    def receipt(self, request, pk=None):
        practitioner = _own_practitioner(request)
        tx = get_object_or_404(LedgerTransaction, pk=pk, wallet__practitioner=practitioner)
        return Response(ReceiptSerializer(_receipt(tx)).data)
