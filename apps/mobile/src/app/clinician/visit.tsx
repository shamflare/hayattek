import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pill, Save, Sparkles } from "lucide-react-native";

import { openRecord } from "@/components/records";
import { Screen } from "@/components/screen";
import { AppText, Button, Card, Chips, ConfirmDialog, EmptyState, Notice, Row, TextField } from "@/components/ui";
import { ar } from "@/i18n/ar";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api";
import { useClinician } from "@/lib/clinician";
import { useCanRun } from "@/lib/network";
import { useScribeStatus } from "@/lib/scribe";
import { radius, space, useTheme } from "@/theme";

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
  const [busy, setBusy] = useState<"draft" | "final" | "ai" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiRx, setAiRx] = useState<string | null>(null);
  const [aiApplied, setAiApplied] = useState(false);
  const canRun = useCanRun();
  const scribe = useScribeStatus();
  // Set when we hand the draft to HayatTek AI: on return the server copy is the truth
  // (the approved AI draft updated it), so reload it instead of overwriting it.
  const syncOnFocus = useRef(false);
  const draftRef = useRef<string | null>(null);

  useFocusEffect(
    // Stable callback: runs only on focus transitions (not when draftId changes while focused).
    useCallback(() => {
      const draftId = draftRef.current;
      if (!syncOnFocus.current || !draftId) return;
      syncOnFocus.current = false;
      void (async () => {
        try {
          const enc = await unwrap(api.GET("/api/v1/clinical/encounters/{id}", { params: { path: { id: draftId } } }));
          setReason(enc.reason ?? "");
          setAssessment(enc.assessment ?? "");
          setNotes(enc.notes ?? "");
          if (enc.status === "final") setFinalized(true);
          const list = await unwrap(api.GET("/api/v1/scribe/sessions", { params: { query: { encounter: draftId } } }));
          const done = list.results.find((x) => x.status === "approved");
          if (done) {
            setAiApplied(true);
            const rx = (done.applied as { prescription?: string | null } | null)?.prescription;
            setAiRx(rx ?? null);
          }
        } catch (e) {
          setError(errorMessage(e));
        }
      })();
    }, []),
  );

  if (!current) return <Screen><Card><EmptyState title={ar.clinician.scanTitle} /></Card></Screen>;
  const patient = current.result.patient;

  async function saveDraft(requireReason = true): Promise<string | null> {
    setError(null);
    if (requireReason && !reason.trim()) {
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
    draftRef.current = created.id;
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

  async function openScribe() {
    setBusy("ai");
    try {
      // HayatTek AI works on a draft encounter the doctor authored: create/save it first.
      const id = await saveDraft(false);
      if (!id) return;
      syncOnFocus.current = true;
      router.push({ pathname: "/clinician/scribe", params: { encounter: id } });
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
      {aiApplied ? (
        <Card testID="visit-ai-applied" style={{ marginBottom: space.md, gap: space.sm, borderColor: t.success }}>
          <AppText variant="small" weight="medium" tone="success">{ar.scribe.applied}</AppText>
          {aiRx ? (
            <>
              <AppText variant="small" tone="muted">{ar.scribe.appliedRx}</AppText>
              <Button title={ar.scribe.openRx} variant="secondary" compact icon={<Pill size={16} color={t.primary} />} onPress={() => openRecord("prescription", aiRx)} testID="visit-ai-rx" />
            </>
          ) : null}
        </Card>
      ) : null}

      {!finalized && scribe.data?.enabled ? (
        <Card testID="visit-ai" style={{ marginBottom: space.md, gap: space.sm, backgroundColor: t.brandSoft, borderColor: t.brand[200] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: t.cardHero, alignItems: "center", justifyContent: "center" }}>
              <Sparkles size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="body" weight="semibold">{ar.scribe.title}</AppText>
              <AppText variant="caption" tone="muted">{ar.scribe.openHint}</AppText>
            </View>
          </View>
          <Button testID="visit-ai-open" title={ar.scribe.open} icon={<Sparkles size={18} color="#fff" />} onPress={openScribe} loading={busy === "ai"} disabled={!canRun(busy !== null)} />
        </Card>
      ) : !finalized && scribe.data && !scribe.data.enabled ? (
        <View style={{ marginBottom: space.md }}><Notice tone="info" text={ar.scribe.disabled} /></View>
      ) : null}

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
          <Button title={ar.clinician.finalize} icon={<CheckCircle2 size={18} color="#fff" />} onPress={onFinalize} loading={busy === "final"} disabled={!canRun(busy !== null)} style={{ flex: 1 }} testID="visit-finalize" />
          <Button title={ar.clinician.saveDraft} variant="outline" icon={<Save size={18} color={t.fg} />} onPress={onDraft} loading={busy === "draft"} disabled={!canRun(busy !== null)} style={{ flex: 1 }} testID="visit-draft" />
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
