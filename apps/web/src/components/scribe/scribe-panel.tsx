"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines, CheckCircle2, FlaskConical, Mic, Pause, Play, RotateCcw, Sparkles, Square, X,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { Button, Spinner } from "@/components/ui/button";
import { ChoiceChips, Field, Select } from "@/components/ui/field";
import { Badge, Card } from "@/components/ui/surface";
import { api, errorMessage, postMultipart, type Schemas, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { WavRecorder } from "@/lib/wav-recorder";

type Session = Schemas["Session"];
type Mode = "conversation" | "dictation";

const STATUS_TEXT: Record<string, string> = {
  created: "بانتظار التسجيل", uploaded: "رُفع التسجيل", processing: "جارٍ التحليل…",
  ready: "المسودة جاهزة للمراجعة", approved: "طُبّقت على الزيارة", failed: "تعذرت المعالجة",
  discarded: "أُلغيت",
};

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replaceAll("-", "") : `${Date.now()}${Math.random()}`.replace(".", "");
}

export function ScribePanel({ encounterId }: { encounterId: string }) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["scribe", "status"],
    queryFn: () => unwrap(api.GET("/api/v1/scribe/status")),
    retry: false,
  });
  const sessions = useQuery({
    queryKey: ["scribe", "sessions", encounterId],
    queryFn: () => unwrap(api.GET("/api/v1/scribe/sessions", { params: { query: { encounter: encounterId } } })),
    refetchInterval: (q) =>
      q.state.data?.results.some((s) => s.status === "processing" || s.status === "uploaded") ? 2000 : false,
  });
  const active = sessions.data?.results.find((s) => !["approved", "discarded"].includes(s.status));
  const refresh = () => qc.invalidateQueries({ queryKey: ["scribe", "sessions", encounterId] });

  if (status.isLoading) return null;
  if (status.isError) return null; // not a verified clinician
  const s = status.data!;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 bg-gradient-to-l from-brand-600 to-brand-800 px-4 py-3 text-white">
        <Sparkles className="size-5 text-brand-200" />
        <div className="flex-1">
          <div className="font-semibold">HayatTek AI</div>
          <div className="text-xs text-white/75">المساعد الطبي الذكي</div>
        </div>
        {s.provider_is_mock && <Badge className="border-white/20 bg-white/15 text-white">تجريبي</Badge>}
      </div>
      <div className="p-4">
        {!s.enabled ? (
          <p className="text-sm leading-7 text-muted">
            الخدمة غير مفعلة لحسابك. تُفعّل من قبل إدارة المنصة. يمكنك متابعة الكتابة يدوياً.
          </p>
        ) : active && active.status !== "created" ? (
          <SessionState session={active} encounterId={encounterId} onChange={refresh} />
        ) : (
          <Recorder encounterId={encounterId} samples={s.samples as { id: string; title: string; mode: Mode; seconds: number }[]}
            existing={active} onChange={refresh} pricePerMinute={s.price_per_minute} />
        )}
        {(sessions.data?.results ?? []).filter((x) => x.status === "approved").map((x) => (
          <div key={x.id} className="mt-3 flex items-center gap-2 rounded-xl bg-success-soft px-3 py-2 text-xs text-success">
            <CheckCircle2 className="size-4" /> طُبّقت مسودة {x.mode === "dictation" ? "إملاء" : "حوار"} على هذه الزيارة
          </div>
        ))}
      </div>
    </Card>
  );
}

function Recorder({ encounterId, samples, existing, onChange, pricePerMinute }: {
  encounterId: string; samples: { id: string; title: string; mode: Mode; seconds: number }[];
  existing?: Session; onChange: () => void; pricePerMinute: string;
}) {
  const [mode, setMode] = React.useState<Mode>((existing?.mode as Mode) ?? "conversation");
  const [consent, setConsent] = React.useState<"verbal" | "written" | "">("");
  const [state, setState] = React.useState<"idle" | "recording" | "paused" | "uploading">("idle");
  const [seconds, setSeconds] = React.useState(0);
  const [level, setLevel] = React.useState(0);
  const [sample, setSample] = React.useState("");
  const recorder = React.useRef<WavRecorder | null>(null);
  const sessionRef = React.useRef<Session | null>(existing ?? null);

  React.useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => setSeconds(Math.floor(recorder.current?.seconds ?? 0)), 500);
    return () => clearInterval(id);
  }, [state]);
  React.useEffect(() => () => { recorder.current?.cancel(); }, []);

  const ensureSession = async (m: Mode) => {
    if (sessionRef.current && sessionRef.current.mode === m) return sessionRef.current;
    const session = await unwrap(api.POST("/api/v1/scribe/sessions", {
      body: { encounter: encounterId, mode: m, consent_method: m === "dictation" ? "not_required" : consent,
              client_key: newKey() } as never,
    }));
    sessionRef.current = session;
    return session;
  };

  const start = async () => {
    if (mode === "conversation" && !consent) {
      toast.error("سجّل موافقة المريض على التسجيل أولاً، أو استخدم الإملاء أو الكتابة اليدوية.");
      return;
    }
    if (!WavRecorder.isSupported()) {
      toast.error("المتصفح لا يدعم التسجيل الصوتي.");
      return;
    }
    try {
      await ensureSession(mode);
      const rec = new WavRecorder();
      rec.onLevel = (v) => setLevel(v);
      await rec.start();
      recorder.current = rec;
      setSeconds(0);
      setState("recording");
    } catch (e) {
      toast.error(e instanceof DOMException ? "لم يُسمح بالوصول إلى الميكروفون." : errorMessage(e));
    }
  };

  const finish = async () => {
    const rec = recorder.current;
    if (!rec || !sessionRef.current) return;
    setState("uploading");
    try {
      const wav = await rec.stop();
      const form = new FormData();
      form.append("file", wav, "recording.wav");
      await postMultipart(`/api/v1/scribe/sessions/${sessionRef.current.id}/audio`, form);
      toast.success("رُفع التسجيل، جارٍ التحليل");
      onChange();
    } catch (e) {
      toast.error(errorMessage(e));
      setState("idle");
    }
  };

  const useSample = useMutation({
    mutationFn: async () => {
      const chosen = samples.find((x) => x.id === sample)!;
      if (chosen.mode === "conversation" && !consent) throw new Error("consent");
      const session = await ensureSession(chosen.mode);
      return unwrap(api.POST("/api/v1/scribe/sessions/{id}/sample", {
        params: { path: { id: session.id } }, body: { sample },
      }));
    },
    onSuccess: () => { toast.success("تمت معالجة التسجيل التجريبي"); onChange(); },
    onError: (e) => toast.error(e instanceof Error && e.message === "consent"
      ? "سجّل موافقة المريض أولاً (الحوار يتطلب موافقته)." : errorMessage(e)),
  });

  if (state === "recording" || state === "paused" || state === "uploading") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-2xl bg-danger-soft p-3">
          <span className={cn("size-3 rounded-full bg-danger", state === "recording" && "animate-pulse")} />
          <span className="flex-1 text-sm font-semibold text-danger">
            {state === "recording" ? "جارٍ التسجيل" : state === "paused" ? "متوقف مؤقتاً" : "جارٍ الرفع…"}
          </span>
          <span className="num font-semibold text-danger">
            {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${Math.min(100, level * 300)}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {state === "recording" ? (
            <Button variant="outline" onClick={() => { recorder.current?.pause(); setState("paused"); }}><Pause className="size-4" /> إيقاف مؤقت</Button>
          ) : (
            <Button variant="outline" disabled={state === "uploading"} onClick={() => { recorder.current?.resume(); setState("recording"); }}><Play className="size-4" /> استئناف</Button>
          )}
          <Button loading={state === "uploading"} onClick={finish}><Square className="size-4" /> إنهاء وتحليل</Button>
        </div>
        <Button variant="ghost" size="sm" className="w-full" disabled={state === "uploading"}
          onClick={async () => { await recorder.current?.cancel(); setState("idle"); }}><X className="size-4" /> إلغاء التسجيل</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ChoiceChips value={mode} onChange={(v) => setMode(v as Mode)}
        options={[{ value: "conversation", label: "الاستماع الذكي" }, { value: "dictation", label: "الإملاء الذكي" }]} />
      {mode === "conversation" ? (
        <Field label="موافقة المريض على تسجيل الحوار" hint="لا يبدأ التسجيل دون موافقة. إن رفض المريض اكتب الزيارة يدوياً أو استخدم الإملاء.">
          <ChoiceChips value={consent} onChange={(v) => setConsent(v as typeof consent)}
            options={[{ value: "verbal", label: "وافق شفهياً" }, { value: "written", label: "موافقة مكتوبة" }]} />
        </Field>
      ) : (
        <p className="text-xs leading-6 text-muted">سجّل ملخص الزيارة بصوتك، وسيُنظّم في حقول الزيارة لتراجعه.</p>
      )}
      <Button size="lg" className="w-full" onClick={start}><Mic className="size-5" /> {mode === "conversation" ? "بدء الاستماع الذكي" : "بدء الإملاء"}</Button>
      <p className="text-center text-[11px] text-subtle">
        يُحتسب الاستخدام بعد نجاح التحليل: <span className="num">{pricePerMinute}</span> $ للدقيقة. لا شيء يُعتمد دون مراجعتك.
      </p>
      {samples.length > 0 && (
        <div className="rounded-2xl border border-dashed border-line-strong p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted"><FlaskConical className="size-3.5" /> تسجيل اختبار اصطناعي (للتجربة فقط)</div>
          <div className="flex gap-2">
            <Select value={sample} onChange={(e) => setSample(e.target.value)} className="h-9 flex-1 text-sm">
              <option value="">اختر تسجيلاً…</option>
              {samples.map((x) => <option key={x.id} value={x.id}>{x.title} ({x.seconds} ث)</option>)}
            </Select>
            <Button size="sm" variant="secondary" disabled={!sample} loading={useSample.isPending} onClick={() => useSample.mutate()}>استخدام</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SessionState({ session, encounterId, onChange }: { session: Session; encounterId: string; onChange: () => void }) {
  const retry = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/scribe/sessions/{id}/retry", { params: { path: { id: session.id } } })),
    onSuccess: onChange,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const discard = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/scribe/sessions/{id}/discard", { params: { path: { id: session.id } } })),
    onSuccess: onChange,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        {session.status === "processing" || session.status === "uploaded" ? <Spinner className="size-4 text-brand-600" /> : <AudioLines className="size-4 text-brand-600" />}
        <span className="font-medium">{STATUS_TEXT[session.status] ?? session.status}</span>
        <span className="num ms-auto text-xs text-subtle">{Math.round(session.audio_seconds / 6) / 10} د</span>
      </div>
      {session.status === "ready" && (
        <Button asChild size="lg" className="w-full">
          <Link href={`/app/encounters/${encounterId}/scribe/${session.id}`}><Sparkles className="size-4" /> مراجعة المسودة الذكية</Link>
        </Button>
      )}
      {session.status === "failed" && (
        <>
          <p className="text-xs text-danger">لم تُحتسب أي رسوم لهذه المحاولة. يمكنك إعادة المحاولة أو الكتابة يدوياً.</p>
          <Button className="w-full" variant="outline" loading={retry.isPending} onClick={() => retry.mutate()}><RotateCcw className="size-4" /> إعادة المحاولة</Button>
        </>
      )}
      {["ready", "failed"].includes(session.status) && (
        <Button variant="ghost" size="sm" className="w-full" loading={discard.isPending} onClick={() => discard.mutate()}>تجاهل وحذف التسجيل</Button>
      )}
    </div>
  );
}
