import { useEffect, useState } from "react";
import { I18nManager, Platform, View } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
  useFonts,
} from "@expo-google-fonts/ibm-plex-sans-arabic";

import { ar } from "@/i18n/ar";
import { isApiError } from "@/lib/api";
import { ClinicianProvider } from "@/lib/clinician";
import { wireOnlineManager } from "@/lib/network";
import { SessionProvider, useSession } from "@/lib/session";
import { fonts, useTheme } from "@/theme";

// Arabic-first: the whole layout is right-to-left (also set natively via the
// expo-localization `forcesRTL` plugin option so the first launch is already RTL).
if (Platform.OS !== "web") {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
} else if (typeof document !== "undefined") {
  document.documentElement.dir = "rtl";
  document.documentElement.lang = "ar";
}

SplashScreen.preventAutoHideAsync().catch(() => {});
// Queries pause while offline (cached data stays visible) and resume on reconnect.
wireOnlineManager();

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: (count, error) => {
          if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
          return count < 2;
        },
      },
    },
  });
}

export default function RootLayout() {
  const [queryClient] = useState(makeQueryClient);
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <ClinicianProvider>
            <RootNavigator ready={fontsLoaded || !!fontError} />
          </ClinicianProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator({ ready }: { ready: boolean }) {
  const t = useTheme();
  const { status, mode } = useSession();
  const booted = ready && status !== "loading";

  useEffect(() => {
    if (booted) SplashScreen.hideAsync().catch(() => {});
  }, [booted]);

  if (!booted) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  const signedIn = status === "signedIn";
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.elevated },
          headerTintColor: t.primary,
          headerTitleStyle: { fontFamily: fonts.semibold, color: t.fg, fontSize: 17 },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(patient)" options={{ headerShown: false, title: ar.tabs.home }} />
          <Stack.Screen name="record/[type]/[id]" options={{ title: ar.common.viewDetails }} />
          <Stack.Screen name="prescriptions" options={{ title: ar.lists.prescriptions }} />
          <Stack.Screen name="labs" options={{ title: ar.lists.labs }} />
          <Stack.Screen name="documents" options={{ title: ar.lists.documents }} />
          <Stack.Screen name="notifications" options={{ title: ar.notifications.title }} />
          <Stack.Screen name="wallet" options={{ title: ar.wallet.title }} />
          <Stack.Protected guard={mode === "clinician"}>
            <Stack.Screen name="clinician/index" options={{ title: ar.clinician.title }} />
            <Stack.Screen name="clinician/patient" options={{ title: ar.clinician.patient }} />
            <Stack.Screen name="clinician/visit" options={{ title: ar.clinician.visitTitle }} />
            <Stack.Screen name="clinician/prescribe" options={{ title: ar.clinician.rxTitle }} />
            <Stack.Screen name="clinician/scribe" options={{ title: ar.scribe.title }} />
            <Stack.Screen name="clinician/scribe-review" options={{ title: ar.scribe.reviewTitle }} />
          </Stack.Protected>
        </Stack.Protected>
      </Stack>
    </View>
  );
}
