/**
 * «حسابي المالي» — the doctor's postpaid wallet (read-only). Every figure comes from the
 * server ledger (`/billing/me`); the app does no money arithmetic and never shows our
 * internal provider cost or margin (the API does not expose them to doctors).
 */
import { type ReactNode } from "react";
import { View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Clock, CreditCard, Receipt, Sparkles, Wallet } from "lucide-react-native";

import { InfiniteList } from "@/components/infinite-list";
import { Screen } from "@/components/screen";
import { AppText, Badge, Card, ErrorState, Row, SectionTitle, SkeletonList } from "@/components/ui";
import { ar } from "@/i18n/ar";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api";
import { formatDate, formatDateTime, ltr } from "@/lib/format";
import { balanceLabel, formatMinutes, formatMoney, moneySign, moneyTone, PAYMENT_METHOD, TX_KIND } from "@/lib/money";
import { radius, space, useTheme } from "@/theme";

type Tx = Schemas["Transaction"];

function pageFromUrl(next: string | null | undefined): number | undefined {
  const m = next?.match(/[?&]page=(\d+)/);
  return m ? Number(m[1]) : undefined;
}

export default function WalletScreen() {
  const summary = useQuery({ queryKey: ["wallet", "me"], queryFn: () => unwrap(api.GET("/api/v1/billing/me")) });
  const txs = useInfiniteQuery({
    queryKey: ["wallet", "me", "tx"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => unwrap(api.GET("/api/v1/billing/me/transactions", { params: { query: { page: pageParam, page_size: 20 } } })),
    getNextPageParam: (last) => pageFromUrl(last.next),
  });

  if (summary.isPending) return <Screen><SkeletonList rows={4} /></Screen>;
  if (summary.isError) return <Screen><Card><ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} /></Card></Screen>;

  return (
    <InfiniteList
      testID="wallet-screen"
      query={txs}
      select={(p) => p.results}
      keyOf={(tx) => tx.id}
      header={<Summary s={summary.data} />}
      emptyTitle={ar.wallet.empty}
      emptyHint={ar.wallet.emptyHint}
      renderItem={(tx) => <TxRow tx={tx} />}
    />
  );
}

function Summary({ s }: { s: Schemas["WalletSummary"] }) {
  const t = useTheme();
  const sign = moneySign(s.balance);
  const tone = moneyTone(s.balance);
  const accent = tone === "danger" ? t.danger : tone === "success" ? t.success : t.muted;
  const soft = tone === "danger" ? t.dangerSoft : tone === "success" ? t.successSoft : t.sunken;
  return (
    <View style={{ gap: space.md, marginBottom: space.lg }}>
      <AppText variant="small" tone="muted">{ar.wallet.intro}</AppText>

      <Card testID="wallet-balance" style={{ borderColor: accent, gap: space.md }}>
        <Row gap={space.md}>
          <View style={{ width: 52, height: 52, borderRadius: radius.lg, backgroundColor: soft, alignItems: "center", justifyContent: "center" }}>
            <Wallet size={26} color={accent} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="small" tone="muted">{ar.wallet.balance}</AppText>
            <AppText testID="wallet-balance-value" variant="display" tone={tone} ltr style={{ alignSelf: "flex-start" }}>{formatMoney(s.balance, s.currency)}</AppText>
            <AppText variant="small" tone="muted">{balanceLabel(s.balance)}</AppText>
          </View>
        </Row>
        <View style={{ backgroundColor: sign === "negative" ? t.dangerSoft : t.sunken, borderRadius: radius.md, padding: space.md, flexDirection: "row", alignItems: "center" }}>
          <AppText variant="small" weight="medium" tone={sign === "negative" ? "danger" : "muted"} style={{ flex: 1 }}>
            {sign === "negative" ? ar.wallet.due : ar.wallet.noDue}
          </AppText>
          {sign === "negative" ? <AppText testID="wallet-due" variant="heading" tone="danger" ltr>{formatMoney(s.amount_due, s.currency)}</AppText> : null}
        </View>
      </Card>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
        <Kpi icon={<Sparkles size={16} color={t.primary} />} label={ar.wallet.usage} value={formatMoney(s.total_charges, s.currency)} />
        <Kpi icon={<Clock size={16} color={t.primary} />} label={ar.wallet.minutes} value={formatMinutes(s.billable_minutes)} hint={ar.wallet.sessions(s.sessions)} />
        <Kpi icon={<Receipt size={16} color={t.primary} />} label={ar.wallet.price} value={formatMoney(s.price_per_minute, s.currency, { maxFraction: 4 })} hint={s.plan_name} />
        <Kpi icon={<CreditCard size={16} color={t.primary} />} label={ar.wallet.payments} value={formatMoney(s.total_payments, s.currency)}
          hint={s.last_payment_at ? ar.wallet.lastPayment(formatDate(s.last_payment_at)) : ar.wallet.noPayments} />
      </View>

      <Row gap={space.sm} style={{ flexWrap: "wrap" }}>
        <Badge text={s.ai_enabled ? ar.wallet.aiOn : ar.wallet.aiOff} tone={s.ai_enabled ? "success" : "neutral"} />
        <AppText variant="caption" tone="muted" style={{ flex: 1 }}>{ar.wallet.controlled}</AppText>
      </Row>

      <SectionTitle title={ar.wallet.statement} />
      <AppText variant="caption" tone="muted" style={{ marginTop: -space.sm }}>{ar.wallet.statementHint}</AppText>
    </View>
  );
}

function Kpi({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card style={{ flexBasis: "47%", flexGrow: 1, padding: space.md, gap: 4 }}>
      <Row gap={6}>{icon}<AppText variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={2}>{label}</AppText></Row>
      <AppText variant="heading" weight="bold" ltr style={{ alignSelf: "flex-start" }}>{value}</AppText>
      {hint ? <AppText variant="caption" tone="subtle" numberOfLines={1}>{hint}</AppText> : null}
    </Card>
  );
}

function TxRow({ tx }: { tx: Tx }) {
  const details = [
    tx.description,
    tx.organization_name,
    tx.reference ? `${ar.wallet.reference} ${tx.reference}` : "",
    tx.created_by_name ? `${ar.wallet.by} ${tx.created_by_name}` : "",
  ].filter(Boolean).join(" · ");
  return (
    <View testID={`tx-${tx.kind}`} style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: 4, opacity: tx.is_reversed ? 0.6 : 1 }}>
      <Row gap={space.sm} align="flex-start">
        <View style={{ flex: 1, gap: 2 }}>
          <Row gap={6} style={{ flexWrap: "wrap" }}>
            <AppText variant="body" weight="semibold">{TX_KIND[tx.kind] ?? tx.kind}</AppText>
            {tx.payment_method ? <Badge text={PAYMENT_METHOD[tx.payment_method] ?? tx.payment_method} /> : null}
            {tx.is_reversed ? <Badge text={ar.wallet.reversed} tone="danger" /> : null}
          </Row>
          <AppText variant="caption" tone="muted">{formatDateTime(tx.occurred_at)}</AppText>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <AppText variant="body" weight="bold" tone={moneyTone(tx.amount)} ltr>{formatMoney(tx.amount, tx.currency, { signed: true })}</AppText>
          <AppText variant="caption" tone="subtle">{`${ar.wallet.balanceAfter}: ${ltr(formatMoney(tx.balance_after, tx.currency))}`}</AppText>
        </View>
      </Row>
      {details ? <AppText variant="caption" tone="muted">{details}</AppText> : null}
      {tx.kind === "payment" && tx.receipt_number ? (
        <AppText variant="caption" tone="primary">{`${ar.wallet.receipt}: `}<AppText variant="caption" tone="primary" ltr>{tx.receipt_number}</AppText></AppText>
      ) : null}
    </View>
  );
}
