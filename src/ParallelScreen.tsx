import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Result } from './gallery';
import { PhotoGrid, PhotoTile } from './PhotoGrid';
import {
  MAX_PARALLEL_PHOTOS, availableParallelPhotos, buildParallelPlans, parallelBudgets, parallelChoice,
  parallelPreferences, type ParallelCandidatePage, type ParallelChoice,
  type ParallelConstraints,
} from './parallelPlans';
import { Body, Button, Chip, color, EmptyState, ErrorText, Heading, Icon, styles } from './ui';

export type { ParallelChoice } from './parallelPlans';

export type ParallelScreenProps = {
  revision: number;
  open: (photo: Result) => void;
  loadCandidates: (start: number, end: number) => Promise<ParallelCandidatePage>;
  saveChoice: (choice: ParallelChoice) => Promise<void>;
  preferredActions?: readonly string[];
};

const scopes = [7, 30, 90] as const;
const initialConstraints: ParallelConstraints = { minutes: 15, preference: 'Any approach' };

export function ParallelScreen({ revision, open, loadCandidates, saveChoice, preferredActions }: ParallelScreenProps) {
  const [days, setDays] = useState<(typeof scopes)[number]>(30);
  const [scope, setScope] = useState<ParallelCandidatePage | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [constraints, setConstraints] = useState(initialConstraints);
  const [comparing, setComparing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const writing = useRef(false);

  useEffect(() => {
    let current = true;
    setScope(null);
    setLoadError(false);
    const end = new Date();
    const start = new Date(end);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - days + 1);
    void loadCandidates(start.getTime(), end.getTime()).then((page) => {
      if (!current) return;
      const items = availableParallelPhotos(page.items);
      setScope({ ...page, items });
      const accessible = new Set(items.map(({ photo }) => photo.id));
      setSelected((previous) => previous.filter((id) => accessible.has(id)));
    }).catch(() => { if (current) setLoadError(true); });
    return () => { current = false; };
  }, [days, revision, reload, loadCandidates]);

  const chosen = scope?.items.filter(({ photo }) => selected.includes(photo.id)) ?? [];
  const plans = buildParallelPlans(chosen, constraints, preferredActions);
  const activePlan = expanded === null ? plans[0]?.id : expanded;

  function choose(photo: Result) {
    setSelected((previous) => {
      if (previous.includes(photo.id)) return previous.filter((id) => id !== photo.id);
      return previous.length === MAX_PARALLEL_PHOTOS ? previous : [...previous, photo.id];
    });
  }

  async function save(plan: (typeof plans)[number]) {
    if (writing.current) return;
    writing.current = true;
    setSaving(plan.id);
    setSaveError(false);
    try {
      await saveChoice(parallelChoice(plan, constraints));
      setSaved(plan.id);
    } catch {
      setSaveError(true);
    } finally {
      writing.current = false;
      setSaving(null);
    }
  }

  if (comparing) {
    return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <View style={layout.intro}>
        <Heading large>Compare next steps</Heading>
        <Body>Ideas from the photos you selected. Time estimates are approximate.</Body>
        <View style={styles.row}>
          <Button label="Change photos" subtle disabled={saving !== null} run={() => setComparing(false)} />
        </View>
      </View>

      <View style={layout.controls}>
        <Text style={layout.label}>Time available</Text>
        <View style={styles.row}>
          {parallelBudgets.map((minutes) => <Chip key={minutes} label={`${minutes} min`}
            selected={constraints.minutes === minutes} run={() => {
              if (!writing.current) {
                setConstraints({ ...constraints, minutes });
                setExpanded(null);
                setSaved(null);
              }
            }} />)}
        </View>
        <Text style={layout.label}>Preferred approach</Text>
        <View style={styles.row}>
          {parallelPreferences.map((preference) => <Chip key={preference} label={preference}
            selected={constraints.preference === preference} run={() => {
              if (!writing.current) {
                setConstraints({ ...constraints, preference });
                setExpanded(null);
                setSaved(null);
              }
            }} />)}
        </View>
      </View>

      {scope === null
        ? loadError
          ? <EmptyState icon="image" title="Couldn’t refresh photos" text="Try again before choosing a next step."
            action={<Button label="Retry" subtle run={() => setReload((value) => value + 1)} />} />
          : <ActivityIndicator accessibilityLabel="Refreshing photos" color={color.blue} />
        : plans.length === 0
          ? <EmptyState icon="image" title="Choose another photo" text="The selected photos are no longer available."
            action={<Button label="Change photos" subtle run={() => setComparing(false)} />} />
          : <View>
            {plans.map((plan) => {
              const visible = activePlan === plan.id;
              return <View key={plan.id} style={layout.option}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: visible }}
                  onPress={() => setExpanded(visible ? '' : plan.id)}
                  style={({ pressed }) => [layout.optionTop, pressed && styles.faded]}>
                  <View style={layout.optionText}>
                    <Text style={layout.optionTitle}>{plan.title}</Text>
                    <Body>{plan.summary}</Body>
                  </View>
                  <View style={layout.effort}>
                    <Text style={layout.estimate}>{plan.minutes} min</Text>
                    <Icon name={visible ? 'up' : 'down'} size={16} tint={color.muted} />
                  </View>
                </Pressable>

                {visible && <View style={layout.expanded}>
                  {plan.steps.map((step, index) => <View key={step} style={layout.step}>
                    <Text style={layout.stepNumber}>{index + 1}</Text>
                    <View style={layout.optionText}><Body>{step}</Body></View>
                  </View>)}
                  <Text style={layout.label}>Source photos</Text>
                  <View style={styles.row}>
                    {plan.evidence.map((photo) => <View key={photo.id} style={layout.source}>
                      <PhotoTile uri={photo.uri} label={`Open source photo ${photo.name}`} press={() => open(photo)} />
                    </View>)}
                  </View>
                  <Button label={saved === plan.id ? 'Choice saved' : saving === plan.id ? 'Saving…' : 'Save this choice'}
                    disabled={saving !== null || saved === plan.id} run={() => void save(plan)} />
                </View>}
              </View>;
            })}
          </View>}
      {saveError && <ErrorText>Couldn’t save your choice. Try again.</ErrorText>}
      {saved && <Text accessibilityLiveRegion="polite" style={layout.saved}>Choice saved on this device.</Text>}
    </ScrollView>;
  }

  return <View style={layout.container}>
    <PhotoGrid
      data={scope?.items ?? []}
      extraData={selected}
      keyExtractor={({ photo }) => photo.id}
      ListHeaderComponent={<View style={layout.intro}>
        <Heading large>Parallel</Heading>
        <Body>Choose photos you want to do something with.</Body>
        <View style={styles.row}>
          {scopes.map((range) => <Chip key={range} label={`Last ${range} days`} selected={days === range} run={() => {
            if (days !== range) {
              setDays(range);
              setSelected([]);
            }
          }} />)}
        </View>
        {scope?.truncated && <Body>Showing part of this range. Choose a shorter range to narrow the list.</Body>}
        {selected.length === MAX_PARALLEL_PHOTOS && <Body>Deselect a photo to add another.</Body>}
      </View>}
      ListEmptyComponent={scope === null
        ? loadError
          ? <EmptyState icon="image" title="Couldn’t load your photos" text="Retry to see photos from your local index."
            action={<Button label="Retry" subtle run={() => setReload((value) => value + 1)} />} />
          : <ActivityIndicator accessibilityLabel="Loading photos" color={color.blue} />
        : <EmptyState icon="gallery" title="No photos in this range" text="Choose a longer range or scan more photos from your gallery." />}
      renderTile={({ photo }) => <PhotoTile uri={photo.uri} label={`Select ${photo.name}`}
        selected={selected.includes(photo.id)} press={() => choose(photo)} longPress={() => open(photo)} />}
    />
    {scope !== null && scope.items.length > 0 && <View style={layout.footer}>
      <Text accessibilityLiveRegion="polite" style={layout.selection}>{selected.length} of {MAX_PARALLEL_PHOTOS} selected</Text>
      <Button label="Compare next steps" disabled={chosen.length === 0} run={() => {
        setExpanded(null);
        setSaveError(false);
        setSaved(null);
        setComparing(true);
      }} />
    </View>}
  </View>;
}

const layout = StyleSheet.create({
  container: { flex: 1 },
  intro: { gap: 12, paddingBottom: 8 },
  controls: { gap: 10 },
  label: { fontSize: 15, fontWeight: '600', color: color.ink },
  option: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.rule },
  optionTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 17 },
  optionText: { flex: 1, gap: 5 },
  optionTitle: { fontSize: 19, fontWeight: '600', color: color.ink },
  effort: { alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  estimate: { fontSize: 14, fontWeight: '600', color: color.blue },
  expanded: { gap: 12, paddingBottom: 18 },
  step: { flexDirection: 'row', gap: 10 },
  stepNumber: { color: color.blue, fontSize: 14, fontWeight: '600', lineHeight: 21, minWidth: 12 },
  source: { width: 57 },
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule, backgroundColor: color.paper, gap: 8 },
  selection: { color: color.muted, fontSize: 14 },
  saved: { color: color.blue, fontSize: 14 },
});
