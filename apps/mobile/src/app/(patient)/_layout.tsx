import { Tabs } from "expo-router";
import { Clock, CreditCard, House, Menu, ShieldCheck } from "lucide-react-native";

import { ar } from "@/i18n/ar";
import { useAccessRequests } from "@/lib/queries";
import { fonts, useTheme } from "@/theme";

export default function PatientTabs() {
  const t = useTheme();
  const requests = useAccessRequests();
  const pending = requests.data?.filter((r) => r.status === "pending").length ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.elevated },
        headerTitleStyle: { fontFamily: fonts.semibold, color: t.fg, fontSize: 17 },
        headerShadowVisible: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.subtle,
        tabBarStyle: { backgroundColor: t.elevated, borderTopColor: t.border },
        tabBarItemStyle: { paddingVertical: 4 },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: ar.tabs.home, headerShown: false, tabBarIcon: ({ color }) => <House color={color} size={24} /> }}
      />
      <Tabs.Screen
        name="card"
        options={{ title: ar.tabs.card, headerTitle: ar.card.title, tabBarIcon: ({ color }) => <CreditCard color={color} size={24} /> }}
      />
      <Tabs.Screen
        name="timeline"
        options={{ title: ar.tabs.timeline, headerTitle: ar.timeline.title, tabBarIcon: ({ color }) => <Clock color={color} size={24} /> }}
      />
      <Tabs.Screen
        name="consent"
        options={{
          title: ar.tabs.consent,
          headerTitle: ar.consent.title,
          tabBarIcon: ({ color }) => <ShieldCheck color={color} size={24} />,
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarBadgeStyle: { backgroundColor: t.accent, fontFamily: fonts.semibold },
        }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: ar.tabs.more, headerTitle: ar.more.title, tabBarIcon: ({ color }) => <Menu color={color} size={24} /> }}
      />
    </Tabs>
  );
}
