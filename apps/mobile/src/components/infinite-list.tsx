import { type ReactElement, type ReactNode } from "react";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";

import { RowSeparator } from "@/components/records";
import { AppText, Card, EmptyState, ErrorState, SkeletonList } from "@/components/ui";
import { ar } from "@/i18n/ar";
import { errorMessage } from "@/lib/api";
import { space, useTheme } from "@/theme";

/** Paginated list inside one rounded card, with skeleton / empty / error states. */
export function InfiniteList<P, T>({
  query, select, keyOf, renderItem, emptyTitle, emptyHint, header, testID,
}: {
  query: UseInfiniteQueryResult<InfiniteData<P>, Error>;
  select: (page: P) => T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactElement;
  emptyTitle: string;
  emptyHint?: string;
  header?: ReactNode;
  testID?: string;
}) {
  const t = useTheme();
  const wrap = { padding: space.lg, width: "100%" as const, maxWidth: 720, alignSelf: "center" as const };
  if (query.isPending) return <View style={wrap}>{header}<SkeletonList rows={5} /></View>;
  if (query.isError) return <View style={wrap}>{header}<Card><ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} /></Card></View>;

  const items = query.data.pages.flatMap(select);
  const last = items.length - 1;
  return (
    <FlatList
      testID={testID}
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={[wrap, { paddingBottom: space.xxl * 2 }]}
      data={items}
      keyExtractor={keyOf}
      ListHeaderComponent={header ? <>{header}</> : undefined}
      renderItem={({ item, index }) => (
        <View
          style={{
            backgroundColor: t.elevated, borderColor: t.border, borderStartWidth: 1, borderEndWidth: 1,
            borderTopWidth: index === 0 ? 1 : 0, borderBottomWidth: index === last ? 1 : 0,
            borderTopLeftRadius: index === 0 ? 16 : 0, borderTopRightRadius: index === 0 ? 16 : 0,
            borderBottomLeftRadius: index === last ? 16 : 0, borderBottomRightRadius: index === last ? 16 : 0,
            overflow: "hidden",
          }}
        >
          {index > 0 ? <RowSeparator /> : null}
          {renderItem(item)}
        </View>
      )}
      ListEmptyComponent={<Card><EmptyState title={emptyTitle} hint={emptyHint} /></Card>}
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
      }}
      refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => { void query.refetch(); }} tintColor={t.primary} colors={[t.primary]} />}
      ListFooterComponent={
        query.isFetchingNextPage ? <ActivityIndicator style={{ marginTop: space.lg }} color={t.primary} /> :
        items.length > 0 && !query.hasNextPage ? <AppText variant="caption" tone="subtle" center style={{ marginTop: space.lg }}>{ar.common.noMore}</AppText> : undefined
      }
    />
  );
}
