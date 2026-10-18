import { useState } from "react";
import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { HeartPulse, ShieldCheck, Sun, TriangleAlert } from "lucide-react-native";

import { Screen } from "@/components/screen";
import { AppText, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Notice, Row, Skeleton, TextField } from "@/components/ui";
import { ar, label } from "@/i18n/ar";
import { errorMessage } from "@/lib/api";
import { formatDate, formatHealthNumber } from "@/lib/format";
import { useCard, useReportCardLost } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { radius, space, useTheme } from "@/theme";

export default function CardScreen() {
  const t = useTheme();
  const { me, patientId, patientName } = useSession();
  const card = useCard(patientId);
  const replace = useReportCardLost(patientId);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "danger" } | null>(null);

  const brief = me?.patient?.id === patientId ? me?.patient : me?.wards.find((w) => w.id === patientId);

  if (!patientId) {
    return <Screen><Card><EmptyState title={ar.home.noPatient} hint={ar.home.noPatientHint} /></Card></Screen>;
  }

  async function doReplace() {
    try {
      await replace.mutateAsync(reason.trim() || ar.card.reportLostDefaultReason);
      setNotice({ text: ar.card.reportLostDone, tone: "success" });
    } catch (e) {
      setNotice({ text: errorMessage(e), tone: "danger" });
    } finally {
      setConfirming(false);
      setReason("");
    }
  }

  const active = card.data?.status !== "revoked";

  return (
    <Screen refreshing={card.isRefetching} onRefresh={() => card.refetch()} testID="card-screen">
      {notice ? <Notice text={notice.text} tone={notice.tone} /> : null}

      <View style={{ backgroundColor: t.cardHero, borderRadius: radius.xl, padding: space.xl, overflow: "hidden" }}>
        <View style={{ position: "absolute", width: 220, height: 220, borderRadius: 110, backgroundColor: t.cardHeroDeep, opacity: 0.5, top: -90, start: -70 }} />
        <Row style={{ justifyContent: "space-between" }}>
          <Row gap={space.sm}>
            <HeartPulse size={24} color="#fff" />
            <AppText variant="heading" tone="onPrimary">{ar.brand.name}</AppText>
          </Row>
          {card.data ? (
            <Badge text={label(ar.card.status, card.data.status ?? "active")} tone={active ? "success" : "danger"} />
          ) : null}
        </Row>

        <View style={{ alignItems: "center", marginVertical: space.xl }}>
          <View style={{ backgroundColor: "#ffffff", padding: space.lg, borderRadius: radius.lg }} testID="card-qr">
            {card.isPending ? (
              <Skeleton width={232} height={232} />
            ) : card.isError ? (
              <View style={{ width: 232, height: 232, alignItems: "center", justifyContent: "center" }}>
                <TriangleAlert size={40} color={t.danger} />
              </View>
            ) : (
              <View style={{ opacity: active ? 1 : 0.25 }}>
                {/* QR always dark-on-white for scanner contrast, also in dark mode. */}
                <QRCode value={card.data.qr_url} size={232} color="#0f1f1d" backgroundColor="#ffffff" ecl="M" />
              </View>
            )}
          </View>
        </View>

        <AppText variant="caption" tone="onPrimary" style={{ opacity: 0.8 }}>{ar.home.healthNumber}</AppText>
        <AppText variant="display" tone="onPrimary" ltr style={{ letterSpacing: 3, textAlign: "center" }} testID="card-health-number">
          {formatHealthNumber(brief?.health_number)}
        </AppText>
        <AppText variant="heading" tone="onPrimary" center style={{ marginTop: space.xs }}>{patientName ?? brief?.full_name}</AppText>
      </View>

      {card.isError ? (
        <Card style={{ marginTop: space.lg }}><ErrorState message={errorMessage(card.error)} onRetry={() => card.refetch()} /></Card>
      ) : null}

      {card.data && !active ? <View style={{ marginTop: space.lg }}><Notice tone="danger" text={ar.card.revoked} /></View> : null}

      <Card style={{ marginTop: space.lg, gap: space.md }}>
        <AppText variant="body" weight="semibold">{ar.card.subtitle}</AppText>
        <Row gap={space.sm} align="flex-start">
          <Sun size={20} color={t.warning} />
          <AppText variant="small" tone="muted" style={{ flex: 1 }}>{ar.card.brightness}</AppText>
        </Row>
        <Row gap={space.sm} align="flex-start">
          <ShieldCheck size={20} color={t.primary} />
          <AppText variant="small" tone="muted" style={{ flex: 1 }}>{ar.card.privacy}</AppText>
        </Row>
        {card.data ? (
          <AppText variant="caption" tone="subtle">{ar.card.issuedAt}: {formatDate(card.data.created_at)}</AppText>
        ) : null}
      </Card>

      <Button
        title={ar.card.reportLost}
        variant="outline"
        icon={<TriangleAlert size={18} color={t.danger} />}
        onPress={() => setConfirming(true)}
        style={{ marginTop: space.lg }}
        disabled={!card.data}
        testID="card-report-lost"
      />

      <ConfirmDialog
        visible={confirming}
        title={ar.card.reportLostTitle}
        body={ar.card.reportLostBody}
        destructive
        loading={replace.isPending}
        confirmLabel={ar.common.confirm}
        onConfirm={doReplace}
        onCancel={() => setConfirming(false)}
      >
        <TextField label={ar.card.reportLostReason} value={reason} onChangeText={setReason} placeholder={ar.card.reportLostDefaultReason} />
      </ConfirmDialog>
    </Screen>
  );
}
