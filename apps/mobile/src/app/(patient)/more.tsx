import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { Bell, Check, FileText, FlaskConical, LogOut, Pill, ScanLine, Stethoscope, UserRound, Users } from "lucide-react-native";

import { RowSeparator } from "@/components/records";
import { Screen } from "@/components/screen";
import { AppText, Badge, Card, ConfirmDialog, IconBubble, ListRow, Notice, SectionTitle } from "@/components/ui";
import { ar, label } from "@/i18n/ar";
import { API_URL } from "@/lib/api";
import { formatHealthNumber } from "@/lib/format";
import { useUnreadCount } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/theme";

export default function MoreScreen() {
  const t = useTheme();
  const { me, patientId, selectPatient, clinicianMemberships, enterClinicianMode, logout } = useSession();
  const unread = useUnreadCount();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const profiles = [
    ...(me?.patient ? [{ ...me.patient, kind: ar.more.self }] : []),
    ...(me?.wards ?? []).map((w) => ({ ...w, kind: ar.more.ward })),
  ];
  const hasPhysicianRole = (me?.memberships ?? []).some((m) => (m.roles ?? []).includes("physician"));

  function startClinician(id: string) {
    enterClinicianMode(id);
    router.push("/clinician");
  }

  return (
    <Screen testID="more-screen">
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <IconBubble><UserRound size={22} color={t.primary} /></IconBubble>
          <View style={{ flex: 1 }}>
            <AppText variant="heading">{me?.full_name}</AppText>
            <AppText variant="small" tone="muted" ltr style={{ alignSelf: "flex-start" }}>{me?.email || me?.phone}</AppText>
          </View>
        </View>
      </Card>

      <SectionTitle title={ar.more.records} />
      <Card padded={false}>
        <ListRow title={ar.lists.prescriptions} leading={<IconBubble tone="accent"><Pill size={22} color={t.accent} /></IconBubble>} onPress={() => router.push("/prescriptions")} />
        <RowSeparator />
        <ListRow title={ar.lists.labs} leading={<IconBubble tone="info"><FlaskConical size={22} color={t.info} /></IconBubble>} onPress={() => router.push("/labs")} />
        <RowSeparator />
        <ListRow title={ar.lists.documents} leading={<IconBubble tone="success"><FileText size={22} color={t.success} /></IconBubble>} onPress={() => router.push("/documents")} />
        <RowSeparator />
        <ListRow
          title={ar.notifications.title}
          leading={<IconBubble tone="warning"><Bell size={22} color={t.warning} /></IconBubble>}
          trailing={unread.data && unread.data.unread > 0 ? <Badge text={String(unread.data.unread)} tone="accent" /> : null}
          onPress={() => router.push("/notifications")}
        />
      </Card>

      {profiles.length > 1 ? (
        <>
          <SectionTitle title={ar.more.profiles} />
          <AppText variant="small" tone="muted" style={{ marginBottom: space.sm }}>{ar.more.profilesHint}</AppText>
          <Card padded={false}>
            {profiles.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <RowSeparator /> : null}
                <ListRow
                  title={p.full_name}
                  subtitle={`${p.kind} · ${formatHealthNumber(p.health_number)}`}
                  leading={<IconBubble><Users size={22} color={t.primary} /></IconBubble>}
                  trailing={p.id === patientId ? <Check size={22} color={t.primary} /> : null}
                  onPress={() => selectPatient(p.id)}
                />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {hasPhysicianRole ? (
        <>
          <SectionTitle title={ar.more.clinicianMode} />
          {clinicianMemberships.length === 0 ? (
            <Notice tone="warning" text={ar.clinician.notVerified} />
          ) : (
            <Card padded={false}>
              {clinicianMemberships.map((m, i) => (
                <View key={m.id}>
                  {i > 0 ? <RowSeparator /> : null}
                  <ListRow
                    testID="enter-clinician-mode"
                    title={m.organization.name}
                    subtitle={`${(m.roles ?? []).map((r) => label(ar.roles, r)).join("، ")} · ${ar.more.clinicianModeHint}`}
                    leading={<IconBubble><Stethoscope size={22} color={t.primary} /></IconBubble>}
                    trailing={<ScanLine size={20} color={t.primary} />}
                    onPress={() => startClinician(m.id)}
                  />
                </View>
              ))}
            </Card>
          )}
        </>
      ) : null}

      <SectionTitle title={ar.more.account} />
      <Card padded={false}>
        <ListRow
          testID="logout"
          title={ar.auth.logout}
          leading={<IconBubble tone="danger"><LogOut size={22} color={t.danger} /></IconBubble>}
          onPress={() => setConfirmLogout(true)}
        />
      </Card>

      <View style={{ marginTop: space.xl, gap: 2 }}>
        <AppText variant="caption" tone="subtle" center>{ar.more.theme}</AppText>
        <AppText variant="caption" tone="subtle" center>
          {ar.more.version} {Constants.expoConfig?.version ?? "0.1.0"} · {ar.more.server}: <AppText variant="caption" tone="subtle" ltr>{API_URL}</AppText>
        </AppText>
      </View>

      <ConfirmDialog
        visible={confirmLogout}
        title={ar.auth.logout}
        body={ar.auth.logoutConfirm}
        destructive
        confirmLabel={ar.auth.logout}
        loading={loggingOut}
        onCancel={() => setConfirmLogout(false)}
        onConfirm={async () => {
          setLoggingOut(true);
          await logout();
        }}
      />
    </Screen>
  );
}
