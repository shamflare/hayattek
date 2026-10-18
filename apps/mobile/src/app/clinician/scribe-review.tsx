/**
 * HayatTek AI draft review (mobile). Same rules as the web review page: compare with the
 * transcript, edit, opt items in/out, then apply to the visit in the doctor's name. The
 * prescription is always created as a DRAFT.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, Sparkles, User, UserRound } from "lucide-react-native";

import { Screen } from "@/components/screen";
import { AppText, Badge, Button, Card, CheckRow, ConfirmDialog, ErrorState, Notice, Row, SectionTitle, SkeletonList, TextField } from "@/components/ui";
import { ar, label } from "@/i18n/ar";
import { api, errorMessage, unwrap } from "@/lib/api";
import { rtlSafe } from "@/lib/format";
import { useCanRun } from "@/lib/network";
import { useInvalidateScribe, useScribeSession } from "@/lib/scribe";
import {
  buildApprovePayload, buildReviewForm, draftWarnings, reviewCount, togglePick, transcriptSegments, VITALS,
  type DraftField, type Pick, type PickListKey, type ReviewForm, type Segment, type TextKey,
} from "@/lib/scribe-payload";
import { useSession } from "@/lib/session";
import { fonts, radius, space, useTheme } from "@/theme";

export default function ScribeReview() {
  const { session: sessionId, encounter: encounterId } = useLocalSearchParams<{ session: string; encounter: string }>();
  const { membership } = useSession();
  const q = useScribeSession(sessionId);
  const enc = useQuery({
    queryKey: [`c:${membership?.id}`, "record", "encounter", encounterId],
    enabled: !!encounterId,
    queryFn: () => unwrap(api.GET("/api/v1/clinical/encounters/{id}", { params: { path: { id: encounterId! } } })),
  });
  const [form, setForm] = useState<ReviewForm | null>(null);

  useEffect(() => {
    if (form || !q.data || q.data.status !== "ready" || enc.isPending) return;
    const e = enc.data;
    setForm(buildReviewForm(q.data.draft, e ? {
      reason: e.reason, complaint: e.complaint, history: e.history, examination: e.examination,
      assessment: e.assessment, plan: e.plan, follow_up_note: e.follow_up_note,
    } : {}));
  }, [q.data, enc.isPending, enc.data, form]);

  if (q.isPending || (q.data?.status === "ready" && !form)) return <Screen><SkeletonList rows={4} /></Screen>;
  if (q.isError || !q.data) return <Screen><Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card></Screen>;
  if (q.data.status !== "ready" || !form) {
    return <Screen><Card><ErrorState message={q.data.status === "approved" ? ar.scribe.alreadyApproved : ar.scribe.notReady} /></Card></Screen>;
  }
  return <ReviewBody sessionId={sessionId!} isMock={q.data.is_mock} seconds={q.data.audio_seconds} segments={transcriptSegments(q.data.transcript)} warnings={draftWarnings(q.data.draft)} form={form} setForm={setForm} />;
}

function ReviewBody({ sessionId, isMock, seconds, segments, warnings, form, setForm }: {
  sessionId: string; isMock: boolean; seconds: number; segments: Segment[]; warnings: string[];
  form: ReviewForm; setForm: (f: ReviewForm) => void;
}) {
  const t = useTheme();
  const canRun = useCanRun();
  const invalidate = useInvalidateScribe();
  const [highlight, setHighlight] = useState<string[]>([]);
  const [showTranscript, setShowTranscript] = useState(true);
  const [finalize, setFinalize] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(segments.map((s) => [s.id, s])), [segments]);
  const pending = reviewCount(form);

  const set = (k: TextKey) => (v: string) => setForm({ ...form, [k]: v });
  const toggle = (list: PickListKey, i: number) => setForm(togglePick(form, list, i));
  const quote = (field?: DraftField) => (field?.sources ?? []).map((id) => byId.get(id)?.text).filter(Boolean).join(" … ");

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.POST("/api/v1/scribe/sessions/{id}/approve", {
        params: { path: { id: sessionId } },
        body: buildApprovePayload(form, finalize),
      }));
      await invalidate();
      setConfirm(false);
      // Back to the quick visit, which reloads the encounter and shows the draft prescription.
      router.dismissTo("/clinician/visit");
    } catch (e) {
      setError(errorMessage(e));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen testID="scribe-review">
      <AppText variant="small" tone="muted" style={{ marginBottom: space.md }}>{ar.scribe.reviewIntro}</AppText>
      {isMock ? (
        <View style={{ flexDirection: "row", gap: space.sm, backgroundColor: t.warningSoft, borderRadius: radius.md, padding: space.md, marginBottom: space.md }}>
          <Info size={18} color={t.warning} />
          <AppText variant="small" style={{ flex: 1, color: t.warning }}>{ar.scribe.mockBanner}</AppText>
        </View>
      ) : null}
      {warnings.map((w) => <Notice key={w} tone="info" text={w} />)}
      {error ? <Notice tone="danger" text={error} /> : null}

      {/* Transcript */}
      <Card padded={false}>
        <Pressable onPress={() => setShowTranscript((v) => !v)} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.lg }}>
          <AppText variant="heading" style={{ flex: 1 }}>{ar.scribe.transcript}</AppText>
          <AppText variant="caption" tone="subtle" ltr>{ar.scribe.seconds(Math.round(seconds))}</AppText>
          {showTranscript ? <ChevronUp size={20} color={t.subtle} /> : <ChevronDown size={20} color={t.subtle} />}
        </Pressable>
        {showTranscript ? (
          <View testID="scribe-transcript" style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}>
            {segments.map((seg) => <SegmentRow key={seg.id} seg={seg} on={highlight.includes(seg.id)} />)}
          </View>
        ) : null}
      </Card>

      {/* Core text */}
      <SectionTitle title={ar.clinician.visitTitle} />
      <Card>
        <TextField label={ar.scribe.reason} value={form.reason} onChangeText={set("reason")} />
        <TextField testID="review-complaint" label={ar.scribe.complaint} value={form.complaint} onChangeText={set("complaint")} multiline style={{ minHeight: 80 }} onFocus={() => setHighlight(form.fields.chief_complaint?.sources ?? [])} />
        <TextField label={ar.scribe.history} value={form.history} onChangeText={set("history")} multiline style={{ minHeight: 140 }} onFocus={() => setHighlight([...(form.fields.history?.sources ?? []), ...(form.fields.duration?.sources ?? [])])} />
        <TextField label={ar.scribe.examination} value={form.examination} onChangeText={set("examination")} multiline style={{ minHeight: 80 }} onFocus={() => setHighlight(form.fields.examination?.sources ?? [])} />
      </Card>

      {/* Vitals */}
      <SectionTitle title={ar.scribe.vitals} />
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {VITALS.map(([k, l, unit]) => {
            const field = form.fields.vitals?.[k];
            const review = !!field?.needs_review;
            return (
              <View key={k} style={{ width: "48.5%", borderRadius: radius.md, borderWidth: 1, borderColor: review ? t.warning : t.border, backgroundColor: review ? t.warningSoft : t.sunken, padding: space.sm }}>
                <AppText variant="caption" tone="muted">{l}</AppText>
                <Row gap={4}>
                  <TextInput
                    testID={`review-vital-${k}`}
                    value={form.vitals[k] ?? ""}
                    onChangeText={(v) => setForm({ ...form, vitals: { ...form.vitals, [k]: v } })}
                    onFocus={() => setHighlight(field?.sources ?? [])}
                    placeholder="—"
                    placeholderTextColor={t.subtle}
                    keyboardType="decimal-pad"
                    style={{ flex: 1, minWidth: 0, width: "100%", minHeight: 36, fontFamily: fonts.semibold, fontSize: 18, color: t.fg, padding: 0, writingDirection: "ltr", textAlign: "right" }}
                  />
                  <AppText variant="caption" tone="subtle" ltr>{unit}</AppText>
                </Row>
                {review ? <AppText variant="caption" tone="warning">{field?.review_reason}</AppText> : null}
              </View>
            );
          })}
        </View>
      </Card>

      <PickList title={ar.scribe.diagnoses} empty={ar.scribe.diagnosesEmpty} items={form.diagnoses} onToggle={(i) => toggle("diagnoses", i)} onFocus={setHighlight} quote={quote} testID="review-diagnoses"
        render={(d) => (
          <View style={{ gap: 4 }}>
            <AppText variant="body" weight="medium">{d.display}</AppText>
            {d.certainty === "suspected" ? <Badge text={ar.scribe.suspected} tone="warning" /> : null}
          </View>
        )} />
      <PickList title={ar.scribe.allergies} empty={ar.scribe.allergiesEmpty} items={form.allergies} onToggle={(i) => toggle("allergies", i)} onFocus={setHighlight} quote={quote}
        render={(a) => <AppText variant="body" weight="medium">{a.substance}{a.reaction ? ` — ${a.reaction}` : ""}</AppText>} />
      <PickList title={ar.scribe.meds} empty={ar.scribe.medsEmpty} items={form.meds} onToggle={(i) => toggle("meds", i)} onFocus={setHighlight} quote={quote} testID="review-meds"
        footer={ar.scribe.medsFooter}
        render={(m) => (
          <View style={{ gap: 4 }}>
            <Row gap={6} style={{ flexWrap: "wrap" }}>
              <AppText variant="body" weight="medium">{rtlSafe(m.name ?? ar.scribe.unknownMed)}</AppText>
              {m.dose_amount ? <AppText variant="small" tone="muted" ltr>{`${m.dose_amount} ${m.dose_unit ?? ""}`.trim()}</AppText> : <Badge text={ar.scribe.noDose} tone="warning" />}
            </Row>
            {m.text ? <AppText variant="caption" tone="muted">{m.text}</AppText> : null}
          </View>
        )} />
      <PickList title={ar.scribe.labs} empty={ar.scribe.none} items={form.labs} onToggle={(i) => toggle("labs", i)} onFocus={setHighlight} quote={quote}
        render={(l) => <AppText variant="body" weight="medium">{l.lab_test?.name ?? l.name}</AppText>} />
      <PickList title={ar.scribe.imaging} empty={ar.scribe.none} items={form.imaging} onToggle={(i) => toggle("imaging", i)} onFocus={setHighlight} quote={quote}
        render={(x) => <AppText variant="body" weight="medium">{label(ar.modalities, x.modality)}{x.description ? ` — ${x.description}` : ""}</AppText>} />

      {form.current.length > 0 ? (
        <>
          <SectionTitle title={ar.scribe.current} />
          <Card style={{ gap: space.sm }}>
            {form.current.map((c, i) => (
              <Pressable key={i} onPress={() => setHighlight(c.sources)}>
                <AppText variant="small" tone={c.needs_review ? "warning" : "default"}>
                  {rtlSafe(c.value.name ?? c.value.text ?? "")}{c.needs_review ? ` — ${c.review_reason}` : ""}
                </AppText>
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle title={ar.scribe.assessmentTitle} />
      <Card>
        <TextField testID="review-assessment" label={ar.scribe.assessment} value={form.assessment} onChangeText={set("assessment")} multiline style={{ minHeight: 80 }} />
        <TextField label={ar.scribe.plan} value={form.plan} onChangeText={set("plan")} multiline style={{ minHeight: 80 }} />
        <TextField label={ar.scribe.followUp} value={form.follow_up_note} onChangeText={set("follow_up_note")} onFocus={() => setHighlight(form.fields.follow_up?.sources ?? [])} />
      </Card>

      <Card style={{ marginTop: space.lg, gap: space.sm }}>
        {pending > 0 ? (
          <Row gap={space.sm}><AlertTriangle size={18} color={t.warning} /><AppText variant="small" tone="warning" style={{ flex: 1 }}>{ar.scribe.needsReview(pending)}</AppText></Row>
        ) : null}
        <View style={{ flexDirection: "row", gap: space.sm, backgroundColor: t.infoSoft, borderRadius: radius.md, padding: space.md }}>
          <Info size={18} color={t.info} />
          <AppText variant="small" style={{ flex: 1, color: t.info }}>{ar.scribe.medsFooter}</AppText>
        </View>
        <CheckRow checked={finalize} onToggle={() => setFinalize((v) => !v)} title={ar.scribe.finalizeToo} subtitle={ar.scribe.finalizeHint} testID="review-finalize" />
        <Button testID="review-approve" title={ar.scribe.approve} icon={<CheckCircle2 size={20} color="#fff" />} onPress={() => setConfirm(true)} disabled={!canRun(busy)} />
      </Card>

      <ConfirmDialog
        visible={confirm}
        title={ar.scribe.approveTitle}
        body={ar.scribe.approveBody}
        confirmLabel={ar.scribe.approve}
        loading={busy}
        onConfirm={approve}
        onCancel={() => setConfirm(false)}
      />
    </Screen>
  );
}

function SegmentRow({ seg, on }: { seg: Segment; on: boolean }) {
  const t = useTheme();
  const kind = seg.speaker === "doctor" || seg.speaker === "patient" ? seg.speaker : "unknown";
  const chip = {
    doctor: { bg: t.brandSoftStrong, fg: t.primary, icon: <UserRound size={12} color={t.primary} /> },
    patient: { bg: t.accentSoft, fg: t.accent, icon: <User size={12} color={t.accent} /> },
    unknown: { bg: t.warningSoft, fg: t.warning, icon: <AlertTriangle size={12} color={t.warning} /> },
  }[kind];
  const m = Math.floor(seg.start / 60);
  const s = String(Math.floor(seg.start % 60)).padStart(2, "0");
  return (
    <View testID={`segment-${seg.id}`} style={{ borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? t.brand[400] : t.border, backgroundColor: on ? t.brandSoft : t.elevated, padding: space.md, gap: 4 }}>
      <Row gap={6}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: chip.bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 }}>
          {chip.icon}
          <AppText variant="caption" weight="medium" style={{ color: chip.fg }}>{ar.scribe.speaker[kind]}</AppText>
        </View>
        <AppText variant="caption" tone="subtle" ltr>{`${m}:${s}`}</AppText>
      </Row>
      <AppText variant="small">{seg.text}</AppText>
    </View>
  );
}

function PickList<T>({ title, items, render, onToggle, onFocus, quote, empty, footer, testID }: {
  title: string; items: Pick<T>[]; render: (v: T) => ReactNode; onToggle: (i: number) => void;
  onFocus: (ids: string[]) => void; quote: (f?: DraftField) => string; empty: string; footer?: string; testID?: string;
}) {
  const t = useTheme();
  return (
    <>
      <SectionTitle title={title} />
      <Card testID={testID} style={{ gap: space.sm }}>
        {items.length === 0 ? <AppText variant="small" tone="subtle">{empty}</AppText> : items.map((item, i) => {
          const review = item.field.needs_review;
          const text = (item.value as { text?: string } | null)?.text;
          const src = quote(item.field);
          const showSrc = !!src && src !== text;
          return (
            <Pressable
              key={i}
              testID={testID ? `${testID}-${i}` : undefined}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.include }}
              accessibilityLabel={ar.scribe.include}
              onPress={() => { onToggle(i); onFocus(item.field.sources); }}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "flex-start", gap: space.md, padding: space.md, borderRadius: radius.md,
                borderWidth: 1, borderColor: review ? t.warning : t.border, backgroundColor: review ? t.warningSoft : t.elevated,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <View style={{ width: 24, height: 24, marginTop: 2, borderRadius: 7, borderWidth: 2, borderColor: item.include ? t.primary : t.borderStrong, backgroundColor: item.include ? t.primary : "transparent", alignItems: "center", justifyContent: "center" }}>
                {item.include ? <CheckCircle2 size={14} color="#fff" /> : null}
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                {render(item.value)}
                {review ? <AppText variant="caption" tone="warning" weight="medium">{item.field.review_reason}</AppText> : null}
                {showSrc ? <AppText variant="caption" tone="subtle" numberOfLines={2}>{`${ar.scribe.source}: «${src}»`}</AppText> : null}
              </View>
            </Pressable>
          );
        })}
        {footer ? (
          <Row gap={6} align="flex-start"><Sparkles size={14} color={t.muted} /><AppText variant="caption" tone="muted" style={{ flex: 1 }}>{footer}</AppText></Row>
        ) : null}
      </Card>
    </>
  );
}
