import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pill, Plus, Save, Star, Trash2 } from "lucide-react-native";

import { openRecord } from "@/components/records";
import { Screen } from "@/components/screen";
import {
  AppText, Badge, Button, Card, Chips, ConfirmDialog, EmptyState, ErrorState, IconBubble, Notice, Row, SectionTitle, SkeletonList, TextField,
} from "@/components/ui";
import { ar, label } from "@/i18n/ar";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api";
import { useClinician } from "@/lib/clinician";
import { useSession } from "@/lib/session";
import { radius, space, useTheme } from "@/theme";

type Item = Schemas["PrescriptionItemRequest"];
type Time = Schemas["TimesOfDayEnum"];
type Meal = Schemas["MealRelationEnum"];
type DurationUnit = Schemas["DurationUnitEnum"];

const TIMES: Time[] = ["morning", "noon", "evening", "bedtime"];
const MEALS: Meal[] = ["before", "after", "with", "independent"];
const UNITS: DurationUnit[] = ["days", "weeks", "months", "ongoing"];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Build an item from the doctor's favorite + the chosen schedule. Preset values are the doctor's own defaults. */
function buildItem(fav: Schemas["Favorite"], times: Time[], meal: Meal, durationValue: string, unit: DurationUnit, dose: string): Item {
  const m = fav.medication;
  const preset = (fav.preset && typeof fav.preset === "object" ? fav.preset : {}) as Record<string, unknown>;
  return {
    medication: m.id,
    medication_name: m.name,
    strength: m.strength ?? "",
    dosage_form: m.dosage_form,
    route: m.default_route ?? "",
    dose_amount: dose.trim() ? dose.trim() : null,
    dose_unit: (typeof preset.dose_unit === "string" ? preset.dose_unit : m.unit) ?? "",
    schedule_type: "times_of_day",
    times_of_day: times,
    meal_relation: meal,
    duration_value: unit === "ongoing" ? null : Number(durationValue) || null,
    duration_unit: unit,
    instructions: typeof preset.instructions === "string" ? preset.instructions : "",
  };
}

export default function QuickPrescription() {
  const t = useTheme();
  const qc = useQueryClient();
  const { membership } = useSession();
  const { current } = useClinician();
  const favorites = useQuery({
    queryKey: [`c:${membership?.id}`, "favorites"],
    queryFn: () => unwrap(api.GET("/api/v1/medications/favorites")),
  });

  const [selected, setSelected] = useState<Schemas["Favorite"] | null>(null);
  const [times, setTimes] = useState<Time[]>(["morning", "evening"]);
  const [meal, setMeal] = useState<Meal>("after");
  const [durationValue, setDurationValue] = useState("7");
  const [unit, setUnit] = useState<DurationUnit>("days");
  const [dose, setDose] = useState("1");
  const [sig, setSig] = useState<string | null>(null);
  const [items, setItems] = useState<(Item & { sig?: string })[]>([]);
  const [diagnosis, setDiagnosis] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"draft" | "final" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [rxId, setRxId] = useState<string | null>(null);
  const [finalized, setFinalized] = useState(false);

  // When a favorite is chosen, apply the doctor's preset defaults where valid.
  useEffect(() => {
    if (!selected) return;
    const p = (selected.preset && typeof selected.preset === "object" ? selected.preset : {}) as Record<string, unknown>;
    if (Array.isArray(p.times_of_day)) {
      const valid = p.times_of_day.filter((x): x is Time => TIMES.includes(x as Time));
      if (valid.length) setTimes(valid);
    }
    setMeal(pick(p.meal_relation, MEALS, "after"));
    setUnit(pick(p.duration_unit, UNITS, "days"));
    if (typeof p.duration_value === "number") setDurationValue(String(p.duration_value));
    if (p.dose_amount != null) setDose(String(p.dose_amount));
  }, [selected]);

  // Live Arabic sig preview from the server (the same text the patient will see).
  useEffect(() => {
    if (!selected || times.length === 0) {
      setSig(null);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await unwrap(api.POST("/api/v1/medications/sig-preview", { body: buildItem(selected, times, meal, durationValue, unit, dose) }));
        setSig(res.sig);
      } catch {
        setSig(null);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [selected, times, meal, durationValue, unit, dose]);

  if (!current) return <Screen><Card><EmptyState title={ar.clinician.scanTitle} /></Card></Screen>;
  const patient = current.result.patient;

  function addItem() {
    setError(null);
    if (!selected) return setError(ar.clinician.selectMedication);
    if (times.length === 0) return setError(ar.clinician.timesRequired);
    setItems((cur) => [...cur, { ...buildItem(selected, times, meal, durationValue, unit, dose), position: cur.length, sig: sig ?? undefined }]);
    setSelected(null);
    setSig(null);
  }

  async function save(): Promise<string | null> {
    setError(null);
    if (items.length === 0) {
      setError(ar.clinician.itemsEmpty);
      return null;
    }
    const body = { diagnosis_text: diagnosis.trim(), items: items.map(({ sig: _sig, ...rest }) => rest) };
    if (rxId) {
      await unwrap(api.PATCH("/api/v1/prescriptions/{id}", { params: { path: { id: rxId } }, body }));
      return rxId;
    }
    const created = (await unwrap(api.POST("/api/v1/prescriptions", { body: { patient: patient.id, ...body } }))) as { id?: string };
    if (!created.id) throw new Error("missing id");
    setRxId(created.id);
    return created.id;
  }

  async function onDraft() {
    setBusy("draft");
    try {
      if (await save()) setNotice(ar.clinician.draftSaved);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function doFinalize() {
    setBusy("final");
    try {
      const id = await save();
      if (!id) return;
      await unwrap(api.POST("/api/v1/prescriptions/{id}/finalize", { params: { path: { id } } }));
      setFinalized(true);
      setNotice(`${ar.clinician.rxCreated} ${ar.clinician.finalized}`);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("summary") });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  }

  return (
    <Screen testID="clinician-prescribe">
      <AppText variant="small" tone="muted" style={{ marginBottom: space.md }}>{patient.full_name}</AppText>
      {notice ? <Notice text={notice} /> : null}
      {error ? <Notice tone="danger" text={error} /> : null}

      {!finalized ? (
        <>
          <SectionTitle title={ar.clinician.favorites} />
          {favorites.isPending ? <SkeletonList rows={2} /> :
            favorites.isError ? <Card><ErrorState message={errorMessage(favorites.error)} onRetry={() => favorites.refetch()} /></Card> :
            favorites.data.length === 0 ? <Card><EmptyState icon={<Star size={28} color={t.primary} />} title={ar.clinician.favoritesEmpty} /></Card> :
            <View style={{ gap: space.sm }}>
              {favorites.data.map((f) => {
                const on = selected?.id === f.id;
                return (
                  <Pressable
                    key={f.id}
                    testID="favorite-option"
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => setSelected(on ? null : f)}
                    style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: 60, borderRadius: radius.lg, borderWidth: on ? 2 : 1, borderColor: on ? t.primary : t.border, backgroundColor: on ? t.brandSoft : t.elevated }}
                  >
                    <IconBubble tone="accent"><Pill size={20} color={t.accent} /></IconBubble>
                    <View style={{ flex: 1 }}>
                      <AppText variant="body" weight="semibold">{f.medication.name}{f.medication.strength ? ` ${f.medication.strength}` : ""}</AppText>
                      <AppText variant="caption" tone="muted">{label(ar.dosageForms, f.medication.dosage_form)}{f.medication.active_ingredient ? ` · ${f.medication.active_ingredient}` : ""}</AppText>
                    </View>
                  </Pressable>
                );
              })}
            </View>}

          {selected ? (
            <Card style={{ marginTop: space.lg }} testID="rx-item-editor">
              <AppText variant="heading" style={{ marginBottom: space.md }}>{selected.medication.name}</AppText>
              <TextField label={`${ar.clinician.dose} (${selected.medication.unit || label(ar.dosageForms, selected.medication.dosage_form)})`} value={dose} onChangeText={setDose} keyboardType="decimal-pad" />
              <AppText variant="small" weight="medium" style={{ marginBottom: 6 }}>{ar.clinician.timesOfDay}</AppText>
              <Chips options={TIMES.map((v) => ({ value: v, label: ar.timesOfDay[v] }))} selected={times} onToggle={(v) => setTimes((c) => (c.includes(v) ? c.filter((x) => x !== v) : TIMES.filter((x) => c.includes(x) || x === v)))} />
              <AppText variant="small" weight="medium" style={{ marginTop: space.lg, marginBottom: 6 }}>{ar.clinician.meal}</AppText>
              <Chips options={MEALS.map((v) => ({ value: v, label: ar.meals[v] }))} selected={[meal]} onToggle={setMeal} />
              <AppText variant="small" weight="medium" style={{ marginTop: space.lg, marginBottom: 6 }}>{ar.clinician.duration}</AppText>
              <Chips options={UNITS.map((v) => ({ value: v, label: ar.durationUnits[v] }))} selected={[unit]} onToggle={setUnit} />
              {unit !== "ongoing" ? (
                <View style={{ marginTop: space.md }}>
                  <TextField label={ar.clinician.durationValue} value={durationValue} onChangeText={(v) => setDurationValue(v.replace(/\D/g, "").slice(0, 3))} keyboardType="number-pad" />
                </View>
              ) : <View style={{ height: space.lg }} />}
              {sig ? (
                <View style={{ backgroundColor: t.brandSoft, borderRadius: radius.md, padding: space.md, marginBottom: space.md }}>
                  <AppText variant="caption" tone="primary" weight="medium">{ar.clinician.sigPreview}</AppText>
                  <AppText variant="body" weight="medium" testID="sig-preview">{sig}</AppText>
                </View>
              ) : null}
              <Button title={ar.clinician.addItem} icon={<Plus size={18} color="#fff" />} onPress={addItem} testID="rx-add-item" />
            </Card>
          ) : null}
        </>
      ) : null}

      <SectionTitle title={ar.clinician.items} />
      <Card>
        {items.length === 0 ? <AppText variant="small" tone="muted">{ar.clinician.itemsEmpty}</AppText> :
          items.map((it, i) => (
            <Row key={i} gap={space.sm} align="flex-start" style={{ marginBottom: space.md }}>
              <Badge text={String(i + 1)} tone="accent" />
              <View style={{ flex: 1 }}>
                <AppText variant="body" weight="semibold">{it.medication_name}{it.strength ? ` ${it.strength}` : ""}</AppText>
                <AppText variant="small" tone="muted">{it.sig ?? (it.times_of_day ?? []).map((x) => ar.timesOfDay[x]).join("، ")}</AppText>
              </View>
              {!finalized ? (
                <Pressable accessibilityRole="button" accessibilityLabel={ar.clinician.removeItem} onPress={() => setItems((c) => c.filter((_, j) => j !== i))} style={{ padding: 10 }}>
                  <Trash2 size={20} color={t.danger} />
                </Pressable>
              ) : null}
            </Row>
          ))}
        {!finalized ? <TextField label={ar.clinician.diagnosis} value={diagnosis} onChangeText={setDiagnosis} /> : null}
      </Card>

      {finalized && rxId ? (
        <Button title={ar.common.viewDetails} variant="secondary" onPress={() => openRecord("prescription", rxId)} style={{ marginTop: space.lg }} />
      ) : (
        <Row gap={space.sm} style={{ marginTop: space.lg }}>
          <Button title={ar.clinician.finalize} icon={<CheckCircle2 size={18} color="#fff" />} onPress={() => (items.length ? setConfirm(true) : setError(ar.clinician.itemsEmpty))} loading={busy === "final"} disabled={busy !== null} style={{ flex: 1 }} testID="rx-finalize" />
          <Button title={ar.clinician.saveDraft} variant="outline" icon={<Save size={18} color={t.fg} />} onPress={onDraft} loading={busy === "draft"} disabled={busy !== null} style={{ flex: 1 }} />
        </Row>
      )}

      <ConfirmDialog
        visible={confirm}
        title={ar.clinician.finalizeTitle}
        body={ar.clinician.finalizeBody}
        confirmLabel={ar.clinician.finalize}
        loading={busy === "final"}
        onConfirm={doFinalize}
        onCancel={() => setConfirm(false)}
      />
    </Screen>
  );
}
