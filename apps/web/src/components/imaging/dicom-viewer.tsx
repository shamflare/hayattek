"use client";

/**
 * Lightweight DICOM review viewer (ADR-031: lightweight viewer, not OHIF, for now).
 *
 * Frames are rendered server-side (Orthanc via the authorized Django proxy) and fetched as
 * blobs with the same headers as every API call, so the browser never sees the image store.
 * NOT cleared for clinical diagnosis: the banner says so on every screen.
 */

import { MEMBERSHIP_HEADER } from "@hayat/api-client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  ChevronDown, ChevronUp, Hand, Layers, Maximize, RotateCcw, ScanLine, ShieldAlert, ZoomIn, ZoomOut,
} from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/app/page-header";
import { Button, Spinner } from "@/components/ui/button";
import { Badge, Card, CardBody, EmptyState, ErrorState, Skeleton } from "@/components/ui/surface";
import { api, errorMessage, getActiveMembership, patientApi, type Schemas, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { label } from "@/lib/i18n";

type Study = Schemas["DicomStudy"];
type Series = Schemas["DicomSeries"];
type Slice = { instance: string; frame: number; number: number | null };

const PRESET_LABELS: Record<string, string> = {
  default: "افتراضي",
  soft_tissue: "أنسجة رخوة",
  lung: "رئة",
  bone: "عظم",
  brain: "دماغ",
  abdomen: "بطن",
};

const MODALITY_LABELS: Record<string, string> = {
  CT: "طبقي محوري", MR: "رنين مغناطيسي", CR: "أشعة بسيطة", DX: "أشعة بسيطة", US: "إيكو",
  MG: "تصوير الثدي", XA: "تصوير وعائي", NM: "طب نووي", PT: "PET", OT: "أخرى",
};

export function modalityLabel(code: string) {
  return MODALITY_LABELS[code] ?? code;
}

export function ReviewOnlyBanner() {
  return (
    <div role="note" className="mb-4 flex items-start gap-2.5 rounded-2xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-fg">
      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" />
      <div>
        <strong>عارض للمراجعة فقط — غير معتمد للتشخيص السريري.</strong>{" "}
        <span className="text-muted">الصور معروضة بدقة شاشة مخفّضة؛ للقراءة التشخيصية استخدم محطة تصوير معتمدة.</span>
      </div>
    </div>
  );
}

const MAX_CACHED = 240;

/** Authenticated blob fetch for one rendered frame (no Orthanc URL ever reaches the page). */
function useFrameCache(documentId: string, withContext: boolean) {
  const cache = React.useRef(new Map<string, Promise<string>>());
  React.useEffect(() => {
    const map = cache.current;
    return () => {
      map.forEach((p) => p.then((u) => URL.revokeObjectURL(u)).catch(() => undefined));
      map.clear();
    };
  }, []);
  return React.useCallback((slice: Slice, preset: string): Promise<string> => {
    const key = `${slice.instance}:${slice.frame}:${preset}`;
    const hit = cache.current.get(key);
    if (hit) {
      cache.current.delete(key);
      cache.current.set(key, hit); // LRU touch
      return hit;
    }
    const headers: Record<string, string> = {};
    const membership = withContext ? getActiveMembership() : null;
    if (membership) headers[MEMBERSHIP_HEADER] = membership;
    const qs = new URLSearchParams({ frame: String(slice.frame), preset });
    const promise = fetch(`/api/v1/dicom/documents/${documentId}/instances/${slice.instance}/rendered?${qs}`,
      { headers, credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) throw new Error("frame failed");
        return URL.createObjectURL(await r.blob());
      });
    promise.catch(() => cache.current.delete(key));
    cache.current.set(key, promise);
    while (cache.current.size > MAX_CACHED) {
      const oldest = cache.current.keys().next().value as string;
      cache.current.get(oldest)?.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
      cache.current.delete(oldest);
    }
    return promise;
  }, [documentId, withContext]);
}

export function DicomViewerPage({ documentId, portal = false, back }: { documentId: string; portal?: boolean; back?: string }) {
  const client = portal ? patientApi : api;
  const study = useQuery({
    queryKey: ["dicom", documentId, portal ? "portal" : "staff"],
    queryFn: () => unwrap(client.GET("/api/v1/dicom/documents/{id}", { params: { path: { id: documentId } } })),
    // Opening a study is audited once; do not refetch on focus. Poll only while preparing.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 3000 : false),
  });

  return (
    <div className="mx-auto max-w-6xl pb-28">
      <PageHeader back={back ?? (study.data ? `/app/patients/${study.data.patient}` : undefined)} eyebrow="عارض الصور الطبية"
        title={study.data?.title ?? "دراسة تصوير"}
        description={study.data ? <StudyLine study={study.data} /> : undefined} />
      <ReviewOnlyBanner />
      {study.isLoading ? (
        <Skeleton className="h-[60vh] w-full rounded-card" />
      ) : study.isError ? (
        <ErrorState message={errorMessage(study.error)} onRetry={() => study.refetch()} />
      ) : study.data!.status === "pending" ? (
        <Card><EmptyState icon={<Spinner className="size-7" />} title="جارٍ تجهيز الصور للعرض"
          description="يُفحص الملف أمنياً ثم يُرسل إلى مخزن الصور الخاص. تتحدث الصفحة تلقائياً." /></Card>
      ) : study.data!.status === "failed" ? (
        <ErrorState message="تعذر تجهيز هذه الدراسة للعرض. يمكنك تنزيل الملف الأصلي من السجل، أو أبلغ مدير المنشأة." />
      ) : (
        <StudyViewer study={study.data!} portal={portal} />
      )}
    </div>
  );
}

function StudyLine({ study }: { study: Study }) {
  const modalities = study.modalities ? study.modalities.split(",").map(modalityLabel).join("، ") : label("documentCategories", study.category);
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{modalities}</span>
      {study.study_date && <span>{formatDate(study.study_date)}</span>}
      {study.organization_name && <span>{study.organization_name}</span>}
    </span>
  );
}

function StudyViewer({ study, portal }: { study: Study; portal: boolean }) {
  const client = portal ? patientApi : api;
  const series = useInfiniteQuery({
    queryKey: ["dicom", study.document, "series"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => unwrap(client.GET("/api/v1/dicom/documents/{id}/series", {
      params: { path: { id: study.document }, query: { page: pageParam } },
    })),
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
  });
  const allSeries = series.data?.pages.flatMap((p) => p.results) ?? [];
  const [selected, setSelected] = React.useState<string | null>(null);
  const current = allSeries.find((s) => s.id === selected) ?? allSeries[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="min-w-0">
        {series.isLoading ? <Skeleton className="h-[60vh] w-full rounded-card" />
          : series.isError ? <ErrorState message={errorMessage(series.error)} onRetry={() => series.refetch()} />
            : current ? <SeriesViewer key={current.id} documentId={study.document} series={current} portal={portal} presets={study.window_presets} />
              : <Card><EmptyState icon={<Layers className="size-7" />} title="لا توجد سلاسل صور في هذه الدراسة" /></Card>}
      </div>
      <aside className="space-y-4">
        <Card>
          <CardBody className="space-y-2 text-sm">
            <div className="font-semibold">معلومات الدراسة</div>
            <Info label="النوع" value={study.modalities ? study.modalities.split(",").map(modalityLabel).join("، ") : "—"} />
            <Info label="التاريخ" value={study.study_date ? formatDate(study.study_date) : "—"} />
            <Info label="الوصف" value={study.study_description || "—"} />
            <Info label="السلاسل" value={<span className="num">{study.series_count}</span>} />
            <Info label="عدد الصور" value={<span className="num">{study.instance_count}</span>} />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-2">
            <div className="text-sm font-semibold">السلاسل</div>
            <ul className="space-y-1.5">
              {allSeries.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setSelected(s.id)}
                    className={cn("flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-start text-sm transition-colors",
                      s.id === current?.id ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-line hover:bg-sunken")}>
                    <ScanLine className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate"><bdi>{s.description || `سلسلة ${s.number ?? ""}`}</bdi></span>
                    <Badge>{s.modality || "—"}</Badge>
                    <span className="num text-xs text-muted">{s.instance_count}</span>
                  </button>
                </li>
              ))}
            </ul>
            {series.hasNextPage && (
              <Button variant="outline" size="sm" className="w-full" loading={series.isFetchingNextPage} onClick={() => series.fetchNextPage()}>
                سلاسل أخرى
              </Button>
            )}
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}

function Info({ label: name, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{name}</span>
      <span className="text-end">{value}</span>
    </div>
  );
}

function SeriesViewer({ documentId, series, portal, presets }: { documentId: string; series: Series; portal: boolean; presets: string[] }) {
  const client = portal ? patientApi : api;
  // Instances come in pages of up to 1000; large series keep loading in the background.
  const instances = useInfiniteQuery({
    queryKey: ["dicom", documentId, "series", series.id],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => unwrap(client.GET("/api/v1/dicom/documents/{id}/series/{series_id}/instances", {
      params: { path: { id: documentId, series_id: series.id }, query: { page: pageParam, page_size: 1000 } },
    })),
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
  });
  React.useEffect(() => {
    if (instances.hasNextPage && !instances.isFetchingNextPage) instances.fetchNextPage();
  }, [instances]);

  const slices = React.useMemo<Slice[]>(() => (instances.data?.pages.flatMap((p) => p.results) ?? [])
    .flatMap((i) => Array.from({ length: i.frames }, (_, f) => ({ instance: i.id, frame: f, number: i.instance_number }))),
  [instances.data]);

  const [index, setIndex] = React.useState(0);
  const [preset, setPreset] = React.useState("default");
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  // Last settled frame; "loading" = the wanted frame is not the one on screen yet.
  const [shown, setShown] = React.useState<{ key: string; url: string | null; error: boolean }>({ key: "", url: null, error: false });
  const getFrame = useFrameCache(documentId, !portal);
  const viewport = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const count = slices.length;
  const clamp = React.useCallback((i: number) => Math.max(0, Math.min(count - 1, i)), [count]);
  const step = React.useCallback((d: number) => setIndex((i) => clamp(i + d)), [clamp]);
  const zoomBy = (f: number) => setZoom((z) => Math.max(0.5, Math.min(8, +(z * f).toFixed(3))));
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // Load the current slice, then prefetch neighbours for smooth scrolling.
  React.useEffect(() => {
    if (!count) return;
    let alive = true;
    const slice = slices[clamp(index)];
    const key = `${slice.instance}:${slice.frame}:${preset}`;
    getFrame(slice, preset)
      .then((u) => { if (alive) setShown({ key, url: u, error: false }); })
      .catch(() => { if (alive) setShown((s) => ({ ...s, key, error: true })); });
    for (const d of [1, -1, 2, 3, -2]) {
      const n = index + d;
      if (n >= 0 && n < count) getFrame(slices[n], preset).catch(() => undefined);
    }
    return () => { alive = false; };
  }, [index, preset, slices, count, clamp, getFrame]);

  // Wheel scrolls slices; Ctrl/⌘ + wheel zooms. Non-passive so the page does not scroll.
  React.useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
      else step(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [step]);

  const onKey = (e: React.KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => step(1), ArrowRight: () => step(1), PageDown: () => step(10),
      ArrowUp: () => step(-1), ArrowLeft: () => step(-1), PageUp: () => step(-10),
      Home: () => setIndex(0), End: () => setIndex(count - 1),
      "+": () => zoomBy(1.25), "=": () => zoomBy(1.25), "-": () => zoomBy(0.8), "0": reset,
    };
    const fn = keys[e.key];
    if (fn) { e.preventDefault(); fn(); }
  };

  if (instances.isLoading) return <Skeleton className="h-[60vh] w-full rounded-card" />;
  if (instances.isError) return <ErrorState message={errorMessage(instances.error)} onRetry={() => instances.refetch()} />;
  if (!count) return <Card><EmptyState icon={<Layers className="size-7" />} title="لا توجد صور في هذه السلسلة" /></Card>;

  const current = slices[clamp(index)];
  const src = shown.url;
  const frameError = shown.error;
  const loading = shown.key !== `${current.instance}:${current.frame}:${preset}`;
  return (
    <div className="space-y-3">
      <div
        ref={viewport}
        tabIndex={0}
        onKeyDown={onKey}
        aria-label="منطقة عرض الصورة: العجلة أو الأسهم للتنقل بين المقاطع، Ctrl مع العجلة للتكبير، والسحب للتحريك"
        className="relative h-[62vh] min-h-[320px] cursor-grab touch-none active:cursor-grabbing select-none overflow-hidden rounded-card bg-black outline-none ring-brand-500 focus-visible:ring-2"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPan({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={reset}
      >
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`مقطع ${index + 1} من ${count}`} draggable={false}
            className="pointer-events-none absolute inset-0 size-full object-contain"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center" }} />
        )}
        {frameError && <div className="absolute inset-0 grid place-items-center text-sm text-white/80">تعذر تحميل هذا المقطع.</div>}
        <div dir="ltr" className="pointer-events-none absolute start-3 top-3 space-y-0.5 font-mono text-xs text-white/85 [text-shadow:0_1px_2px_#000]">
          <div>{series.modality} · <bdi>{series.description}</bdi></div>
          <div>Img {index + 1}/{count}{current.number != null ? ` (#${current.number})` : ""}{current.frame ? ` f${current.frame + 1}` : ""}</div>
          <div>W/L: <bdi>{PRESET_LABELS[preset] ?? preset}</bdi> · {Math.round(zoom * 100)}%</div>
        </div>
        <div className="pointer-events-none absolute bottom-3 end-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] text-amber-200">للمراجعة فقط</div>
        {loading && <Spinner className="absolute bottom-3 start-3 size-5 text-white/80" />}
      </div>

      <div className="flex flex-wrap items-center gap-2" dir="ltr">
        <Button variant="outline" size="icon" aria-label="المقطع السابق" onClick={() => step(-1)} disabled={index === 0}><ChevronUp className="size-4" /></Button>
        <input type="range" min={1} max={count} value={index + 1} onChange={(e) => setIndex(clamp(Number(e.target.value) - 1))}
          aria-label="المقطع" className="h-2 min-w-40 flex-1 accent-brand-600" />
        <Button variant="outline" size="icon" aria-label="المقطع التالي" onClick={() => step(1)} disabled={index >= count - 1}><ChevronDown className="size-4" /></Button>
        <span className="num w-20 text-center text-sm text-muted">{index + 1} / {count}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="تكبير" onClick={() => zoomBy(1.25)}><ZoomIn className="size-4" /></Button>
          <Button variant="outline" size="icon" aria-label="تصغير" onClick={() => zoomBy(0.8)}><ZoomOut className="size-4" /></Button>
          <Button variant="outline" size="icon" aria-label="ملاءمة" onClick={reset}><Maximize className="size-4" /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="إعداد العرض (النافذة/المستوى)">
          {presets.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={preset === p} onClick={() => setPreset(p)}
              className={cn("h-8 rounded-full border px-3 text-xs transition-colors",
                preset === p ? "border-brand-500 bg-brand-500 text-white" : "border-line bg-elevated text-muted hover:text-fg")}>
              {PRESET_LABELS[p] ?? p}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="ms-auto" onClick={() => { reset(); setPreset("default"); }}>
          <RotateCcw className="size-4" /> إعادة الضبط
        </Button>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-subtle">
        <Hand className="size-3.5" /> العجلة أو الأسهم: التنقل بين المقاطع · Ctrl + العجلة أو +/−: تكبير · السحب: تحريك · نقر مزدوج: إعادة الضبط
      </p>
    </div>
  );
}
