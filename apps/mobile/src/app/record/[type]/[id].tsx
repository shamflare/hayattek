import { useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { ExternalLink, Info, UserRound } from "lucide-react-native";

import { openRecord, RecordIcon, RowSeparator } from "@/components/records";
import { Screen } from "@/components/screen";
import {
  AppText, Badge, Button, Card, EmptyState, ErrorState, Field, ListRow, Notice, Row, SectionTitle, SkeletonList, statusTone,
  type BadgeTone,
} from "@/components/ui";
import { ar, label } from "@/i18n/ar";
import { errorMessage, type Schemas } from "@/lib/api";
import { formatBytes, formatDate, formatDateTime, formatDecimal } from "@/lib/format";
import { openDocument } from "@/lib/open-document";
import { DETAIL_TYPES, useRecord, type AnyRecord, type RecordType } from "@/lib/queries";
import { radius, space, useTheme } from "@/theme";

export default function RecordDetailScreen() {
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>();
  const q = useRecord(type, id);
  const title = DETAIL_TYPES.includes(type as RecordType) ? ar.record[type as RecordType] : ar.common.viewDetails;

  return (
    <>
      <Stack.Screen options={{ title }} />
      {!DETAIL_TYPES.includes(type as RecordType) ? (
        <Screen><Card><EmptyState title={ar.common.soon} hint={ar.timeline.detailUnsupported} /></Card></Screen>
      ) : q.isPending ? (
        <Screen><SkeletonList rows={3} /></Screen>
      ) : q.isError ? (
        <Screen><Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card></Screen>
      ) : (
        <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()} testID="record-detail">
          <RecordBody record={q.data} />
        </Screen>
      )}
    </>
  );
}

type Provenance = Schemas["Encounter"];

function ProvenanceHeader({ type, rec, title }: { type: string; rec: Pick<Provenance, "status" | "source" | "author_name" | "organization_name" | "occurred_at" | "version" | "amended_at" | "status_reason">; title: string }) {
  const patientEntered = rec.source === "patient";
  return (
    <Card>
      <Row gap={space.md} align="flex-start">
        <RecordIcon type={type} />
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="title" style={{ fontSize: 20, lineHeight: 30 }}>{title}</AppText>
          <Row gap={6} style={{ flexWrap: "wrap" }}>
            <Badge text={label(ar.recordStatus, rec.status)} tone={statusTone(rec.status)} />
            <Badge text={patientEntered ? ar.record.patientEntered : label(ar.recordSource, rec.source)} tone={patientEntered ? "accent" : "brand"} />
          </Row>
        </View>
      </Row>
      <View style={{ marginTop: space.lg, gap: space.sm }}>
        <Row gap={space.sm}>
          <UserRound size={16} color="#7c8b88" />
          <AppText variant="small" tone="muted" style={{ flex: 1 }}>
            {[rec.author_name, rec.organization_name].filter(Boolean).join(" · ") || ar.common.unknown}
          </AppText>
        </Row>
        <AppText variant="small" tone="muted">{ar.record.date}: {formatDateTime(rec.occurred_at)}</AppText>
        {rec.version > 1 || rec.amended_at ? (
          <AppText variant="small" tone="muted">{ar.record.version} {rec.version}{rec.amended_at ? ` · ${ar.record.amendedAt}: ${formatDate(rec.amended_at)}` : ""}</AppText>
        ) : null}
      </View>
      {rec.status_reason ? <View style={{ marginTop: space.md }}><Notice tone={rec.status === "entered_in_error" ? "danger" : "info"} text={`${ar.record.statusReason}: ${rec.status_reason}`} /></View> : null}
    </Card>
  );
}

function RecordBody({ record }: { record: AnyRecord }) {
  switch (record.type) {
    case "encounter": return <EncounterView e={record.data} />;
    case "prescription": return <PrescriptionView rx={record.data} />;
    case "lab_report": return <LabView r={record.data} />;
    case "imaging_report": return <ImagingView r={record.data} />;
    default: return <DocumentView d={record.data} />;
  }
}

function EncounterView({ e }: { e: Schemas["Encounter"] }) {
  const vitals = e.vitals && typeof e.vitals === "object" ? Object.entries(e.vitals as Record<string, unknown>).filter(([, v]) => v !== null && v !== "") : [];
  return (
    <>
      <ProvenanceHeader type="encounter" rec={e} title={e.reason || label(ar.encounterTypes, e.encounter_type)} />
      <Card style={{ marginTop: space.lg }}>
        <Field label={ar.record.reason} value={e.reason ? `${e.reason} (${label(ar.encounterTypes, e.encounter_type)})` : label(ar.encounterTypes, e.encounter_type)} />
        <Field label={ar.record.complaint} value={e.complaint} multiline />
        <Field label={ar.record.history} value={e.history} multiline />
        <Field label={ar.record.examination} value={e.examination} multiline />
        <Field label={ar.record.assessment} value={e.assessment} multiline />
        <Field label={ar.record.plan} value={e.plan} multiline />
        <Field label={ar.record.notes} value={e.notes} multiline />
        <Field label={ar.record.followUp} value={e.follow_up_date ? `${formatDate(e.follow_up_date)}${e.follow_up_note ? ` — ${e.follow_up_note}` : ""}` : null} />
        {vitals.length > 0 ? (
          <>
            <AppText variant="caption" tone="muted" weight="medium">{ar.record.vitals}</AppText>
            <Row gap={6} style={{ flexWrap: "wrap", marginTop: 4 }}>
              {vitals.map(([k, v]) => <Badge key={k} text={`${k}: ${String(v)}`} tone="neutral" />)}
            </Row>
          </>
        ) : null}
      </Card>
      {e.conditions.length > 0 ? (
        <>
          <SectionTitle title={ar.record.diagnoses} />
          <Card>
            {e.conditions.map((c) => (
              <View key={c.id} style={{ marginBottom: space.sm }}>
                <AppText variant="body" weight="medium">{c.display}</AppText>
                {c.code ? <AppText variant="caption" tone="muted" ltr>{c.code_system} {c.code}</AppText> : null}
              </View>
            ))}
          </Card>
        </>
      ) : null}
      {e.prescriptions.length > 0 ? (
        <>
          <SectionTitle title={ar.record.linkedPrescriptions} />
          <Card padded={false}>
            {e.prescriptions.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <RowSeparator /> : null}
                <ListRow title={`${ar.record.prescription} ${p.number}`} leading={<RecordIcon type="prescription" />} onPress={() => openRecord("prescription", p.id)} />
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}

function PrescriptionView({ rx }: { rx: Schemas["Prescription"] }) {
  const t = useTheme();
  return (
    <>
      <ProvenanceHeader type="prescription" rec={rx} title={`${ar.record.prescription} ${rx.number}`} />
      {rx.diagnosis_text ? <Card style={{ marginTop: space.lg }}><Field label={ar.record.diagnosis} value={rx.diagnosis_text} /></Card> : null}
      <SectionTitle title={ar.record.items} />
      <View style={{ gap: space.md }}>
        {rx.items.map((item, i) => (
          <Card key={item.id} testID="rx-item">
            <Row gap={space.sm} align="flex-start">
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
                <AppText variant="small" weight="bold" tone="accent">{i + 1}</AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="heading">{item.medication_name}{item.strength ? ` ${item.strength}` : ""}</AppText>
                {item.dosage_form ? <AppText variant="caption" tone="muted">{label(ar.dosageForms, item.dosage_form)}</AppText> : null}
              </View>
            </Row>
            <View style={{ marginTop: space.md, backgroundColor: t.brandSoft, borderRadius: radius.md, padding: space.md }}>
              <AppText variant="caption" tone="primary" weight="medium">{ar.record.sig}</AppText>
              <AppText variant="body" weight="medium">{item.sig}</AppText>
            </View>
            {item.instructions ? <View style={{ marginTop: space.sm }}><Field label={ar.record.instructions} value={item.instructions} /></View> : null}
            {item.quantity ? <Field label={ar.record.quantity} value={`${formatDecimal(item.quantity)} ${item.quantity_unit ?? ""}`} /> : null}
          </Card>
        ))}
      </View>
      {rx.notes ? <Card style={{ marginTop: space.lg }}><Field label={ar.record.notes} value={rx.notes} multiline /></Card> : null}
    </>
  );
}

const interpretationTone: Record<string, BadgeTone> = {
  normal: "success", low: "warning", high: "warning", critical_low: "danger", critical_high: "danger", abnormal: "warning",
};

function LabView({ r }: { r: Schemas["LabReport"] }) {
  const t = useTheme();
  return (
    <>
      <ProvenanceHeader type="lab_report" rec={r} title={r.title} />
      {r.external_lab_name || r.specimen_collected_at ? (
        <Card style={{ marginTop: space.lg }}>
          <Field label={ar.record.externalLab} value={r.external_lab_name} />
          <Field label={ar.record.specimen} value={r.specimen_collected_at ? formatDateTime(r.specimen_collected_at) : null} />
        </Card>
      ) : null}
      <SectionTitle title={ar.record.observations} />
      <Card padded={false}>
        {r.observations.map((o, i) => {
          const value = o.value_numeric != null && o.value_numeric !== "" ? formatDecimal(o.value_numeric) : o.value_text;
          const range = o.reference_text || (o.reference_low != null || o.reference_high != null
            ? `${formatDecimal(o.reference_low) || "…"} – ${formatDecimal(o.reference_high) || "…"}`
            : "");
          const flagged = o.interpretation && o.interpretation !== "normal";
          return (
            <View key={o.id} testID="lab-observation">
              {i > 0 ? <RowSeparator /> : null}
              <View style={{ padding: space.lg, gap: 4, backgroundColor: flagged ? t.warningSoft : "transparent" }}>
                <Row style={{ justifyContent: "space-between" }} align="flex-start">
                  <AppText variant="body" weight="medium" style={{ flex: 1 }}>{o.name}</AppText>
                  <AppText variant="heading" ltr tone={flagged ? "warning" : "default"}>
                    {value}{o.unit ? ` ${o.unit}` : ""}
                  </AppText>
                </Row>
                <Row style={{ justifyContent: "space-between" }}>
                  <AppText variant="caption" tone="muted">{range ? `${ar.record.range}: ` : ""}<AppText variant="caption" tone="muted" ltr>{range}</AppText></AppText>
                  {o.interpretation ? <Badge text={label(ar.interpretation, o.interpretation)} tone={interpretationTone[o.interpretation] ?? "neutral"} /> : null}
                </Row>
              </View>
            </View>
          );
        })}
        {r.observations.length === 0 ? <EmptyState title={ar.common.dash} /> : null}
      </Card>
      {r.conclusion ? <Card style={{ marginTop: space.lg }}><Field label={ar.record.conclusion} value={r.conclusion} multiline /></Card> : null}
      <Attachments docs={r.documents} />
    </>
  );
}

function ImagingView({ r }: { r: Schemas["ImagingReport"] }) {
  return (
    <>
      <ProvenanceHeader type="imaging_report" rec={r} title={r.title} />
      <Card style={{ marginTop: space.lg }}>
        <Field label={ar.record.modality} value={label(ar.modalities, r.modality)} />
        <Field label={ar.record.bodySite} value={r.body_site} />
        <Field label={ar.record.findings} value={r.findings} multiline />
        <Field label={ar.record.impression} value={r.impression} multiline />
      </Card>
      <Attachments docs={r.documents} />
    </>
  );
}

function Attachments({ docs }: { docs: Schemas["DocumentBrief"][] }) {
  if (!docs.length) return null;
  return (
    <>
      <SectionTitle title={ar.record.attachments} />
      <Card padded={false}>
        {docs.map((d, i) => (
          <View key={d.id}>
            {i > 0 ? <RowSeparator /> : null}
            <ListRow title={d.title} subtitle={d.mime_type} leading={<RecordIcon type="document" />} onPress={() => openRecord("document", d.id)} />
          </View>
        ))}
      </Card>
    </>
  );
}

function DocumentView({ d }: { d: Schemas["Document"] }) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = d.scan_status === "clean";

  async function open() {
    setError(null);
    setBusy(true);
    try {
      await openDocument(d.id, d.mime_type);
    } catch {
      setError(ar.record.openFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ProvenanceHeader type="document" rec={d} title={d.title || d.original_filename} />
      <Card style={{ marginTop: space.lg }}>
        <Field label={ar.record.category} value={label(ar.documentCategories, d.category)} />
        <Field label={ar.record.description} value={d.description} multiline />
        <Field label={ar.record.documentDate} value={d.document_date ? formatDate(d.document_date) : null} />
        <Field label={ar.record.fileName} value={d.original_filename} ltr />
        <Field label={ar.record.fileType} value={d.mime_type} ltr />
        <Field label={ar.record.fileSize} value={formatBytes(d.size_bytes)} ltr />
      </Card>
      {error ? <View style={{ marginTop: space.lg }}><Notice tone="danger" text={error} /></View> : null}
      {!ready ? (
        <View style={{ marginTop: space.lg }}>
          <Notice tone={d.scan_status === "rejected" ? "danger" : "info"} text={d.scan_status === "rejected" ? ar.record.scanRejected : ar.record.scanPending} />
        </View>
      ) : (
        <Button
          title={busy ? ar.record.opening : ar.record.open}
          icon={busy ? undefined : <ExternalLink size={18} color="#fff" />}
          onPress={open}
          loading={busy}
          style={{ marginTop: space.lg }}
        />
      )}
      <Row gap={6} style={{ marginTop: space.md }} align="flex-start">
        <Info size={14} color={t.subtle} />
        <AppText variant="caption" tone="subtle" style={{ flex: 1 }}>
          {d.mime_type === "application/dicom" ? ar.record.dicomSoon : ar.record.openHint}
        </AppText>
      </Row>
    </>
  );
}
