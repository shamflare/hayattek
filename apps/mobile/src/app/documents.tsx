import { InfiniteList } from "@/components/infinite-list";
import { openRecord, RecordIcon } from "@/components/records";
import { AppText, Badge, ListRow, Row, statusTone } from "@/components/ui";
import { ar, label } from "@/i18n/ar";
import { formatBytes, formatShortDate } from "@/lib/format";
import { useDocuments } from "@/lib/queries";
import { useSession } from "@/lib/session";

export default function DocumentsScreen() {
  const { patientId } = useSession();
  const q = useDocuments(patientId);
  return (
    <InfiniteList
      testID="documents-list"
      query={q}
      select={(p) => p.results}
      keyOf={(d) => d.id}
      emptyTitle={ar.lists.documentsEmpty}
      renderItem={(d) => (
        <ListRow
          leading={<RecordIcon type="document" />}
          title={d.title || d.original_filename}
          subtitle={[label(ar.documentCategories, d.category), d.organization_name].filter(Boolean).join(" · ")}
          meta={
            <Row gap={6} style={{ marginTop: 4, flexWrap: "wrap" }}>
              <Badge text={label(ar.recordStatus, d.status)} tone={statusTone(d.status)} />
              <AppText variant="caption" tone="subtle">{formatShortDate(d.document_date || d.occurred_at)} · {formatBytes(d.size_bytes)}</AppText>
            </Row>
          }
          onPress={() => openRecord("document", d.id)}
        />
      )}
    />
  );
}
