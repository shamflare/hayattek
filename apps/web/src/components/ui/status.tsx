import { label } from "@/lib/i18n";

import { Badge, type Tone } from "./surface";

const recordTone: Record<string, Tone> = {
  draft: "warning",
  final: "success",
  amended: "info",
  entered_in_error: "danger",
};

export function RecordStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={recordTone[status] ?? "neutral"} dot>
      {label("recordStatus", status)}
    </Badge>
  );
}

const fulfillmentTone: Record<string, Tone> = {
  requested: "warning",
  received: "info",
  in_progress: "brand",
  completed: "success",
  cancelled: "neutral",
};

export function FulfillmentBadge({ status }: { status: string }) {
  return <Badge tone={fulfillmentTone[status] ?? "neutral"}>{label("fulfillment", status)}</Badge>;
}

const interpretationTone: Record<string, Tone> = {
  normal: "success",
  low: "warning",
  high: "warning",
  critical_low: "danger",
  critical_high: "danger",
  abnormal: "danger",
};

export function InterpretationBadge({ value }: { value?: string | null }) {
  if (!value) return null;
  return <Badge tone={interpretationTone[value] ?? "neutral"}>{label("interpretation", value)}</Badge>;
}

export function SourceBadge({ source }: { source: string }) {
  if (source === "patient") return <Badge tone="accent">أضافه المريض</Badge>;
  if (source === "document_import") return <Badge tone="info">مستند مستورد</Badge>;
  return null;
}
