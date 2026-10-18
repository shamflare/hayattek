import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Save } from "lucide-react-native";

import { openRecord } from "@/components/records";
import { Screen } from "@/components/screen";
import { AppText, Button, Card, Chips, ConfirmDialog, EmptyState, Notice, Row, TextField } from "@/components/ui";
import { ar } from "@/i18n/ar";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api";
import { useClinician } from "@/lib/clinician";
import { space, useTheme } from "@/theme";

type EncounterType = Schemas["EncounterTypeEnum"];
const TYPES: EncounterType[] = ["consultation", "follow_up", "emergency", "procedure", "home_visit"];

export default function QuickVisit() {
  const t = useTheme();
  const qc = useQueryClient();
  const { current } = useClinician();
  const [type, setType] = useState<EncounterType>("consultation");
  const [reason, setReason] = useState("");
  const [assessment, setAssessment] = useState("");
  const [notes, setNotes] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [finalized, setFinalized] = useState(false);
  const [busy, setBusy] = useState<"draft" | "final" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!current) return <Screen><Card><EmptyState title={ar.clinician.scanTitle} /></Card></Screen>;
  const patient = current.result.patient;

  async function saveDraft(): Promise<string | null> {
    setError(null);
    if (!reason.trim()) {
      setError(ar.clinician.reasonRequired);
      return null;
    }
    const body = { encounter_type: type, reason: reason.trim(), assessment: assessment.trim(), notes: notes.trim() };
    if (draftId) {
      await unwrap(api.PATCH("/api/v1/clinical/encounters/{id}", { params: { path: { id: draftId } }, body }));
      return draftId;
    }
    const created = (await unwrap(api.POST("/api/v1/clinical/encounters", { body: { patient: patient.id, ...body } }))) as { id?: string };
    if (!created.id) throw new Error("missing id");
    setDraftId(created.id);
    return created.id;
  }

  async function onDraft() {
    setBusy("draft");
    try {
      if (await saveDraft()) setNotice(ar.clinician.draftSaved);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function onFinalize() {
    setError(null);
    if (!reason.trim()) return setError(ar.clinician.reasonRequired);
    setConfirm(true);
  }

  async function doFinalize() {
    setBusy("final");
    try {
      const id = await saveDraft();
      if (!id) return;
      await unwrap(api.POST("/api/v1/clinical/encounters/{id}/finalize", { params: { path: { id } } }));
      setFinalized(true);
      setNotice(ar.clinician.finalized);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("summary") });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  }

  return (
    <Screen testID="clinician-visit">
      <AppText variant="small" tone="muted" style={{ marginBottom: space.md }}>{patient.full_name}</AppText>
      {notice ? <Notice text={notice} /> : null}
      {error ? <Notice tone="danger" text={error} /> : null}

      <Card>
        <AppText variant="small" weight="medium" style={{ marginBottom: 6 }}>{ar.clinician.visitType}</AppText>
        <Chips options={TYPES.map((v) => ({ value: v, label: ar.encounterTypes[v] }))} selected={[type]} onToggle={setType} />
        <View style={{ height: space.lg }} />
        <TextField testID="visit-reason" label={ar.clinician.visitReason} value={reason} onChangeText={setReason} editable={!finalized} />
        <TextField testID="visit-assessment" label={ar.clinician.visitAssessment} value={assessment} onChangeText={setAssessment} multiline numberOfLines={3} style={{ minHeight: 96 }} editable={!finalized} />
        <TextField label={ar.clinician.visitNotes} value={notes} onChangeText={setNotes} multiline numberOfLines={4} style={{ minHeight: 110 }} editable={!finalized} />
      </Card>

      {finalized && draftId ? (
        <Row gap={space.sm} style={{ marginTop: space.lg }}>
          <Button title={ar.common.viewDetails} variant="secondary" onPress={() => openRecord("encounter", draftId)} style={{ flex: 1 }} />
          <Button title={ar.clinician.newPrescription} onPress={() => router.replace("/clinician/prescribe")} style={{ flex: 1 }} />
        </Row>
      ) : (
        <Row gap={space.sm} style={{ marginTop: space.lg }}>
          <Button title={ar.clinician.finalize} icon={<CheckCircle2 size={18} color="#fff" />} onPress={onFinalize} loading={busy === "final"} disabled={busy !== null} style={{ flex: 1 }} testID="visit-finalize" />
          <Button title={ar.clinician.saveDraft} variant="outline" icon={<Save size={18} color={t.fg} />} onPress={onDraft} loading={busy === "draft"} disabled={busy !== null} style={{ flex: 1 }} testID="visit-draft" />
        </Row>
      )}

      <ConfirmDialog
        visible={confirm}
        title={ar.clinician.finalizeTitle}
        body={ar.clinician.finalizeBody}
        confirmLabel={ar.clinician.finalize}
        loading={busy === "final"}
        onConfirm={doFinalize}
        onCancel={() => setConfirm(false)}
      />
    </Screen>
  );
}
