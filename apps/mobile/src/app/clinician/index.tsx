import { useRef, useState } from "react";
import { Modal, Platform, View } from "react-native";
import { router, Stack } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import { Building2, Keyboard, LogOut, ScanLine, Wallet, X } from "lucide-react-native";

import { Screen } from "@/components/screen";
import { AppText, Button, Card, IconBubble, ListRow, Notice, Row, SectionTitle, TextField } from "@/components/ui";
import { ar } from "@/i18n/ar";
import { errorMessage } from "@/lib/api";
import { extractCardToken, parseHealthNumber } from "@/lib/card-token";
import { identify, useClinician, type IdentifiedState } from "@/lib/clinician";
import { useCanRun } from "@/lib/network";
import { useSession } from "@/lib/session";
import { radius, space, useTheme } from "@/theme";

export default function ClinicianHome() {
  const t = useTheme();
  const { membership, me, exitClinicianMode } = useSession();
  const { setCurrent } = useClinician();
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const canRun = useCanRun();

  async function resolve(identifier: IdentifiedState["identifier"]) {
    setError(null);
    setBusy(true);
    try {
      const result = await identify(identifier);
      setCurrent({ identifier, result });
      router.push("/clinician/patient");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function submitManual() {
    const hn = parseHealthNumber(manual);
    if (hn) return resolve({ health_number: hn });
    const token = extractCardToken(manual);
    if (token) return resolve({ card_token: token });
    setError(ar.clinician.invalidQr);
  }

  function exit() {
    exitClinicianMode();
    setCurrent(null);
    router.dismissTo("/more");
  }

  return (
    <Screen testID="clinician-home">
      <Stack.Screen options={{ title: ar.clinician.title }} />
      <Card>
        <Row gap={space.md}>
          <IconBubble><Building2 size={22} color={t.primary} /></IconBubble>
          <View style={{ flex: 1 }}>
            <AppText variant="caption" tone="muted">{ar.clinician.org}</AppText>
            <AppText variant="heading">{membership?.organization.name}</AppText>
            <AppText variant="small" tone="muted">{me?.practitioner?.display_name}</AppText>
          </View>
        </Row>
      </Card>

      {error ? <View style={{ marginTop: space.lg }}><Notice tone="danger" text={error} /></View> : null}

      <SectionTitle title={ar.clinician.scanTitle} />
      <Card style={{ alignItems: "center", gap: space.md }}>
        <View style={{ width: 96, height: 96, borderRadius: 24, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
          <ScanLine size={48} color={t.primary} />
        </View>
        <AppText variant="small" tone="muted" center>
          {Platform.OS === "web" ? ar.clinician.cameraUnavailable : ar.clinician.scanHint}
        </AppText>
        {Platform.OS !== "web" ? (
          <Button title={ar.clinician.scan} icon={<ScanLine size={20} color="#fff" />} onPress={() => setScanning(true)} disabled={!canRun()} style={{ alignSelf: "stretch" }} />
        ) : null}
      </Card>

      <SectionTitle title={ar.clinician.manualTitle} />
      <Card>
        <TextField
          testID="clinician-manual"
          label={ar.clinician.manualHint}
          placeholder={ar.clinician.manualPlaceholder}
          value={manual}
          onChangeText={setManual}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={submitManual}
        />
        <Button testID="clinician-identify" title={busy ? ar.clinician.identifying : ar.clinician.identify} icon={<Keyboard size={18} color="#fff" />} onPress={submitManual} loading={busy} disabled={!canRun(!manual.trim())} />
      </Card>

      <Card padded={false} style={{ marginTop: space.lg }}>
        <ListRow
          testID="clinician-wallet"
          title={ar.clinician.wallet}
          subtitle={ar.clinician.walletHint}
          leading={<IconBubble tone="success"><Wallet size={22} color={t.success} /></IconBubble>}
          onPress={() => router.push("/wallet")}
        />
      </Card>

      <Button title={ar.more.patientMode} variant="ghost" icon={<LogOut size={18} color={t.primary} />} onPress={exit} style={{ marginTop: space.xl }} />

      {Platform.OS !== "web" ? (
        <ScannerModal
          visible={scanning}
          onClose={() => setScanning(false)}
          onToken={(token) => {
            setScanning(false);
            void resolve({ card_token: token });
          }}
          onInvalid={() => {
            setScanning(false);
            setError(ar.clinician.invalidQr);
          }}
        />
      ) : null}
    </Screen>
  );
}

function ScannerModal({ visible, onClose, onToken, onInvalid }: { visible: boolean; onClose: () => void; onToken: (t: string) => void; onInvalid: () => void }) {
  const t = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => { handled.current = false; }}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {permission?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => {
              if (handled.current) return;
              handled.current = true;
              const token = extractCardToken(data);
              if (token) onToken(token);
              else onInvalid();
            }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.lg }}>
            <AppText variant="body" tone="onPrimary" center>{ar.clinician.cameraPermission}</AppText>
            <Button title={ar.clinician.grantCamera} onPress={() => requestPermission()} />
          </View>
        )}
        {permission?.granted ? (
          <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 250, height: 250, borderRadius: radius.xl, borderWidth: 3, borderColor: t.brand[300] }} />
            <AppText variant="body" tone="onPrimary" center style={{ marginTop: space.lg }}>{ar.clinician.scanHint}</AppText>
          </View>
        ) : null}
        <SafeAreaView edges={["top"]} style={{ position: "absolute", top: 0, end: 0 }}>
          <Button title={ar.common.close} variant="secondary" compact icon={<X size={18} color={t.primary} />} onPress={onClose} style={{ margin: space.lg }} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}
