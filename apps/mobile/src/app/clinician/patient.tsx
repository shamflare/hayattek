import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { FilePlus2, Lock, Pill, ShieldCheck, Stethoscope, UserRound } from "lucide-react-native";

import { openRecord, RowSeparator } from "@/components/records";
import { Screen } from "@/components/screen";
import {
  AppText, Badge, Button, Card, Chips, ConfirmDialog, EmptyState, ErrorState, IconBubble, ListRow, Notice, Row, SectionTitle,
  SkeletonList, TextField,
} from "@/components/ui";
import { ar, label } from "@/i18n/ar";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api";
import { identify, useClinician } from "@/lib/clinician";
import { formatDate, formatHealthNumber, formatShortDate, rtlSafe } from "@/lib/format";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/theme";

type Scope = Schemas["ScopesEnum"];
const ALL_SCOPES: Scope[] = ["summary", "encounters", "prescriptions", "labs", "imaging", "documents", "referrals"];
const HOURS = [24, 72, 168];

export default function ClinicianPatient() {
  const t = useTheme();
  const { current, setCurrent } = useClinician();
  const { membership } = useSession();

  if (!current) {
    return <Screen><Card><EmptyState title={ar.clinician.scanTitle} hint={ar.clinician.scanHint} /></Card><Button title={ar.clinician.scan} onPress={() => router.back()} style={{ marginTop: space.lg }} /></Screen>;
  }
  const { patient, access } = current.result;

  async function refreshAccess() {
    const result = await identify(current!.identifier);
    setCurrent({ ...current!, result });
  }

  return (
    <Screen testID="clinician-patient">
      <Card>
        <Row gap={space.md} align="flex-start">
          <IconBubble><UserRound size={22} color={t.primary} /></IconBubble>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="title" style={{ fontSize: 20, lineHeight: 30 }}>{patient.full_name}</AppText>
            <AppText variant="small" tone="muted">
              {ar.clinician.age(patient.age_years)} · {label(ar.clinician.sex, patient.sex ?? "unknown")}
            </AppText>
            <AppText variant="heading" ltr style={{ letterSpacing: 1.5, alignSelf: "flex-start" }}>{formatHealthNumber(patient.health_number)}</AppText>
          </View>
        </Row>
        <Row gap={6} style={{ flexWrap: "wrap", marginTop: space.md }}>
          <Badge text={access.registered ? ar.clinician.registered : ar.clinician.notRegistered} tone={access.registered ? "success" : "neutral"} />
          <Badge text={access.can_view_clinical ? ar.clinician.canView : ar.clinician.cannotView} tone={access.can_view_clinical ? "success" : "warning"} />
        </Row>
        {access.network_scopes.length > 0 ? (
          <View style={{ marginTop: space.md }}>
            <AppText variant="caption" tone="muted">{ar.clinician.networkScopes}</AppText>
            <Row gap={6} style={{ flexWrap: "wrap", marginTop: 4 }}>
              {access.network_scopes.map((s) => <Badge key={s} text={label(ar.scopes, s)} tone="brand" />)}
            </Row>
          </View>
        ) : null}
      </Card>

      {access.can_author ? (
        <Row gap={space.sm} style={{ marginTop: space.lg }}>
          <Button title={ar.clinician.newVisit} icon={<Stethoscope size={18} color="#fff" />} onPress={() => router.push("/clinician/visit")} style={{ flex: 1 }} testID="clinician-new-visit" />
          <Button title={ar.clinician.newPrescription} variant="secondary" icon={<Pill size={18} color={t.primary} />} onPress={() => router.push("/clinician/prescribe")} style={{ flex: 1 }} testID="clinician-new-rx" />
        </Row>
      ) : null}

      {!access.can_view_clinical || access.network_scopes.length < ALL_SCOPES.length ? (
        <InPersonConsent identifier={current.identifier} orgName={membership?.organization.name ?? ""} onGranted={refreshAccess} compact={access.can_view_clinical} />
      ) : null}

      {access.can_view_clinical ? <Summary patientId={patient.id} /> : null}
    </Screen>
  );
}

function InPersonConsent({ identifier, orgName, onGranted, compact }: { identifier: { card_token: string } | { health_number: string }; orgName: string; onGranted: () => Promise<void>; compact: boolean }) {
  const t = useTheme();
  const [open, setOpen] = useState(!compact);
  const [scopes, setScopes] = useState<Scope[]>(["summary", "encounters", "prescriptions", "labs"]);
  const [hours, setHours] = useState("24");
  const [attestation, setAttestation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  function validate() {
    setError(null);
    if (scopes.length === 0) return setError(ar.consent.noScopes);
    if (attestation.trim().length < 10) return setError(ar.clinician.attestationRequired);
    setConfirm(true);
  }

  async function grant() {
    setBusy(true);
    try {
      await unwrap(api.POST("/api/v1/access/in-person", {
        body: { ...identifier, scopes, hours: Number(hours), attestation: attestation.trim() },
      }));
      setDone(ar.clinician.granted);
      setAttestation("");
      await onGranted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  if (!open) {
    return <Button title={ar.clinician.inPersonTitle} variant="outline" icon={<ShieldCheck size={18} color={t.primary} />} onPress={() => setOpen(true)} style={{ marginTop: space.lg }} />;
  }

  return (
    <>
      <SectionTitle title={ar.clinician.inPersonTitle} />
      <Card testID="in-person-consent">
        <Row gap={space.sm} align="flex-start" style={{ marginBottom: space.md }}>
          <Lock size={18} color={t.warning} />
          <AppText variant="small" tone="muted" style={{ flex: 1 }}>{ar.clinician.inPersonHint}</AppText>
        </Row>
        {done ? <Notice text={done} /> : null}
        {error ? <Notice tone="danger" text={error} /> : null}
        <AppText variant="small" weight="medium" style={{ marginBottom: 6 }}>{ar.consent.scopes}</AppText>
        <Chips
          options={ALL_SCOPES.map((s) => ({ value: s, label: ar.scopes[s] }))}
          selected={scopes}
          onToggle={(s) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))}
        />
        <AppText variant="small" weight="medium" style={{ marginTop: space.lg, marginBottom: 6 }}>{ar.clinician.hoursLabel}</AppText>
        <Chips options={HOURS.map((h) => ({ value: String(h), label: ar.consent.hours(h) }))} selected={[hours]} onToggle={setHours} />
        <View style={{ height: space.lg }} />
        <TextField
          testID="attestation"
          label={ar.clinician.attestation}
          placeholder={ar.clinician.attestationPlaceholder}
          value={attestation}
          onChangeText={setAttestation}
          multiline
          numberOfLines={3}
          style={{ minHeight: 96 }}
        />
        <Button title={ar.clinician.grant} icon={<ShieldCheck size={18} color="#fff" />} onPress={validate} testID="in-person-grant" />
      </Card>
      <ConfirmDialog
        visible={confirm}
        title={ar.clinician.inPersonTitle}
        body={`${ar.consent.approveConfirmBody(orgName)}\n${ar.consent.duration}: ${ar.consent.hours(Number(hours))}`}
        confirmLabel={ar.clinician.grant}
        loading={busy}
        onConfirm={grant}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}

function Summary({ patientId }: { patientId: string }) {
  const t = useTheme();
  const { membership } = useSession();
  const q = useQuery({
    queryKey: [`c:${membership?.id}`, "summary", patientId],
    queryFn: () => unwrap(api.GET("/api/v1/clinical/summary", { params: { query: { patient: patientId } } })),
  });

  if (q.isPending) return <View style={{ marginTop: space.lg }}><SkeletonList rows={3} /></View>;
  if (q.isError) return <Card style={{ marginTop: space.lg }}><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>;
  const s = q.data;

  return (
    <View testID="clinician-summary">
      <SectionTitle title={ar.clinician.allergies} />
      <Card style={{ borderColor: s.allergies.length ? t.danger : t.border }}>
        {s.allergies.length === 0 ? <AppText variant="small" tone="muted">{ar.clinician.allergiesEmpty}</AppText> :
          s.allergies.map((a) => (
            <View key={a.id} style={{ marginBottom: space.sm }}>
              <Row gap={6} style={{ flexWrap: "wrap" }}>
                <AppText variant="body" weight="semibold" tone="danger">{a.substance}</AppText>
                <Badge text={label(ar.allergySeverity, a.severity)} tone={a.severity === "severe" ? "danger" : "warning"} />
                {a.source === "patient" ? <Badge text={ar.record.patientEntered} tone="accent" /> : null}
              </Row>
              {a.reaction ? <AppText variant="small" tone="muted">{a.reaction}</AppText> : null}
            </View>
          ))}
      </Card>

      <SectionTitle title={ar.clinician.chronic} />
      <Card>
        {s.chronic_conditions.length === 0 ? <AppText variant="small" tone="muted">{ar.clinician.chronicEmpty}</AppText> :
          s.chronic_conditions.map((c) => (
            <View key={c.id} style={{ marginBottom: space.sm }}>
              <AppText variant="body" weight="medium">{c.display}</AppText>
              <AppText variant="caption" tone="muted">
                {c.code ? `${c.code} · ` : ""}{c.onset_date ? formatDate(c.onset_date) : ""}
              </AppText>
            </View>
          ))}
      </Card>

      <SectionTitle title={ar.clinician.currentMeds} />
      <Card>
        {s.current_medications.length === 0 ? <AppText variant="small" tone="muted">{ar.clinician.currentMedsEmpty}</AppText> :
          s.current_medications.map((m, i) => (
            <View key={`${m.prescription_id}-${i}`} style={{ marginBottom: space.sm }}>
              <AppText variant="body" weight="medium">{rtlSafe(m.name)}</AppText>
              <AppText variant="caption" tone="muted">
                {m.prescriber}{m.organization ? ` · ${m.organization}` : ""} · {m.ongoing ? ar.clinician.ongoing : m.ends_on ? `${ar.clinician.until} ${formatShortDate(m.ends_on)}` : formatShortDate(m.prescribed_at)}
              </AppText>
            </View>
          ))}
      </Card>

      {s.patient_reported.length > 0 ? (
        <>
          <SectionTitle title={ar.clinician.patientReported} />
          <Card>
            {s.patient_reported.map((r) => (
              <Row key={r.id} gap={6} style={{ marginBottom: 6, flexWrap: "wrap" }}>
                <Badge text={label(ar.reportedKinds, r.kind)} tone="accent" />
                <AppText variant="small" style={{ flex: 1 }}>{r.text}</AppText>
              </Row>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle title={ar.clinician.recentVisits} />
      <Card padded={false}>
        {s.recent_encounters.length === 0 ? <View style={{ padding: space.lg }}><AppText variant="small" tone="muted">{ar.clinician.recentVisitsEmpty}</AppText></View> :
          s.recent_encounters.map((e, i) => (
            <View key={e.id}>
              {i > 0 ? <RowSeparator /> : null}
              <ListRow
                title={e.reason || e.assessment || ar.record.encounter}
                subtitle={`${formatShortDate(e.occurred_at)} · ${[e.author_name, e.organization_name].filter(Boolean).join(" · ")}`}
                meta={e.assessment ? <AppText variant="caption" tone="muted" numberOfLines={2}>{e.assessment}</AppText> : null}
                onPress={() => openRecord("encounter", e.id)}
              />
            </View>
          ))}
      </Card>

      {s.recent_lab_reports.length > 0 ? (
        <>
          <SectionTitle title={ar.clinician.recentLabs} />
          <Card padded={false}>
            {s.recent_lab_reports.map((r, i) => (
              <View key={r.id}>
                {i > 0 ? <RowSeparator /> : null}
                <ListRow
                  title={r.title}
                  subtitle={`${formatShortDate(r.occurred_at)}${r.organization_name ? ` · ${r.organization_name}` : ""}`}
                  trailing={r.abnormal_count > 0 ? <Badge text={ar.lists.abnormal(r.abnormal_count)} tone="warning" /> : null}
                  onPress={() => openRecord("lab_report", r.id)}
                />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {s.hidden_scopes.length > 0 ? (
        <View style={{ marginTop: space.lg }}>
          <Notice tone="info" text={`${ar.clinician.hiddenScopes}: ${s.hidden_scopes.map((x) => label(ar.scopes, x)).join("، ")}`} />
        </View>
      ) : null}
      <Row gap={6} style={{ marginTop: space.md }}>
        <FilePlus2 size={14} color={t.subtle} />
        <AppText variant="caption" tone="subtle">{ar.record.clinicianVerified}</AppText>
      </Row>
    </View>
  );
}
