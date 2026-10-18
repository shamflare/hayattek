import { View } from "react-native";
import { router } from "expo-router";
import { Bell, CheckCheck } from "lucide-react-native";

import { InfiniteList } from "@/components/infinite-list";
import { AppText, Badge, Button, IconBubble, Row } from "@/components/ui";
import { ar, label } from "@/i18n/ar";
import type { Schemas } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useMarkRead, useNotifications, useUnreadCount } from "@/lib/queries";
import { space, useTheme } from "@/theme";

/** Map server deep links (web paths) onto app screens where one exists. */
function targetFor(n: Schemas["Notification"]): (() => void) | null {
  if (n.kind === "access_request" || n.kind === "access_granted") return () => router.navigate("/consent");
  if (n.kind === "lab_result") return () => router.push("/labs");
  if (n.kind === "new_record") return () => router.navigate("/timeline");
  return null;
}

export default function NotificationsScreen() {
  const t = useTheme();
  const q = useNotifications();
  const unread = useUnreadCount();
  const mark = useMarkRead();

  return (
    <InfiniteList
      testID="notifications-list"
      query={q}
      select={(p) => p.results}
      keyOf={(n) => n.id}
      emptyTitle={ar.notifications.empty}
      header={
        unread.data && unread.data.unread > 0 ? (
          <Button
            title={ar.notifications.markAll}
            variant="secondary"
            compact
            icon={<CheckCheck size={18} color={t.primary} />}
            onPress={() => mark.mutate("all")}
            loading={mark.isPending && mark.variables === "all"}
            style={{ alignSelf: "flex-start", marginBottom: space.md }}
          />
        ) : null
      }
      renderItem={(n) => {
        const isUnread = !n.read_at;
        const go = targetFor(n);
        return (
          <View style={{ padding: space.lg, gap: 4, backgroundColor: isUnread ? t.brandSoft : "transparent" }}>
            <Row gap={space.md} align="flex-start">
              <IconBubble tone={isUnread ? "accent" : "brand"}><Bell size={20} color={isUnread ? t.accent : t.primary} /></IconBubble>
              <View style={{ flex: 1, gap: 2 }}>
                <Row gap={6} style={{ flexWrap: "wrap" }}>
                  <Badge text={label(ar.notifications.kinds, n.kind)} tone="brand" />
                  {isUnread ? <Badge text={ar.notifications.unread} tone="accent" /> : null}
                </Row>
                <AppText variant="body" weight={isUnread ? "semibold" : "regular"}>{n.title}</AppText>
                {n.body ? <AppText variant="small" tone="muted">{n.body}</AppText> : null}
                <AppText variant="caption" tone="subtle">{formatDateTime(n.created_at)}</AppText>
                <Row gap={space.sm} style={{ marginTop: 4 }}>
                  {go ? <Button title={ar.common.viewDetails} variant="ghost" compact onPress={() => { if (isUnread) mark.mutate(n.id); go(); }} /> : null}
                  {isUnread ? (
                    <Button title={ar.notifications.markRead} variant="outline" compact onPress={() => mark.mutate(n.id)} loading={mark.isPending && mark.variables === n.id} />
                  ) : null}
                </Row>
              </View>
            </Row>
          </View>
        );
      }}
    />
  );
}
