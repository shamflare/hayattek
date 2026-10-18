"use client";

import * as React from "react";

import { InterpretationBadge } from "@/components/ui/status";
import type { Schemas } from "@/lib/api";
import { cn } from "@/lib/cn";
import { DISPLAY_TZ, formatDate } from "@/lib/format";
import { label } from "@/lib/i18n";

type Series = Schemas["LabTrendSeries"];
type Point = Schemas["LabTrendPoint"];

const H = 180;
const PAD = { top: 14, right: 16, bottom: 28, left: 44 };

// Plain dd/mm/yy: bidi-safe inside the LTR chart (Arabic locale output carries RTL marks).
const axisDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TZ, day: "2-digit", month: "2-digit", year: "2-digit",
});

/** Width of the chart box in CSS pixels, so text keeps its real size at any width. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(340);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function tick(n: number): string {
  const abs = Math.abs(n);
  return abs >= 100 ? n.toFixed(0) : abs >= 10 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * One test over time, one chart per unit (values in different units are never drawn on the
 * same axis). The shaded band is the reference range reported by the lab for each result.
 */
export function LabTrendChart({ series, testName }: { series: Series[]; testName: string }) {
  const usable = series.filter((s) => s.points.length > 0);
  if (usable.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">لا توجد قيم رقمية كافية لرسم التطور.</p>;
  }
  return (
    <div className="space-y-6">
      {usable.length > 1 && (
        <p className="rounded-xl bg-info-soft px-3 py-2 text-xs leading-6 text-info">
          سُجّل هذا الفحص بوحدات قياس مختلفة، لذلك تُعرض كل وحدة في رسم مستقل ولا تُقارن القيم مباشرة.
        </p>
      )}
      {usable.map((s) => (
        <SingleSeries key={s.unit} series={s} testName={testName} />
      ))}
    </div>
  );
}

function SingleSeries({ series, testName }: { series: Series; testName: string }) {
  const points = series.points;
  const [active, setActive] = React.useState(points.length - 1);
  const [boxRef, W] = useWidth<HTMLDivElement>();
  const unit = series.unit === "-" ? "" : series.unit;

  const values = points.map((p) => num(p.value) ?? 0);
  const bounds = points.flatMap((p) => [num(p.reference_low), num(p.reference_high)])
    .filter((v): v is number => v !== null);
  let min = Math.min(...values, ...bounds);
  let max = Math.max(...values, ...bounds);
  if (min === max) {
    min -= Math.abs(min) * 0.2 || 1;
    max += Math.abs(max) * 0.2 || 1;
  }
  const span = max - min;
  min -= span * 0.12;
  max += span * 0.12;
  if (min < 0 && Math.min(...values, ...bounds) >= 0) min = 0;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) =>
    points.length === 1 ? PAD.left + innerW / 2 : PAD.left + (i / (points.length - 1)) * innerW;
  const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * innerH;

  // Reference band: a step per result, since labs (and their ranges) can differ.
  const band = points.map((p, i) => {
    const lo = num(p.reference_low);
    const hi = num(p.reference_high);
    if (lo === null && hi === null) return null;
    const x0 = i === 0 ? PAD.left : (x(i - 1) + x(i)) / 2;
    const x1 = i === points.length - 1 ? W - PAD.right : (x(i) + x(i + 1)) / 2;
    const top = y(hi ?? max);
    const bottom = y(lo ?? min);
    return { x0, x1, top, bottom, key: i };
  });

  // Label the latest reference limits when the lab gave them; otherwise three even ticks.
  const last = points[points.length - 1];
  const refTicks = [num(last.reference_low), num(last.reference_high)].filter((v): v is number => v !== null);
  const ticks = refTicks.length
    ? refTicks
    : [min + (max - min) * 0.15, (min + max) / 2, max - (max - min) * 0.15];
  const path = points.map((_, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`).join(" ");
  const current: Point | undefined = points[active];

  return (
    <figure className="space-y-3">
      <figcaption className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-fg"><bdi>{testName}</bdi></span>
        {unit && <span className="num text-xs text-muted">{unit}</span>}
      </figcaption>
      <div ref={boxRef} dir="ltr" className="rounded-2xl border border-line bg-elevated">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img"
          aria-label={`تطور ${testName} عبر ${points.length} نتائج`}>
          {band.map((b) => b && (
            <rect key={b.key} x={b.x0} y={b.top} width={Math.max(b.x1 - b.x0, 0)}
              height={Math.max(b.bottom - b.top, 0)} className="fill-success/10" />
          ))}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-subtle text-[11px]">
                {tick(t)}
              </text>
            </g>
          ))}
          <path d={path} fill="none" className="stroke-brand-500" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {current && (
            <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={H - PAD.bottom}
              className="stroke-line-strong" strokeDasharray="3 3" />
          )}
          {points.map((p, i) => {
            const flagged = p.interpretation && p.interpretation !== "normal";
            return (
              <g key={`${p.report_id}-${i}`}>
                <circle cx={x(i)} cy={y(values[i])} r={i === active ? 5.5 : 4}
                  className={cn("stroke-elevated", flagged ? "fill-warning" : "fill-brand-600")} strokeWidth={2} />
                {/* Generous invisible hit target for fingers. */}
                <circle cx={x(i)} cy={y(values[i])} r={14} fill="transparent" className="cursor-pointer"
                  onMouseEnter={() => setActive(i)} onClick={() => setActive(i)}
                  onFocus={() => setActive(i)} tabIndex={0}
                  aria-label={`${formatDate(p.occurred_at)}: ${p.value} ${unit}`} />
              </g>
            );
          })}
          <text x={x(0)} y={H - 8} textAnchor={points.length === 1 ? "middle" : "start"} className="fill-subtle text-[11px]">
            {axisDate.format(new Date(points[0].occurred_at))}
          </text>
          {points.length > 1 && (
            <text x={x(points.length - 1)} y={H - 8} textAnchor="end" className="fill-subtle text-[11px]">
              {axisDate.format(new Date(points[points.length - 1].occurred_at))}
            </text>
          )}
        </svg>
      </div>
      {current && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-sunken px-3 py-2 text-sm">
          <span className="text-muted">{formatDate(current.occurred_at)}</span>
          <span className="font-semibold"><span className="num">{Number(current.value)}</span> <span className="num text-xs text-muted">{unit}</span></span>
          <InterpretationBadge value={current.interpretation || null} />
          {current.lab && <span className="text-xs text-subtle">{current.lab}</span>}
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="inline-block h-3 w-5 rounded-sm bg-success/10 ring-1 ring-success/20" />
        المجال المرجعي حسب المختبر
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-brand-600">عرض كل القيم</summary>
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
          {[...points].reverse().map((p, i) => (
            <li key={`${p.report_id}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="text-muted">{formatDate(p.occurred_at)}</span>
              <span className="flex items-center gap-2">
                <span className="num font-medium">{Number(p.value)}</span>
                {p.interpretation && p.interpretation !== "normal" && (
                  <span className="text-xs text-warning">{label("interpretation", p.interpretation)}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </figure>
  );
}
