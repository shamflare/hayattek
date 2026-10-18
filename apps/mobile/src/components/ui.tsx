/**
 * Small, app-specific UI kit. RTL-first: we never hard-code left/right alignment;
 * row layouts follow the writing direction, so Arabic reads right-to-left.
 */
import { useEffect, useRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { AlertCircle, Check, ChevronLeft, Inbox, RefreshCw } from "lucide-react-native";

import { ar } from "@/i18n/ar";
import { fonts, radius, space, touch, useTheme, type Theme } from "@/theme";

/* ------------------------------------------------------------------ Text */

type Variant = "display" | "title" | "heading" | "body" | "small" | "caption";
type Weight = "regular" | "medium" | "semibold" | "bold";
type Tone = "default" | "muted" | "subtle" | "primary" | "danger" | "success" | "warning" | "onPrimary" | "accent";

const variantSize: Record<Variant, { fontSize: number; lineHeight: number }> = {
  display: { fontSize: 28, lineHeight: 42 },
  title: { fontSize: 22, lineHeight: 34 },
  heading: { fontSize: 17, lineHeight: 28 },
  body: { fontSize: 16, lineHeight: 26 },
  small: { fontSize: 14, lineHeight: 22 },
  caption: { fontSize: 12.5, lineHeight: 19 },
};

function toneColor(t: Theme, tone: Tone): string {
  switch (tone) {
    case "muted": return t.muted;
    case "subtle": return t.subtle;
    case "primary": return t.primary;
    case "danger": return t.danger;
    case "success": return t.success;
    case "warning": return t.warning;
    case "accent": return t.accent;
    case "onPrimary": return t.onPrimary;
    default: return t.fg;
  }
}

export interface AppTextProps extends TextProps {
  variant?: Variant;
  weight?: Weight;
  tone?: Tone;
  /** Render numbers / codes left-to-right inside Arabic text. */
  ltr?: boolean;
  center?: boolean;
  style?: StyleProp<TextStyle>;
}

export function AppText({ variant = "body", weight, tone = "default", ltr, center, style, ...rest }: AppTextProps) {
  const t = useTheme();
  const w: Weight = weight ?? (variant === "display" || variant === "title" ? "bold" : variant === "heading" ? "semibold" : "regular");
  return (
    <Text
      {...rest}
      style={[
        variantSize[variant],
        { fontFamily: fonts[w], color: toneColor(t, tone) },
        ltr && { writingDirection: "ltr" },
        center && { textAlign: "center" },
        style,
      ]}
    />
  );
}

/* ------------------------------------------------------------------ Layout */

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.elevated,
          borderColor: t.border,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderRadius: radius.lg,
          padding: padded ? space.lg : 0,
          shadowColor: "#0f1f1d",
          shadowOpacity: t.scheme === "dark" ? 0 : 0.05,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: t.scheme === "dark" ? 0 : 1,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Row({ children, style, gap = space.sm, align = "center" }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number; align?: ViewStyle["alignItems"] }) {
  return <View style={[{ flexDirection: "row", alignItems: align, gap }, style]}>{children}</View>;
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <Row style={{ justifyContent: "space-between", marginTop: space.lg, marginBottom: space.sm }}>
      <AppText variant="heading">{title}</AppText>
      {action}
    </Row>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: t.border, marginVertical: space.md }} />;
}

/** Label/value pair used on record detail screens. */
export function Field({ label, value, ltr, multiline }: { label: string; value?: string | null; ltr?: boolean; multiline?: boolean }) {
  if (!value) return null;
  return (
    <View style={{ marginBottom: space.md }}>
      <AppText variant="caption" tone="muted" weight="medium">{label}</AppText>
      <AppText variant="body" ltr={ltr} style={multiline ? { marginTop: 2 } : undefined}>{value}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ Buttons */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";

export function Button({
  title, onPress, variant = "primary", loading, disabled, icon, style, compact, testID,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: Tone; border?: string; pressed: string }> = {
    primary: { bg: t.primary, fg: "onPrimary", pressed: t.primaryPressed },
    secondary: { bg: t.brandSoftStrong, fg: "primary", pressed: t.brandSoft },
    ghost: { bg: "transparent", fg: "primary", pressed: t.brandSoft },
    danger: { bg: t.danger, fg: "onPrimary", pressed: "#b83a3a" },
    outline: { bg: "transparent", fg: "default", border: t.borderStrong, pressed: t.sunken },
  };
  const p = palette[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        {
          minHeight: compact ? 40 : touch,
          paddingHorizontal: compact ? space.md : space.lg,
          borderRadius: radius.md,
          backgroundColor: pressed ? p.pressed : p.bg,
          borderWidth: p.border ? 1 : 0,
          borderColor: p.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
          opacity: isDisabled ? 0.55 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={toneColor(t, p.fg)} /> : icon}
      <AppText variant={compact ? "small" : "body"} weight="semibold" tone={p.fg}>{title}</AppText>
    </Pressable>
  );
}

/** Tappable list row with a direction-aware chevron. */
export function ListRow({
  title, subtitle, meta, leading, trailing, onPress, testID,
}: {
  title: string;
  subtitle?: string | null;
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => ({
        minHeight: 64,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        backgroundColor: pressed ? t.sunken : "transparent",
      })}
    >
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body" weight="medium" numberOfLines={2}>{title}</AppText>
        {subtitle ? <AppText variant="small" tone="muted" numberOfLines={2}>{subtitle}</AppText> : null}
        {meta}
      </View>
      {trailing}
      {onPress ? <ChevronLeft size={20} color={t.subtle} /> : null}
    </Pressable>
  );
}

export function IconBubble({ children, tone = "brand" }: { children: ReactNode; tone?: "brand" | "accent" | "info" | "warning" | "danger" | "success" }) {
  const t = useTheme();
  const bg = { brand: t.brandSoftStrong, accent: t.accentSoft, info: t.infoSoft, warning: t.warningSoft, danger: t.dangerSoft, success: t.successSoft }[tone];
  return (
    <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ Badges */

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "accent";

export function Badge({ text, tone = "neutral" }: { text: string; tone?: BadgeTone }) {
  const t = useTheme();
  const map: Record<BadgeTone, [string, string]> = {
    neutral: [t.sunken, t.muted],
    brand: [t.brandSoftStrong, t.primary],
    success: [t.successSoft, t.success],
    warning: [t.warningSoft, t.warning],
    danger: [t.dangerSoft, t.danger],
    info: [t.infoSoft, t.info],
    accent: [t.accentSoft, t.accent],
  };
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2, alignSelf: "flex-start" }}>
      <Text style={{ color: fg, fontFamily: fonts.medium, fontSize: 12, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

export function statusTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case "final": return "success";
    case "draft": return "warning";
    case "amended": return "info";
    case "entered_in_error": return "danger";
    default: return "neutral";
  }
}

/* ------------------------------------------------------------------ Inputs */

export function TextField({ label, hint, error, style, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: space.lg }}>
      <AppText variant="small" weight="medium" style={{ marginBottom: 6 }}>{label}</AppText>
      <TextInput
        placeholderTextColor={t.subtle}
        {...props}
        style={[
          {
            minHeight: touch,
            borderWidth: 1,
            borderColor: error ? t.danger : t.borderStrong,
            borderRadius: radius.md,
            backgroundColor: t.elevated,
            color: t.fg,
            paddingHorizontal: space.md,
            paddingVertical: props.multiline ? space.md : 0,
            fontFamily: fonts.regular,
            fontSize: 16,
            // No textAlign: inputs follow the RTL writing direction (start = right).
            textAlignVertical: props.multiline ? "top" : "center",
          },
          style,
        ]}
      />
      {error ? <AppText variant="caption" tone="danger" style={{ marginTop: 4 }}>{error}</AppText> : hint ? <AppText variant="caption" tone="muted" style={{ marginTop: 4 }}>{hint}</AppText> : null}
    </View>
  );
}

export function CheckRow({ checked, onToggle, title, subtitle, testID }: { checked: boolean; onToggle: () => void; title: string; subtitle?: string; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: touch, paddingVertical: 6, opacity: pressed ? 0.7 : 1 })}
    >
      <View
        style={{
          width: 26, height: 26, borderRadius: 7, borderWidth: 2,
          borderColor: checked ? t.primary : t.borderStrong,
          backgroundColor: checked ? t.primary : "transparent",
          alignItems: "center", justifyContent: "center",
        }}
      >
        {checked ? <Check size={16} color="#fff" strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="body" weight="medium">{title}</AppText>
        {subtitle ? <AppText variant="caption" tone="muted">{subtitle}</AppText> : null}
      </View>
    </Pressable>
  );
}

/** Horizontal single/multi choice chips. */
export function Chips<T extends string>({ options, selected, onToggle }: { options: { value: T; label: string }[]; selected: T[]; onToggle: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <Pressable
            key={o.value}
            onPress={() => onToggle(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{
              minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, justifyContent: "center",
              borderWidth: 1.5, borderColor: on ? t.primary : t.borderStrong, backgroundColor: on ? t.brandSoftStrong : t.elevated,
            }}
          >
            <AppText variant="small" weight={on ? "semibold" : "regular"} tone={on ? "primary" : "default"}>{o.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ States */

export function Skeleton({ height = 16, width = "100%", style }: { height?: number; width?: ViewStyle["width"]; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ height, width, borderRadius: 8, backgroundColor: t.skeleton, opacity }, style]} />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <View accessibilityLabel={ar.common.loading} style={{ gap: space.md }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Card key={i}>
          <Row gap={space.md}>
            <Skeleton width={44} height={44} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton width="70%" height={16} />
              <Skeleton width="45%" height={12} />
            </View>
          </Row>
        </Card>
      ))}
    </View>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: space.xxl, paddingHorizontal: space.lg, gap: space.sm }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
        {icon ?? <Inbox size={28} color={t.primary} />}
      </View>
      <AppText variant="heading" center>{title}</AppText>
      {hint ? <AppText variant="small" tone="muted" center>{hint}</AppText> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: space.xxl, paddingHorizontal: space.lg, gap: space.sm }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.dangerSoft, alignItems: "center", justifyContent: "center" }}>
        <AlertCircle size={28} color={t.danger} />
      </View>
      <AppText variant="heading" center>{ar.errors.title}</AppText>
      <AppText variant="small" tone="muted" center>{message}</AppText>
      {onRetry ? (
        <Button title={ar.common.retry} variant="secondary" onPress={onRetry} icon={<RefreshCw size={18} color={t.primary} />} style={{ marginTop: space.sm }} />
      ) : null}
    </View>
  );
}

/** Inline banner for success / error feedback after an action. */
export function Notice({ text, tone = "success" }: { text: string; tone?: "success" | "danger" | "info" | "warning" }) {
  const t = useTheme();
  const map = { success: [t.successSoft, t.success], danger: [t.dangerSoft, t.danger], info: [t.infoSoft, t.info], warning: [t.warningSoft, t.warning] } as const;
  const [bg, fg] = map[tone];
  return (
    <View accessibilityLiveRegion="polite" style={{ backgroundColor: bg, borderRadius: radius.md, padding: space.md, marginBottom: space.md, borderStartWidth: 4, borderStartColor: fg }}>
      <AppText variant="small" style={{ color: fg }} weight="medium">{text}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ Dialog */

/** Cross-platform confirmation dialog (Alert.alert is a no-op on web). */
export function ConfirmDialog({
  visible, title, body, confirmLabel = ar.common.confirm, cancelLabel = ar.common.cancel, destructive, loading, onConfirm, onCancel, children,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "rgba(5,15,14,0.55)", justifyContent: "center", padding: space.xl }}>
        <View style={{ backgroundColor: t.elevated, borderRadius: radius.xl, padding: space.xl, gap: space.md, maxWidth: 480, width: "100%", alignSelf: "center" }}>
          <AppText variant="title">{title}</AppText>
          {body ? <AppText variant="body" tone="muted">{body}</AppText> : null}
          {children}
          <Row gap={space.sm} style={{ marginTop: space.sm }}>
            <Button title={confirmLabel} variant={destructive ? "danger" : "primary"} onPress={onConfirm} loading={loading} style={{ flex: 1 }} testID="confirm-dialog-ok" />
            <Button title={cancelLabel} variant="outline" onPress={onCancel} disabled={loading} style={{ flex: 1 }} />
          </Row>
        </View>
      </View>
    </Modal>
  );
}
