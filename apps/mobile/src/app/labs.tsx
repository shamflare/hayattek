import { InfiniteList } from "@/components/infinite-list";
import { openRecord, RecordIcon } from "@/components/records";
import { AppText, Badge, ListRow, Row, statusTone } from "@/components/ui";
import { ar, label } from "@/i18n/ar";
import { formatShortDate } from "@/lib/format";
import { useLabReports } from "@/lib/queries";
import { useSession } from "@/lib/session";

const ABNORMAL = new Set(["low", "high", "critical_low", "critical_high", "abnormal"]);

export default function LabsScreen() {
  const { patientId } = useSession();
  const q = useLabReports(patientId);
  return (
    <InfiniteList
      testID="labs-list"
      query={q}
      select={(p) => p.results}
      keyOf={(r) => r.id}
      emptyTitle={ar.lists.labsEmpty}
      renderItem={(r) => {
        const abnormal = r.observations.filter((o) => o.interpretation && ABNORMAL.has(o.interpretation)).length;
        return (
          <ListRow
            leading={<RecordIcon type="lab_report" />}
            title={r.title}
            subtitle={[r.organization_name || r.external_lab_name, r.author_name].filter(Boolean).join(" · ")}
            meta={
              <Row gap={6} style={{ marginTop: 4, flexWrap: "wrap" }}>
                <Badge text={label(ar.recordStatus, r.status)} tone={statusTone(r.status)} />
                {abnormal > 0 ? <Badge text={ar.lists.abnormal(abnormal)} tone="warning" /> : null}
                <AppText variant="caption" tone="subtle">{formatShortDate(r.occurred_at)}</AppText>
              </Row>
            }
            onPress={() => openRecord("lab_report", r.id)}
          />
        );
      }}
    />
  );
}
