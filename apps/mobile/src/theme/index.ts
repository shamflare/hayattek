/**
 * HAYAT design tokens for React Native. Same brand palette as the web app
 * (apps/web/src/app/globals.css) so both clients feel like one product.
 */
import { useColorScheme } from "react-native";

const brand = {
  50: "#edfaf7",
  100: "#d3f3ec",
  200: "#a9e6da",
  300: "#72d2c2",
  400: "#3cb7a6",
  500: "#1f9e8f",
  600: "#157f74",
  700: "#14665e",
  800: "#13514c",
  900: "#123f3c",
};

const light = {
  scheme: "light" as const,
  bg: "#f6f8f7",
  elevated: "#ffffff",
  sunken: "#eef2f1",
  fg: "#0f1f1d",
  muted: "#51625f",
  subtle: "#7c8b88",
  border: "#dde5e3",
  borderStrong: "#c6d2cf",
  ring: "#1f9e8f",
  brand,
  brandSoft: brand[50],
  brandSoftStrong: brand[100],
  primary: brand[600],
  primaryPressed: brand[700],
  onPrimary: "#ffffff",
  accent: "#e07a5f",
  accentSoft: "#fdf1ed",
  danger: "#d64545",
  dangerSoft: "#fdeeee",
  warning: "#b37d12",
  warningSoft: "#fdf6e7",
  success: "#2f9e5b",
  successSoft: "#ebf7f0",
  info: "#3a7bd5",
  infoSoft: "#edf3fc",
  skeleton: "#e3eae8",
  shadow: "rgba(15,31,29,0.08)",
  cardHero: brand[600],
  cardHeroDeep: brand[800],
};

export type Theme = Omit<typeof light, "scheme"> & { scheme: "light" | "dark" };

const dark: Theme = {
  ...light,
  scheme: "dark",
  bg: "#0b1514",
  elevated: "#111f1d",
  sunken: "#0e1a19",
  fg: "#e6efed",
  muted: "#9db0ac",
  subtle: "#6f8480",
  border: "#1f322f",
  borderStrong: "#2b4440",
  ring: "#3cb7a6",
  brandSoft: "#0f2a27",
  brandSoftStrong: "#12352f",
  primary: brand[500],
  primaryPressed: brand[600],
  accentSoft: "#2b1a15",
  dangerSoft: "#2d1515",
  warning: "#d99a1e",
  warningSoft: "#2b2312",
  successSoft: "#12261a",
  infoSoft: "#131f31",
  skeleton: "#1a2b29",
  shadow: "rgba(0,0,0,0.5)",
  cardHero: brand[700],
  cardHeroDeep: brand[900],
};

export const themes = { light, dark };

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === "dark" ? dark : light;
}

/** IBM Plex Sans Arabic weights, loaded in the root layout. */
export const fonts = {
  regular: "IBMPlexSansArabic_400Regular",
  medium: "IBMPlexSansArabic_500Medium",
  semibold: "IBMPlexSansArabic_600SemiBold",
  bold: "IBMPlexSansArabic_700Bold",
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };
/** Minimum comfortable touch target (WCAG / platform guidelines). */
export const touch = 48;
