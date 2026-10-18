import { type ReactNode } from "react";
import { RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";

import { space, useTheme } from "@/theme";

/** Scrollable screen body with pull-to-refresh and a centred max width on tablets/web. */
export function Screen({
  children, refreshing, onRefresh, contentStyle, testID,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <ScrollView
      testID={testID}
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingBottom: space.xxl * 2 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.primary} colors={[t.primary]} /> : undefined
      }
    >
      <View style={[{ padding: space.lg, width: "100%", maxWidth: 720, alignSelf: "center" }, contentStyle]}>{children}</View>
    </ScrollView>
  );
}
