/**
 * HayatTek AI recorder (clinician quick visit -> "HayatTek AI").
 *
 * Flow: mode -> (conversation) mandatory patient consent -> microphone permission ->
 * record WAV 16 kHz mono with a red indicator + timer (pause/resume) -> finish & analyse ->
 * upload with progress -> poll -> ready -> review screen. Failed processing can be retried
 * for free; an interrupted upload is retried with the SAME client_key (idempotent session
 * start) and the same in-memory audio, so no duplicate session is ever created.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  AudioLines, CheckCircle2, FlaskConical, Mic, MicOff, Pause, Play, RotateCcw, Settings, Sparkles, Square, Trash2, X,
} from "lucide-react-native";

import { Screen } from "@/components/screen";
import { AppText, Badge, Button, Card, Chips, EmptyState, ErrorState, Notice, Row, SkeletonList } from "@/components/ui";
import { ar } from "@/i18n/ar";
import { api, errorMessage, isApiError, unwrap } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { useCanRun } from "@/lib/network";
import { micPermission, openMicSettings, useWavRecorder, type MicPermission } from "@/lib/recorder";
import { samplesOf, useInvalidateScribe, useScribeSessions, useScribeStatus, type ScribeMode, type ScribeSample, type ScribeSession } from "@/lib/scribe";
import { activeSession, formatClock, newClientKey, scribeNextAction } from "@/lib/scribe-payload";
import { uploadFile } from "@/lib/upload";
import { radius, space, useTheme } from "@/theme";

type Consent = "verbal" | "written" | "";

export default function ScribeScreen() {
  const { encounter } = useLocalSearchParams<{ encounter: string }>();
  const status = useScribeStatus();
  const sessions = useScribeSessions(encounter);
  const refresh = useInvalidateScribe();

  if (!encounter) return <Screen><Card><EmptyState title={ar.errors.notFound} /></Card></Screen>;
  if (status.isPending || sessions.isPending) {
    return <Screen><Header /><SkeletonList rows={2} /></Screen>;
  }
  if (status.isError) return <Screen><Header /><Card><ErrorState message={errorMessage(status.error)} onRetry={() => status.refetch()} /></Card></Screen>;
  const s = status.data;
  const list = sessions.data?.results ?? [];
  const active = activeSession(list);
  const approved = list.filter((x) => x.status === "approved");

  return (
    <Screen testID="scribe-screen">
      <Header mock={s.provider_is_mock} />
      {!s.enabled ? (
        <Card><AppText variant="small" tone="muted">{ar.scribe.disabled}</AppText></Card>
      ) : active && active.status !== "created" ? (
        <SessionState session={active} encounterId={encounter} onChange={refresh} />
      ) : (
        <Recorder
          encounterId={encounter}
          existing={active}
          samples={samplesOf(s)}
          price={formatMoney(s.price_per_minute, s.currency, { maxFraction: 4 })}
          onChange={refresh}
        />
      )}
      {approved.map((x) => (
        <View key={x.id} style={{ marginTop: space.md }}>
          <Notice text={ar.scribe.applied} />
        </View>
      ))}
    </Screen>
  );
}

function Header({ mock }: { mock?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.cardHero, borderRadius: radius.lg, padding: space.lg, marginBottom: space.lg, flexDirection: "row", alignItems: "center", gap: space.md }}>
      <Sparkles size={26} color={t.brand[200]} />
      <View style={{ flex: 1 }}>
        <AppText variant="heading" tone="onPrimary">{ar.scribe.title}</AppText>
        <AppText variant="caption" style={{ color: "rgba(255,255,255,0.8)" }}>{ar.scribe.subtitle}</AppText>
      </View>
      {mock ? (
        <View style={{ backgroundColor: "rgba(255,255,255,0.18)", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2 }}>
          <AppText variant="caption" tone="onPrimary" weight="medium">{ar.scribe.mock}</AppText>
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ recorder */

type Phase = "setup" | "recording" | "uploading" | "uploadFailed";

function Recorder({ encounterId, existing, samples, price, onChange }: {
  encounterId: string;
  existing?: ScribeSession;
  samples: ScribeSample[];
  price: string;
  onChange: () => void;
}) {
  const t = useTheme();
  const canRun = useCanRun();
  const rec = useWavRecorder();
  const [mode, setMode] = useState<ScribeMode>((existing?.mode as ScribeMode) ?? "conversation");
  const [consent, setConsent] = useState<Consent>(
    existing?.consent_method === "verbal" || existing?.consent_method === "written" ? existing.consent_method : "",
  );
  const [phase, setPhase] = useState<Phase>("setup");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mic, setMic] = useState<MicPermission | null>(null);
  const [sample, setSample] = useState<string>("");
  const [sampleBusy, setSampleBusy] = useState(false);
  // Idempotency: one key per mode for the life of this screen, re-sent on every retry.
  const keys = useRef<Partial<Record<ScribeMode, string>>>({});
  const session = useRef<ScribeSession | null>(existing ?? null);
  const audio = useRef<Uint8Array | null>(null);
  const abort = useRef<(() => void) | null>(null);

  useEffect(() => {
    void micPermission(false).then(setMic);
    return () => abort.current?.();
  }, []);

  async function ensureSession(m: ScribeMode): Promise<ScribeSession> {
    if (session.current && session.current.mode === m && scribeNextAction(session.current.status) !== "start") {
      return session.current;
    }
    const key = (keys.current[m] ??= newClientKey());
    const created = await unwrap(api.POST("/api/v1/scribe/sessions", {
      body: {
        encounter: encounterId,
        mode: m,
        consent_method: m === "dictation" ? "not_required" : (consent as "verbal" | "written"),
        client_key: key,
      },
    }));
    session.current = created;
    return created;
  }

  async function start() {
    setError(null);
    if (mode === "conversation" && !consent) return setError(ar.scribe.consentRequired);
    if (!rec.supported) return setMic("unavailable");
    const perm = await micPermission(true);
    setMic(perm);
    if (perm !== "granted") return;
    try {
      await rec.start();
      setPhase("recording");
    } catch (e) {
      setError(errorMessage(e));
      setMic(await micPermission(false));
    }
  }

  async function finish() {
    const wav = await rec.stop();
    if (wav.length < 44 + 16000 * 2) {
      setPhase("setup");
      return setError(ar.scribe.tooShort);
    }
    audio.current = wav;
    await submit();
  }

  /** Start (idempotent) + upload. Safe to call again after any failure. */
  async function submit() {
    const wav = audio.current;
    if (!wav) return;
    setError(null);
    setPhase("uploading");
    setProgress(0);
    try {
      const s = await ensureSession(mode);
      if (scribeNextAction(s.status) === "upload") {
        const up = uploadFile<ScribeSession>(
          `/api/v1/scribe/sessions/${s.id}/audio`,
          { field: "file", name: "recording.wav", type: "audio/wav", data: wav },
          setProgress,
        );
        abort.current = up.abort;
        session.current = await up.promise;
      }
      audio.current = null; // uploaded: drop the only copy from memory
      onChange();
    } catch (e) {
      // Same file re-sent after the server already stored it: the session moved on.
      if (isApiError(e) && e.code === "already_uploaded") {
        audio.current = null;
        onChange();
        return;
      }
      setError(errorMessage(e));
      setPhase("uploadFailed");
    } finally {
      abort.current = null;
    }
  }

  async function applySample() {
    const chosen = samples.find((x) => x.id === sample);
    if (!chosen) return;
    setError(null);
    if (chosen.mode === "conversation" && !consent) return setError(ar.scribe.consentRequired);
    setSampleBusy(true);
    try {
      setMode(chosen.mode);
      const s = await ensureSession(chosen.mode);
      await unwrap(api.POST("/api/v1/scribe/sessions/{id}/sample", { params: { path: { id: s.id } }, body: { sample } }));
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSampleBusy(false);
    }
  }

  function discardLocal() {
    audio.current = null;
    rec.cancel();
    setPhase("setup");
    setError(null);
  }

  /* ---- recording / uploading */
  if (phase === "recording" || phase === "uploading" || phase === "uploadFailed") {
    const recording = phase === "recording" && rec.state === "recording";
    const label = phase === "uploading" ? ar.scribe.uploading : phase === "uploadFailed" ? ar.scribe.uploadFailedShort : recording ? ar.scribe.recording : ar.scribe.paused;
    return (
      <Card testID="scribe-recorder" style={{ gap: space.md }}>
        {error ? <Notice tone="danger" text={error} /> : null}
        <View testID="scribe-indicator" accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: t.dangerSoft, borderRadius: radius.lg, padding: space.md }}>
          <RecDot active={recording} />
          <AppText variant="small" weight="semibold" tone="danger" style={{ flex: 1 }}>{label}</AppText>
          <AppText testID="scribe-timer" variant="heading" tone="danger" ltr>{formatClock(rec.seconds)}</AppText>
        </View>
        {phase === "recording" ? (
          <View style={{ height: 6, borderRadius: 3, backgroundColor: t.sunken, overflow: "hidden" }}>
            <View style={{ height: 6, width: `${Math.min(100, rec.level * 300)}%`, backgroundColor: t.brand[500] }} />
          </View>
        ) : (
          <View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: t.sunken, overflow: "hidden" }}>
              <View style={{ height: 8, width: `${Math.round(progress * 100)}%`, backgroundColor: phase === "uploadFailed" ? t.danger : t.primary }} />
            </View>
            <AppText variant="caption" tone="muted" ltr style={{ marginTop: 4, alignSelf: "flex-start" }}>{Math.round(progress * 100)}%</AppText>
          </View>
        )}
        {rec.autoPaused ? <Notice tone="warning" text={ar.scribe.autoPaused} /> : null}

        {phase === "recording" ? (
          <>
            <Row gap={space.sm}>
              {recording ? (
                <Button testID="scribe-pause" title={ar.scribe.pause} variant="outline" icon={<Pause size={18} color={t.fg} />} onPress={rec.pause} style={{ flex: 1 }} />
              ) : (
                <Button testID="scribe-resume" title={ar.scribe.resume} variant="outline" icon={<Play size={18} color={t.fg} />} onPress={rec.resume} style={{ flex: 1 }} />
              )}
              <Button testID="scribe-finish" title={ar.scribe.finish} icon={<Square size={18} color="#fff" />} onPress={finish} disabled={!canRun()} style={{ flex: 1 }} />
            </Row>
            {!canRun() ? <AppText variant="caption" tone="warning">{ar.scribe.uploadOffline}</AppText> : null}
            <Button testID="scribe-cancel" title={ar.scribe.cancel} variant="ghost" compact icon={<X size={16} color={t.primary} />} onPress={discardLocal} />
          </>
        ) : phase === "uploadFailed" ? (
          <>
            <AppText variant="small" tone="muted">{ar.scribe.uploadFailed}</AppText>
            {!canRun() ? <AppText variant="caption" tone="warning">{ar.scribe.uploadOffline}</AppText> : null}
            <Button testID="scribe-upload-retry" title={ar.scribe.uploadRetry} icon={<RotateCcw size={18} color="#fff" />} onPress={submit} disabled={!canRun()} />
            <Button title={ar.scribe.uploadDiscard} variant="ghost" compact icon={<Trash2 size={16} color={t.primary} />} onPress={discardLocal} />
          </>
        ) : (
          <Button title={ar.common.cancel} variant="ghost" compact onPress={() => abort.current?.()} />
        )}
      </Card>
    );
  }

  /* ---- setup */
  const blocked = mic === "blocked" || mic === "unavailable";
  return (
    <View style={{ gap: space.lg }}>
      {error ? <Notice tone="danger" text={error} /> : null}
      <Card style={{ gap: space.md }}>
        <Chips
          options={[{ value: "conversation" as const, label: ar.scribe.modeConversation }, { value: "dictation" as const, label: ar.scribe.modeDictation }]}
          selected={[mode]}
          onToggle={(v) => { setMode(v); setError(null); }}
        />
        {mode === "conversation" ? (
          <View testID="scribe-consent">
            <AppText variant="small" weight="medium" style={{ marginBottom: 6 }}>{ar.scribe.consentLabel}</AppText>
            <Chips
              options={[{ value: "verbal" as const, label: ar.scribe.consentVerbal }, { value: "written" as const, label: ar.scribe.consentWritten }]}
              selected={consent ? [consent] : []}
              onToggle={(v) => setConsent(v)}
            />
            <AppText variant="caption" tone="muted" style={{ marginTop: 6 }}>{ar.scribe.consentHint}</AppText>
          </View>
        ) : (
          <AppText variant="small" tone="muted">{ar.scribe.dictationHint}</AppText>
        )}

        {blocked ? (
          <View testID="scribe-mic-denied" style={{ backgroundColor: t.warningSoft, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
            <Row gap={space.sm}><MicOff size={18} color={t.warning} /><AppText variant="small" weight="semibold" tone="warning">{ar.scribe.micTitle}</AppText></Row>
            <AppText variant="small" tone="muted">{mic === "unavailable" ? ar.scribe.micUnavailable : ar.scribe.micDenied}</AppText>
            <Row gap={space.sm}>
              {mic === "blocked" ? <Button title={ar.scribe.micOpenSettings} variant="secondary" compact icon={<Settings size={16} color={t.primary} />} onPress={openMicSettings} style={{ flex: 1 }} /> : null}
              <Button title={ar.scribe.manual} variant="outline" compact onPress={() => router.back()} style={{ flex: 1 }} />
            </Row>
          </View>
        ) : mic !== "granted" ? (
          <Row gap={space.sm} align="flex-start">
            <Mic size={16} color={t.subtle} />
            <AppText variant="caption" tone="muted" style={{ flex: 1 }}>{ar.scribe.micRationale}</AppText>
          </Row>
        ) : null}

        <Button
          testID="scribe-start"
          title={mode === "conversation" ? ar.scribe.startConversation : ar.scribe.startDictation}
          icon={<Mic size={20} color="#fff" />}
          onPress={start}
          disabled={mic === "unavailable"}
        />
        <AppText variant="caption" tone="subtle" center>{ar.scribe.priceNote(price)}</AppText>
      </Card>

      {samples.length > 0 ? (
        <View testID="scribe-samples" style={{ borderWidth: 1.5, borderStyle: "dashed", borderColor: t.borderStrong, borderRadius: radius.lg, padding: space.md, gap: space.sm }}>
          <Row gap={6}><FlaskConical size={16} color={t.muted} /><AppText variant="small" weight="semibold" tone="muted">{ar.scribe.sampleTitle}</AppText></Row>
          {samples.map((x) => {
            const on = sample === x.id;
            return (
              <Pressable
                key={x.id}
                testID={`scribe-sample-${x.id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setSample(x.id)}
                style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: on ? t.primary : t.border, backgroundColor: on ? t.brandSoft : t.elevated }}
              >
                <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: on ? t.primary : t.borderStrong, alignItems: "center", justifyContent: "center" }}>
                  {on ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.primary }} /> : null}
                </View>
                <AppText variant="small" style={{ flex: 1 }}>{x.title}</AppText>
                <AppText variant="caption" tone="subtle">{ar.scribe.sampleSeconds(x.seconds)}</AppText>
              </Pressable>
            );
          })}
          <Button testID="scribe-sample-use" title={ar.scribe.sampleUse} variant="secondary" compact disabled={!sample || !canRun()} loading={sampleBusy} onPress={applySample} />
        </View>
      ) : null}
    </View>
  );
}

function RecDot({ active }: { active: boolean }) {
  const t = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.25, duration: 600, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, opacity]);
  return <Animated.View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: t.danger, opacity }} />;
}

/* ------------------------------------------------------------------ session state */

function SessionState({ session, encounterId, onChange }: { session: ScribeSession; encounterId: string; onChange: () => void }) {
  const t = useTheme();
  const canRun = useCanRun();
  const [busy, setBusy] = useState<"retry" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const working = session.status === "processing" || session.status === "uploaded";

  async function act(kind: "retry" | "discard") {
    setBusy(kind);
    setError(null);
    try {
      const path = { params: { path: { id: session.id } } };
      if (kind === "retry") await unwrap(api.POST("/api/v1/scribe/sessions/{id}/retry", path));
      else await unwrap(api.POST("/api/v1/scribe/sessions/{id}/discard", path));
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card testID="scribe-session" style={{ gap: space.md }}>
      {error ? <Notice tone="danger" text={error} /> : null}
      <Row gap={space.sm}>
        {working ? <ActivityIndicator color={t.primary} /> : session.status === "ready" ? <CheckCircle2 size={20} color={t.success} /> : <AudioLines size={20} color={session.status === "failed" ? t.danger : t.primary} />}
        <AppText testID="scribe-session-status" variant="body" weight="semibold" style={{ flex: 1 }}>{ar.scribe.status[session.status] ?? session.status}</AppText>
        <Badge text={ar.scribe.minutes(Math.round(session.audio_seconds / 6) / 10)} />
      </Row>
      {session.status === "ready" ? (
        <Button
          testID="scribe-open-review"
          title={ar.scribe.review}
          icon={<Sparkles size={18} color="#fff" />}
          onPress={() => router.push({ pathname: "/clinician/scribe-review", params: { session: session.id, encounter: encounterId } })}
        />
      ) : null}
      {session.status === "failed" ? (
        <>
          <AppText variant="small" tone="danger">{ar.scribe.failedNote}</AppText>
          <Button testID="scribe-retry" title={ar.scribe.retry} variant="outline" icon={<RotateCcw size={18} color={t.fg} />} loading={busy === "retry"} disabled={!canRun(busy !== null)} onPress={() => act("retry")} />
        </>
      ) : null}
      {session.status === "ready" || session.status === "failed" ? (
        <Button title={ar.scribe.discard} variant="ghost" compact loading={busy === "discard"} disabled={!canRun(busy !== null)} onPress={() => act("discard")} />
      ) : null}
    </Card>
  );
}
