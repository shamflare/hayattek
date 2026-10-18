from decimal import Decimal

from rest_framework import serializers

from .models import (
    AIAccessEvent,
    BillingSettings,
    Currency,
    LedgerTransaction,
    PaymentMethod,
    PricingPlan,
    RoundingMode,
    TxKind,
)

MONEY = {"max_digits": 14, "decimal_places": 2}


class TransactionSerializer(serializers.ModelSerializer):
    """Statement line. Contains no patient or clinical information by design."""

    created_by_name = serializers.CharField(source="created_by.full_name", default=None,
                                            read_only=True)
    organization_name = serializers.CharField(source="organization.name", default=None,
                                              read_only=True)
    reverses_id = serializers.UUIDField(source="reverses.pk", default=None, read_only=True)
    is_reversed = serializers.SerializerMethodField()

    class Meta:
        model = LedgerTransaction
        fields = ("id", "kind", "amount", "currency", "balance_after", "occurred_at",
                  "created_at", "created_by_name", "organization_name", "description",
                  "payment_method", "reference", "receipt_number", "reverses_id", "is_reversed")

    def get_is_reversed(self, obj) -> bool:
        return hasattr(obj, "reversed_by")


class WalletSummarySerializer(serializers.Serializer):
    practitioner_id = serializers.UUIDField()
    name = serializers.CharField()
    specialty = serializers.CharField()
    currency = serializers.CharField()
    balance = serializers.DecimalField(**MONEY)
    amount_due = serializers.DecimalField(**MONEY)
    total_charges = serializers.DecimalField(**MONEY)
    total_payments = serializers.DecimalField(**MONEY)
    last_payment_at = serializers.DateTimeField(allow_null=True)
    sessions = serializers.IntegerField()
    billable_minutes = serializers.DecimalField(max_digits=12, decimal_places=2)
    price_per_minute = serializers.DecimalField(max_digits=12, decimal_places=4)
    plan_name = serializers.CharField()
    rounding_mode = serializers.CharField()
    ai_enabled = serializers.BooleanField()


class AdminWalletSummarySerializer(WalletSummarySerializer):
    provider_cost = serializers.DecimalField(**MONEY)
    margin = serializers.DecimalField(**MONEY)


class WalletRowSerializer(serializers.Serializer):
    practitioner_id = serializers.UUIDField()
    name = serializers.CharField()
    specialty = serializers.CharField()
    organizations = serializers.ListField(child=serializers.CharField())
    price_per_minute = serializers.DecimalField(max_digits=12, decimal_places=4)
    sessions = serializers.IntegerField()
    total_charges = serializers.DecimalField(**MONEY)
    total_payments = serializers.DecimalField(**MONEY)
    balance = serializers.DecimalField(**MONEY)
    debt = serializers.DecimalField(**MONEY)
    last_payment_at = serializers.DateTimeField(allow_null=True)
    ai_enabled = serializers.BooleanField()


class OverviewSerializer(serializers.Serializer):
    currency = serializers.CharField()
    total_balance = serializers.DecimalField(**MONEY)
    total_debt = serializers.DecimalField(**MONEY)
    total_collected = serializers.DecimalField(**MONEY)
    debtor_count = serializers.IntegerField()
    creditor_count = serializers.IntegerField()
    ai_revenue = serializers.DecimalField(**MONEY)
    provider_cost = serializers.DecimalField(**MONEY)
    margin = serializers.DecimalField(**MONEY)
    billed_sessions = serializers.IntegerField()
    failed_sessions = serializers.IntegerField()


class AlertSerializer(serializers.Serializer):
    kind = serializers.CharField()
    severity = serializers.CharField()
    practitioner_id = serializers.UUIDField(allow_null=True)
    message = serializers.CharField()


class PaymentInputSerializer(serializers.Serializer):
    amount = serializers.DecimalField(min_value=Decimal("0.01"), **MONEY)
    currency = serializers.ChoiceField(choices=Currency.choices, default=Currency.USD)
    paid_at = serializers.DateTimeField(required=False, allow_null=True)
    method = serializers.ChoiceField(choices=PaymentMethod.choices)
    reference = serializers.CharField(max_length=100, required=False, allow_blank=True)
    notes = serializers.CharField(max_length=300, required=False, allow_blank=True)
    idempotency_key = serializers.CharField(max_length=80, required=False, allow_blank=True,
                                            help_text="Client-generated key: retries never "
                                                      "create a second payment.")


class PaymentResultSerializer(serializers.Serializer):
    transaction = TransactionSerializer()
    balance = serializers.DecimalField(**MONEY)
    amount_due = serializers.DecimalField(**MONEY)


class AdjustmentInputSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=[
        (k, v) for k, v in TxKind.choices
        if k in ("manual_debit", "credit_grant", "charge_correction", "settlement", "refund")])
    amount = serializers.DecimalField(**MONEY)
    reason = serializers.CharField(max_length=300)


class ReversalReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300)


class PriceInputSerializer(serializers.Serializer):
    plan_id = serializers.UUIDField(required=False)
    price_per_minute = serializers.DecimalField(max_digits=12, decimal_places=4, required=False,
                                                min_value=Decimal("0"))
    rounding_mode = serializers.ChoiceField(choices=RoundingMode.choices,
                                            default=RoundingMode.CEIL_MINUTE)

    def validate(self, attrs):
        if not attrs.get("plan_id") and attrs.get("price_per_minute") is None:
            raise serializers.ValidationError("اختر خطة أو أدخل سعراً للدقيقة.")
        return attrs


class AIAccessInputSerializer(serializers.Serializer):
    enabled = serializers.BooleanField()
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True)


class AIAccessEventSerializer(serializers.ModelSerializer):
    changed_by_name = serializers.CharField(source="changed_by.full_name", default=None,
                                            read_only=True)

    class Meta:
        model = AIAccessEvent
        fields = ("id", "enabled", "reason", "changed_by_name", "created_at")


class PricingPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = PricingPlan
        fields = ("id", "code", "name", "currency", "price_per_minute", "rounding_mode",
                  "minimum_billable_seconds", "is_default", "is_active", "notes", "created_at")
        read_only_fields = ("created_at",)


class BillingSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = BillingSettings
        fields = ("doctor_debt_alert", "total_debt_alert", "monthly_provider_cost_alert",
                  "usage_spike_factor", "overdue_days", "updated_at")
        read_only_fields = ("updated_at",)


class ReceiptSerializer(serializers.Serializer):
    receipt_number = serializers.CharField()
    amount = serializers.DecimalField(**MONEY)
    currency = serializers.CharField()
    paid_at = serializers.DateTimeField()
    method = serializers.CharField()
    reference = serializers.CharField(allow_blank=True)
    notes = serializers.CharField(allow_blank=True)
    received_by = serializers.CharField(allow_null=True)
    practitioner_name = serializers.CharField()
    balance_after = serializers.DecimalField(**MONEY)
    is_reversed = serializers.BooleanField()
