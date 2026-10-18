import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";

import { RowSeparator, TimelineRow } from "@/components/records";
import { AppText, Card, EmptyState, ErrorState, SkeletonList } from "@/components/ui";
import { ar } from "@/i18n/ar";
import { errorMessage } from "@/lib/api";
import { useTimeline } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/theme";

export default function TimelineScreen() {
  const t = useTheme();
  const { patientId } = useSession();
  const q = useTimeline(patientId);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const wrap = { padding: space.lg, width: "100%" as const, maxWidth: 720, alignSelf: "center" as const };

  if (!patientId) return <View style={wrap}><Card><EmptyState title={ar.home.noPatient} hint={ar.home.noPatientHint} /></Card></View>;
  if (q.isPending) return <View style={wrap}><SkeletonList rows={6} /></View>;
  if (q.isError) return <View style={wrap}><Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card></View>;

  return (
    <FlatList
      testID="timeline-list"
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={[wrap, { paddingBottom: space.xxl * 2 }]}
      data={items}
      keyExtractor={(item) => `${item.type}-${item.id}`}
      renderItem={({ item, index }) => (
        <View
          style={{
            backgroundColor: t.elevated,
            borderColor: t.border,
            borderStartWidth: 1,
            borderEndWidth: 1,
            borderTopWidth: index === 0 ? 1 : 0,
            borderBottomWidth: index === items.length - 1 ? 1 : 0,
            borderTopLeftRadius: index === 0 ? 16 : 0,
            borderTopRightRadius: index === 0 ? 16 : 0,
            borderBottomLeftRadius: index === items.length - 1 ? 16 : 0,
            borderBottomRightRadius: index === items.length - 1 ? 16 : 0,
            overflow: "hidden",
          }}
        >
          {index > 0 ? <RowSeparator /> : null}
          <TimelineRow item={item} />
        </View>
      )}
      ListEmptyComponent={<Card><EmptyState title={ar.timeline.empty} hint={ar.timeline.emptyHint} /></Card>}
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
      }}
      refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => { void q.refetch(); }} tintColor={t.primary} colors={[t.primary]} />}
      ListFooterComponent={
        q.isFetchingNextPage ? (
          <ActivityIndicator style={{ marginTop: space.lg }} color={t.primary} />
        ) : items.length > 0 && !q.hasNextPage ? (
          <AppText variant="caption" tone="subtle" center style={{ marginTop: space.lg }}>{ar.common.noMore}</AppText>
        ) : undefined
      }
    />
  );
}
