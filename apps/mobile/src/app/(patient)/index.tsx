import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Bell, CreditCard, FileText, FlaskConical, Pill, ShieldAlert, UserRound } from "lucide-react-native";

import { RowSeparator, TimelineRow } from "@/components/records";
import { Screen } from "@/components/screen";
import { AppText, Button, Card, EmptyState, ErrorState, Row, SectionTitle, SkeletonList } from "@/components/ui";
import { ar } from "@/i18n/ar";
import { errorMessage } from "@/lib/api";
import { formatHealthNumber, greeting } from "@/lib/format";
import { useAccessRequests, useTimeline, useUnreadCount } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { radius, space, useTheme } from "@/theme";

export default function HomeScreen() {
  const t = useTheme();
  const { me, patientId, patientName } = useSession();
  const requests = useAccessRequests();
  const timeline = useTimeline(patientId);
  const unread = useUnreadCount();

  const pending = requests.data?.filter((r) => r.status === "pending") ?? [];
  const latest = timeline.data?.pages[0]?.items.slice(0, 5) ?? [];
  const healthNumber =
    me?.patient?.id === patientId ? me?.patient?.health_number : me?.wards.find((w) => w.id === patientId)?.health_number;
  const isWard = !!patientId && me?.patient?.id !== patientId;

  const refreshing = requests.isRefetching || timeline.isRefetching;
  const refresh = () => {
    void requests.refetch();
    void timeline.refetch();
    void unread.refetch();
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ backgroundColor: t.cardHero, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
        <SafeAreaView edges={["top"]}>
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl, maxWidth: 720, width: "100%", alignSelf: "center" }}>
            <Row style={{ justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <AppText variant="small" tone="onPrimary" style={{ opacity: 0.85 }}>
                  {greeting() === "morning" ? ar.home.greetingMorning : ar.home.greetingEvening}
                </AppText>
                <AppText variant="title" tone="onPrimary" numberOfLines={1} testID="home-greeting">{me?.full_name}</AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={ar.notifications.title}
                onPress={() => router.push("/notifications")}
                style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}
              >
                <Bell size={22} color="#fff" />
                {unread.data && unread.data.unread > 0 ? (
                  <View style={{ position: "absolute", top: 8, end: 8, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: t.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
                    <AppText variant="caption" tone="onPrimary" weight="bold" style={{ fontSize: 11, lineHeight: 16 }}>{unread.data.unread}</AppText>
                  </View>
                ) : null}
              </Pressable>
            </Row>
            {patientId ? (
              <Pressable onPress={() => router.navigate("/card")} accessibilityRole="button" style={{ marginTop: space.lg, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: radius.lg, padding: space.md, flexDirection: "row", alignItems: "center", gap: space.md }}>
                <CreditCard size={26} color="#fff" />
                <View style={{ flex: 1 }}>
                  <AppText variant="caption" tone="onPrimary" style={{ opacity: 0.85 }}>
                    {isWard ? `${ar.home.viewing}: ${patientName ?? ""}` : ar.home.healthNumber}
                  </AppText>
                  <AppText variant="heading" tone="onPrimary" ltr style={{ letterSpacing: 1.5 }}>{formatHealthNumber(healthNumber)}</AppText>
                </View>
              </Pressable>
            ) : null}
          </View>
        </SafeAreaView>
      </View>

      <Screen refreshing={refreshing} onRefresh={refresh} testID="home-screen">
        {!patientId ? (
          <Card>
            <EmptyState icon={<UserRound size={28} color={t.primary} />} title={ar.home.noPatient} hint={ar.home.noPatientHint} />
          </Card>
        ) : null}

        {pending.length > 0 ? (
          <Pressable onPress={() => router.navigate("/consent")} accessibilityRole="button" testID="pending-banner">
            <View style={{ backgroundColor: t.accentSoft, borderRadius: radius.lg, padding: space.lg, flexDirection: "row", alignItems: "center", gap: space.md, borderWidth: 1, borderColor: t.accent }}>
              <ShieldAlert size={28} color={t.accent} />
              <View style={{ flex: 1 }}>
                <AppText variant="body" weight="semibold">{ar.home.pendingTitle(pending.length)}</AppText>
                <AppText variant="small" tone="muted" numberOfLines={1}>
                  {pending.map((p) => p.organization_name).join("، ")}
                </AppText>
              </View>
              <Button title={ar.home.pendingAction} compact onPress={() => router.navigate("/consent")} />
            </View>
          </Pressable>
        ) : null}

        {patientId ? (
          <>
            <SectionTitle title={ar.home.quick} />
            <Row gap={space.sm} style={{ flexWrap: "wrap" }}>
              <QuickTile label={ar.lists.prescriptions} icon={<Pill size={24} color={t.accent} />} onPress={() => router.push("/prescriptions")} />
              <QuickTile label={ar.lists.labs} icon={<FlaskConical size={24} color={t.info} />} onPress={() => router.push("/labs")} />
              <QuickTile label={ar.lists.documents} icon={<FileText size={24} color={t.success} />} onPress={() => router.push("/documents")} />
            </Row>

            <SectionTitle
              title={ar.home.latest}
              action={<Button title={ar.common.viewAll} variant="ghost" compact onPress={() => router.navigate("/timeline")} />}
            />
            {timeline.isPending ? (
              <SkeletonList rows={3} />
            ) : timeline.isError ? (
              <Card><ErrorState message={errorMessage(timeline.error)} onRetry={() => timeline.refetch()} /></Card>
            ) : latest.length === 0 ? (
              <Card><EmptyState title={ar.timeline.empty} hint={ar.timeline.emptyHint} /></Card>
            ) : (
              <Card padded={false} style={{ overflow: "hidden" }}>
                {latest.map((item, i) => (
                  <View key={`${item.type}-${item.id}`}>
                    {i > 0 ? <RowSeparator /> : null}
                    <TimelineRow item={item} />
                  </View>
                ))}
              </Card>
            )}
          </>
        ) : null}
      </Screen>
    </View>
  );
}

function QuickTile({ label, icon, onPress }: { label: string; icon: React.ReactNode; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flex: 1, minWidth: 96, minHeight: 88, borderRadius: radius.lg, backgroundColor: pressed ? t.sunken : t.elevated,
        borderWidth: 1, borderColor: t.border, alignItems: "center", justifyContent: "center", gap: 6, padding: space.sm,
      })}
    >
      {icon}
      <AppText variant="small" weight="medium" center>{label}</AppText>
    </Pressable>
  );
}
