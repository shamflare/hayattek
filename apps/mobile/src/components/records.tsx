import { View } from "react-native";
import { router } from "expo-router";
import {
  ClipboardList,
  FileText,
  FlaskConical,
  Pill,
  ScanLine,
  Send,
  Stethoscope,
  TestTube,
  type LucideIcon,
} from "lucide-react-native";

import { AppText, Badge, IconBubble, ListRow, Row, statusTone } from "@/components/ui";
import { ar, label } from "@/i18n/ar";
import type { Schemas } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { DETAIL_TYPES, type RecordType } from "@/lib/queries";
import { useTheme } from "@/theme";

const typeIcons: Record<string, { icon: LucideIcon; tone: "brand" | "accent" | "info" | "warning" | "success" }> = {
  encounter: { icon: Stethoscope, tone: "brand" },
  prescription: { icon: Pill, tone: "accent" },
  lab_report: { icon: FlaskConical, tone: "info" },
  imaging_report: { icon: ScanLine, tone: "warning" },
  document: { icon: FileText, tone: "success" },
  service_request: { icon: TestTube, tone: "info" },
  referral: { icon: Send, tone: "brand" },
};

export function RecordIcon({ type }: { type: string }) {
  const t = useTheme();
  const entry = typeIcons[type] ?? { icon: ClipboardList, tone: "brand" as const };
  const Icon = entry.icon;
  const color = { brand: t.primary, accent: t.accent, info: t.info, warning: t.warning, success: t.success }[entry.tone];
  return (
    <IconBubble tone={entry.tone}>
      <Icon size={22} color={color} />
    </IconBubble>
  );
}

export function openRecord(type: string, id: string) {
  router.push({ pathname: "/record/[type]/[id]", params: { type, id } });
}

export function TimelineRow({ item }: { item: Schemas["TimelineItem"] }) {
  const canOpen = DETAIL_TYPES.includes(item.type as RecordType);
  const who = [item.author_name, item.organization_name].filter(Boolean).join(" · ");
  return (
    <ListRow
      testID={`timeline-${item.type}`}
      leading={<RecordIcon type={item.type} />}
      title={item.title}
      subtitle={who || null}
      meta={
        <Row gap={6} style={{ marginTop: 4, flexWrap: "wrap" }}>
          <Badge text={label(ar.timeline.types, item.type)} tone="brand" />
          <Badge text={label(ar.recordStatus, item.status)} tone={statusTone(item.status)} />
          {item.source === "patient" ? <Badge text={ar.recordSource.patient} tone="accent" /> : null}
          <AppText variant="caption" tone="subtle">{formatShortDate(item.occurred_at)}</AppText>
        </Row>
      }
      onPress={canOpen ? () => openRecord(item.type, item.id) : undefined}
    />
  );
}

/** Thin separator used inside list cards. */
export function RowSeparator() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.border, marginHorizontal: 16 }} />;
}
