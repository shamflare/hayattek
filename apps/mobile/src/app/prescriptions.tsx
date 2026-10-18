import { InfiniteList } from "@/components/infinite-list";
import { openRecord, RecordIcon } from "@/components/records";
import { AppText, Badge, ListRow, Row, statusTone } from "@/components/ui";
import { ar, label } from "@/i18n/ar";
import { formatShortDate, rtlSafe } from "@/lib/format";
import { usePrescriptions } from "@/lib/queries";
import { useSession } from "@/lib/session";

export default function PrescriptionsScreen() {
  const { patientId } = useSession();
  const q = usePrescriptions(patientId);
  return (
    <InfiniteList
      testID="prescriptions-list"
      query={q}
      select={(p) => p.results}
      keyOf={(rx) => rx.id}
      emptyTitle={ar.lists.prescriptionsEmpty}
      renderItem={(rx) => (
        <ListRow
          leading={<RecordIcon type="prescription" />}
          title={rtlSafe(rx.items.map((i) => i.medication_name).filter(Boolean).join("، ")) || `${ar.record.prescription} ${rx.number}`}
          subtitle={[rx.author_name, rx.organization_name].filter(Boolean).join(" · ")}
          meta={
            <Row gap={6} style={{ marginTop: 4, flexWrap: "wrap" }}>
              <Badge text={label(ar.recordStatus, rx.status)} tone={statusTone(rx.status)} />
              <Badge text={ar.lists.itemsCount(rx.items.length)} tone="accent" />
              <AppText variant="caption" tone="subtle">{formatShortDate(rx.occurred_at)}</AppText>
            </Row>
          }
          onPress={() => openRecord("prescription", rx.id)}
        />
      )}
    />
  );
}
