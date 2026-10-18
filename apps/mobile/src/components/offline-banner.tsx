import { View } from "react-native";
import { WifiOff } from "lucide-react-native";

import { AppText } from "@/components/ui";
import { ar } from "@/i18n/ar";
import { useIsOffline } from "@/lib/network";
import { space, useTheme } from "@/theme";

/** Sticky banner shown under the header while the device has no connection. */
export function OfflineBanner() {
  const t = useTheme();
  const offline = useIsOffline();
  if (!offline) return null;
  return (
    <View
      testID="offline-banner"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: "row", alignItems: "center", gap: space.sm,
        backgroundColor: t.warningSoft, borderBottomWidth: 1, borderBottomColor: t.warning,
        paddingHorizontal: space.lg, paddingVertical: space.sm,
      }}
    >
      <WifiOff size={18} color={t.warning} />
      <AppText variant="caption" weight="medium" style={{ flex: 1, color: t.warning }}>{ar.offline.banner}</AppText>
    </View>
  );
}
