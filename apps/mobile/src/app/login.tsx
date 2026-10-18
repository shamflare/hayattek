import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HeartPulse, Lock, ShieldCheck } from "lucide-react-native";

import { AppText, Button, Notice, Row, TextField } from "@/components/ui";
import { ar } from "@/i18n/ar";
import { errorMessage, isApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { tokenIsPersistent } from "@/lib/token-store";
import { radius, space, useTheme } from "@/theme";

export default function LoginScreen() {
  const t = useTheme();
  const { login } = useSession();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needOtp, setNeedOtp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!identifier.trim() || !password) {
      setError(ar.auth.missingFields);
      return;
    }
    if (needOtp && !/^\d{6}$/.test(otp)) {
      setError(ar.auth.otpInvalid);
      return;
    }
    setBusy(true);
    try {
      await login(identifier.trim(), password, needOtp ? otp : undefined);
    } catch (e) {
      if (isApiError(e) && e.code === "mfa_required") {
        setNeedOtp(true);
        setOtp("");
        if (needOtp) setError(errorMessage(e));
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={{ backgroundColor: t.cardHero, paddingBottom: 56, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}>
            <SafeAreaView edges={["top"]}>
              <View style={{ alignItems: "center", paddingTop: space.xxl, gap: space.sm }}>
                <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" }}>
                  <HeartPulse size={38} color="#fff" />
                </View>
                <AppText variant="display" tone="onPrimary">{ar.brand.name}</AppText>
                <AppText variant="small" tone="onPrimary" style={{ opacity: 0.85 }}>{ar.brand.tagline}</AppText>
              </View>
            </SafeAreaView>
          </View>

          <View style={{ marginTop: -36, marginHorizontal: space.lg, backgroundColor: t.elevated, borderRadius: radius.xl, padding: space.xl, borderWidth: 1, borderColor: t.border, maxWidth: 520, width: "auto", alignSelf: "stretch" }}>
            {!needOtp ? (
              <>
                <AppText variant="title">{ar.auth.welcome}</AppText>
                <AppText variant="small" tone="muted" style={{ marginBottom: space.xl }}>{ar.auth.subtitle}</AppText>
                {error ? <Notice tone="danger" text={error} /> : null}
                <TextField
                  testID="login-identifier"
                  label={ar.auth.identifier}
                  placeholder={ar.auth.identifierPlaceholder}
                  value={identifier}
                  onChangeText={setIdentifier}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="username"
                  autoComplete="username"
                  returnKeyType="next"
                />
                <TextField
                  testID="login-password"
                  label={ar.auth.password}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="password"
                  autoComplete="current-password"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                />
                <Button testID="login-submit" title={busy ? ar.auth.loggingIn : ar.auth.login} onPress={submit} loading={busy} />
              </>
            ) : (
              <>
                <Row gap={space.sm} style={{ marginBottom: space.sm }}>
                  <ShieldCheck size={24} color={t.primary} />
                  <AppText variant="title">{ar.auth.otpTitle}</AppText>
                </Row>
                <AppText variant="small" tone="muted" style={{ marginBottom: space.xl }}>{ar.auth.otpHint}</AppText>
                {error ? <Notice tone="danger" text={error} /> : null}
                <TextField
                  testID="login-otp"
                  label={ar.auth.otpTitle}
                  placeholder={ar.auth.otpPlaceholder}
                  value={otp}
                  onChangeText={(v) => setOtp(v.replace(/\D/g, "").slice(0, 6))}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  onSubmitEditing={submit}
                  style={{ fontSize: 24, letterSpacing: 8, textAlign: "center", writingDirection: "ltr" }}
                />
                <Button title={ar.auth.verify} onPress={submit} loading={busy} />
                <Button title={ar.auth.backToLogin} variant="ghost" onPress={() => { setNeedOtp(false); setError(null); }} style={{ marginTop: space.sm }} />
              </>
            )}
            <Row gap={6} style={{ marginTop: space.xl, justifyContent: "center" }}>
              <Lock size={14} color={t.subtle} />
              <AppText variant="caption" tone="subtle">{tokenIsPersistent ? ar.auth.secureNote : ar.auth.webNote}</AppText>
            </Row>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
