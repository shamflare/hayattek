import { useState } from "react";
import { Pressable, View } from "react-native";
import { Building2, Eye, ShieldCheck, ShieldOff, UserRound } from "lucide-react-native";

import { RowSeparator } from "@/components/records";
import { Screen } from "@/components/screen";
import {
  AppText, Badge, Button, Card, CheckRow, ConfirmDialog, EmptyState, ErrorState, IconBubble, Notice, Row, SkeletonList,
} from "@/components/ui";
import { ar, label } from "@/i18n/ar";
import { errorMessage, type Schemas } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useAccessLog, useAccessRequests, useDecideRequest, useGrants, useRevokeGrant } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { radius, space, useTheme } from "@/theme";

type Segment = "requests" | "grants" | "log";
type Feedback = { text: string; tone: "success" | "danger" } | null;

export default function ConsentScreen() {
  const [segment, setSegment] = useState<Segment>("requests");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const requests = useAccessRequests();
  const grants = useGrants();
  const { patientId } = useSession();
  const log = useAccessLog(patientId);

  const pending = requests.data?.filter((r) => r.status === "pending") ?? [];
  const active = grants.data?.results.filter((g) => g.is_effective && !g.revoked_at) ?? [];

  const refreshing = requests.isRefetching || grants.isRefetching || log.isRefetching;
  const refresh = () => {
    void requests.refetch();
    void grants.refetch();
    void log.refetch();
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} testID="consent-screen">
      <SegmentBar
        value={segment}
        onChange={(s) => { setSegment(s); setFeedback(null); }}
        items={[
          { value: "requests", label: ar.consent.segRequests, count: pending.length },
          { value: "grants", label: ar.consent.segGrants, count: active.length },
          { value: "log", label: ar.consent.segLog },
        ]}
      />
      {feedback ? <Notice text={feedback.text} tone={feedback.tone} /> : null}

      {segment === "requests" ? (
        requests.isPending ? <SkeletonList rows={2} /> :
        requests.isError ? <Card><ErrorState message={errorMessage(requests.error)} onRetry={() => requests.refetch()} /></Card> :
        pending.length === 0 ? <Card><EmptyState icon={<ShieldCheck size={28} color="#1f9e8f" />} title={ar.consent.pendingEmpty} /></Card> :
        <View style={{ gap: space.lg }}>
          {pending.map((r) => <RequestCard key={r.id} request={r} onDone={setFeedback} />)}
        </View>
      ) : null}

      {segment === "grants" ? (
        grants.isPending ? <SkeletonList rows={2} /> :
        grants.isError ? <Card><ErrorState message={errorMessage(grants.error)} onRetry={() => grants.refetch()} /></Card> :
        active.length === 0 ? <Card><EmptyState icon={<ShieldCheck size={28} color="#1f9e8f" />} title={ar.consent.activeEmpty} /></Card> :
        <View style={{ gap: space.md }}>
          {active.map((g) => <GrantCard key={g.id} grant={g} onDone={setFeedback} />)}
        </View>
      ) : null}

      {segment === "log" ? (
        log.isPending ? <SkeletonList rows={4} /> :
        log.isError ? <Card><ErrorState message={errorMessage(log.error)} onRetry={() => log.refetch()} /></Card> :
        (log.data?.results.length ?? 0) === 0 ? <Card><EmptyState icon={<Eye size={28} color="#1f9e8f" />} title={ar.consent.logEmpty} /></Card> :
        <>
          <AppText variant="small" tone="muted" style={{ marginBottom: space.sm }}>{ar.consent.logHint}</AppText>
          <Card padded={false}>
            {log.data!.results.map((e, i) => (
              <View key={`${e.occurred_at}-${i}`}>
                {i > 0 ? <RowSeparator /> : null}
                <LogRow entry={e} />
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function SegmentBar({ value, onChange, items }: { value: Segment; onChange: (s: Segment) => void; items: { value: Segment; label: string; count?: number }[] }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", backgroundColor: t.sunken, borderRadius: radius.md, padding: 4, marginBottom: space.lg, gap: 4 }}>
      {items.map((it) => {
        const on = it.value === value;
        return (
          <Pressable
            key={it.value}
            testID={`segment-${it.value}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(it.value)}
            style={{ flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: on ? t.elevated : "transparent", flexDirection: "row", gap: 4, paddingHorizontal: 4 }}
          >
            <AppText variant="small" weight={on ? "semibold" : "regular"} tone={on ? "primary" : "muted"} numberOfLines={1}>{it.label}</AppText>
            {it.count ? (
              <View style={{ backgroundColor: it.value === "requests" ? t.accent : t.primary, borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                <AppText variant="caption" tone="onPrimary" weight="bold" style={{ fontSize: 11, lineHeight: 16 }}>{it.count}</AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function RequestCard({ request, onDone }: { request: Schemas["AccessRequest"]; onDone: (f: Feedback) => void }) {
  const t = useTheme();
  const decide = useDecideRequest();
  const [scopes, setScopes] = useState<Schemas["ScopesEnum"][]>(request.scopes);
  const [confirm, setConfirm] = useState<"approve" | "deny" | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  function toggle(s: Schemas["ScopesEnum"]) {
    setLocalError(null);
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  async function run(approve: boolean) {
    try {
      await decide.mutateAsync({ id: request.id, approve, scopes });
      onDone({ text: approve ? ar.consent.approved : ar.consent.denied, tone: "success" });
    } catch (e) {
      onDone({ text: errorMessage(e), tone: "danger" });
    } finally {
      setConfirm(null);
    }
  }

  return (
    <Card testID="access-request-card" style={{ borderColor: t.accent, borderWidth: 1.5 }}>
      <Row gap={space.md} align="flex-start">
        <IconBubble tone="accent"><Building2 size={22} color={t.accent} /></IconBubble>
        <View style={{ flex: 1 }}>
          <AppText variant="caption" tone="muted">{ar.consent.requestedBy}</AppText>
          <AppText variant="heading">{request.organization_name}</AppText>
          {request.practitioner_name ? (
            <Row gap={4}><UserRound size={14} color={t.muted} /><AppText variant="small" tone="muted">{request.practitioner_name}</AppText></Row>
          ) : null}
        </View>
      </Row>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md }}>
        {request.purpose ? <Badge text={`${ar.consent.purpose}: ${label(ar.purposes, request.purpose)}`} tone="brand" /> : null}
        {request.duration_hours ? <Badge text={`${ar.consent.duration}: ${ar.consent.hours(request.duration_hours)}`} tone="info" /> : null}
      </View>
      {request.note ? (
        <View style={{ marginTop: space.md, backgroundColor: t.sunken, borderRadius: radius.md, padding: space.md }}>
          <AppText variant="caption" tone="muted">{ar.consent.note}</AppText>
          <AppText variant="small">{request.note}</AppText>
        </View>
      ) : null}

      <AppText variant="body" weight="semibold" style={{ marginTop: space.lg }}>{ar.consent.scopes}</AppText>
      <AppText variant="caption" tone="muted" style={{ marginBottom: space.xs }}>{ar.consent.scopesHint}</AppText>
      {request.scopes.map((s) => (
        <CheckRow key={s} testID={`scope-${s}`} checked={scopes.includes(s)} onToggle={() => toggle(s)} title={label(ar.scopes, s)} subtitle={ar.scopeHints[s]} />
      ))}
      {localError ? <Notice tone="danger" text={localError} /> : null}
      <AppText variant="caption" tone="subtle" style={{ marginTop: space.sm }}>{ar.consent.decideBefore}: {formatDateTime(request.expires_at)}</AppText>

      <Row gap={space.sm} style={{ marginTop: space.md }}>
        <Button
          title={ar.consent.approve}
          style={{ flex: 1 }}
          testID="request-approve"
          onPress={() => (scopes.length === 0 ? setLocalError(ar.consent.noScopes) : setConfirm("approve"))}
        />
        <Button title={ar.consent.deny} variant="outline" style={{ flex: 1 }} onPress={() => setConfirm("deny")} testID="request-deny" />
      </Row>

      <ConfirmDialog
        visible={confirm !== null}
        title={confirm === "approve" ? ar.consent.approveConfirmTitle : ar.consent.denyConfirmTitle}
        body={confirm === "approve" ? ar.consent.approveConfirmBody(request.organization_name) : ar.consent.denyConfirmBody}
        destructive={confirm === "deny"}
        confirmLabel={confirm === "approve" ? ar.consent.approve : ar.consent.deny}
        loading={decide.isPending}
        onConfirm={() => run(confirm === "approve")}
        onCancel={() => setConfirm(null)}
      >
        {confirm === "approve" ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {scopes.map((s) => <Badge key={s} text={label(ar.scopes, s)} tone="brand" />)}
          </View>
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}

function GrantCard({ grant, onDone }: { grant: Schemas["Grant"]; onDone: (f: Feedback) => void }) {
  const t = useTheme();
  const revoke = useRevokeGrant();
  const [confirm, setConfirm] = useState(false);

  async function run() {
    try {
      await revoke.mutateAsync(grant.id);
      onDone({ text: ar.consent.revoked, tone: "success" });
    } catch (e) {
      onDone({ text: errorMessage(e), tone: "danger" });
    } finally {
      setConfirm(false);
    }
  }

  return (
    <Card testID="grant-card">
      <Row gap={space.md} align="flex-start">
        <IconBubble tone="success"><ShieldCheck size={22} color={t.success} /></IconBubble>
        <View style={{ flex: 1 }}>
          <AppText variant="heading">{grant.organization_name}</AppText>
          <AppText variant="small" tone="muted">{grant.practitioner_name || ar.consent.anyClinician}</AppText>
          <AppText variant="caption" tone="subtle">{ar.consent.forPatient}: {grant.patient_name}</AppText>
        </View>
      </Row>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: space.md }}>
        {grant.scopes.map((s) => <Badge key={s} text={label(ar.scopes, s)} tone="brand" />)}
      </View>
      <AppText variant="caption" tone="muted" style={{ marginTop: space.sm }}>
        {ar.consent.method}: {label(ar.grantMethods, grant.method)} · {ar.consent.expiresAt}: {formatDateTime(grant.expires_at)}
      </AppText>
      <Button
        title={ar.consent.revoke}
        variant="outline"
        icon={<ShieldOff size={18} color={t.danger} />}
        onPress={() => setConfirm(true)}
        style={{ marginTop: space.md }}
        testID="grant-revoke"
      />
      <ConfirmDialog
        visible={confirm}
        title={ar.consent.revokeConfirmTitle}
        body={ar.consent.revokeConfirmBody(grant.organization_name)}
        destructive
        confirmLabel={ar.consent.revoke}
        loading={revoke.isPending}
        onConfirm={run}
        onCancel={() => setConfirm(false)}
      />
    </Card>
  );
}

function LogRow({ entry }: { entry: Schemas["AccessLogEntry"] }) {
  const denied = entry.outcome !== "success";
  return (
    <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: 2 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <AppText variant="body" weight="medium" style={{ flex: 1 }}>{label(ar.auditActions, entry.action)}</AppText>
        {denied ? <Badge text={label(ar.consent.outcome, entry.outcome)} tone="danger" /> : null}
      </Row>
      <AppText variant="small" tone="muted">
        {[entry.actor_name, entry.organization_name].filter(Boolean).join(" · ") || ar.common.unknown}
      </AppText>
      <AppText variant="caption" tone="subtle">{formatDateTime(entry.occurred_at)}</AppText>
    </View>
  );
}
