import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useDialog } from './Dialogs';
import {
  readCorrections, readEvolveState, writeOutcome,
  type Correction, type CorrectionSection, type EvolveChoice, type EvolveState, type OutcomeRating,
} from './evolve';
import { Body, Button, Chip, color, EmptyState, ErrorText, Heading, styles } from './ui';

export type EvolveScreenProps = {
  loadState: () => Promise<string | null>;
  saveState: (data: string) => Promise<void>;
  loadPatternFeedback: () => Promise<string | null>;
  loadConnectCorrections: () => Promise<string | null>;
  changed: () => void;
  resetCorrections?: (section: CorrectionSection) => Promise<void>;
  revision?: number;
};

type Filter = 'all' | 'pending' | 'recorded';
type Draft = { id: string; rating: OutcomeRating | null; note: string };
const ratings: { value: OutcomeRating; label: string }[] = [
  { value: 'helpful', label: 'Helpful' },
  { value: 'not_helpful', label: 'Not helpful' },
  { value: 'not_tried', label: 'Didn’t try it' },
];
const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'pending', label: 'Awaiting outcome' }, { value: 'recorded', label: 'Recorded' },
];
const dateLabel = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined,
  { day: 'numeric', month: 'short', year: 'numeric' });

export function EvolveScreen({
  loadState, saveState, loadPatternFeedback, loadConnectCorrections, changed, resetCorrections, revision,
}: EvolveScreenProps) {
  const dialog = useDialog();
  const [state, setState] = useState<EvolveState | null>(null);
  const [corrections, setCorrections] = useState<Record<CorrectionSection, Correction[]>>({ patterns: [], connect: [] });
  const [section, setSection] = useState<CorrectionSection | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const saving = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void Promise.allSettled([loadState(), loadPatternFeedback(), loadConnectCorrections()]).then(([choices, patterns, connect]) => {
      if (!active) return;
      if (choices.status === 'fulfilled') setState(readEvolveState(choices.value));
      setCorrections({
        patterns: patterns.status === 'fulfilled' ? readCorrections('patterns', patterns.value) : [],
        connect: connect.status === 'fulfilled' ? readCorrections('connect', connect.value) : [],
      });
      if ([choices, patterns, connect].some((result) => result.status === 'rejected')) {
        setError('Some activity couldn’t be loaded.');
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [loadState, loadPatternFeedback, loadConnectCorrections, revision, retry]);

  async function update(change: (value: EvolveState) => EvolveState) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const next = change(readEvolveState(await loadState()));
      await saveState(JSON.stringify(next));
      setState(next);
      setDraft(null);
      changed();
    } catch {
      setError('Your changes couldn’t be saved. Try again.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function confirmRemoval(choice?: EvolveChoice) {
    dialog({
      title: choice ? 'Clear this outcome?' : 'Clear all recorded outcomes?',
      message: 'This removes the outcome rating and notes from Nimby’s ranking feedback. Your saved choices and photos stay in place.',
      action: {
        label: choice ? 'Clear outcome' : 'Clear outcomes', destructive: true,
        run: () => void update((current) => choice
          ? writeOutcome(current, choice.id, null)
          : { version: 1, choices: current.choices.map(({ outcome: _removed, ...entry }) => entry) }),
      },
    });
  }

  function confirmCorrections(target: CorrectionSection) {
    if (!resetCorrections) return;
    dialog({
      title: target === 'patterns' ? 'Clear pattern feedback?' : 'Clear event edits?',
      message: target === 'patterns'
        ? 'Discover will forget the patterns you confirmed, corrected, or hid. Your photos and choices stay in place.'
        : 'Connect will rebuild events from your photos. Your confirmations, names, splits, and merges will be removed.',
      action: { label: 'Clear feedback', destructive: true, run: () => void removeCorrections(target) },
    });
  }

  async function removeCorrections(target: CorrectionSection) {
    if (!resetCorrections || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await resetCorrections(target);
      setCorrections((current) => ({ ...current, [target]: [] }));
      changed();
    } catch {
      setError('Feedback couldn’t be cleared. Try again.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const choices = state?.choices ?? [];
  const recorded = choices.filter((choice) => choice.outcome).length;
  const visible = choices.filter((choice) => filter === 'all' || (filter === 'recorded' ? !!choice.outcome : !choice.outcome));
  const entries = section ? corrections[section] : [];
  const header = <View style={styles.column}>
    <Heading large>Evolve</Heading>
    <Body>Record what helped so Nimby can give useful photos and next steps a little more weight.</Body>
    <View style={styles.row}>
      <Chip label="Choices" selected={section === null} run={() => setSection(null)} />
      <Chip label="Pattern feedback" selected={section === 'patterns'} run={() => { setDraft(null); setSection('patterns'); }} />
      <Chip label="Event edits" selected={section === 'connect'} run={() => { setDraft(null); setSection('connect'); }} />
    </View>
    {!section && choices.length > 0 && <View style={styles.row}>
      {filters.map(({ label, value }) => <Chip key={value} label={label} selected={filter === value}
        run={() => { setDraft(null); setFilter(value); }} />)}
    </View>}
    {!!error && <View style={styles.column}>
      <ErrorText>{error}</ErrorText>
      <Button label="Reload activity" subtle disabled={busy || loading} run={() => setRetry((value) => value + 1)} />
    </View>}
    {loading && <ActivityIndicator accessibilityLabel="Loading Evolve" color={color.blue} />}
  </View>;

  if (section) return <FlatList key={section} data={entries} keyExtractor={(entry) => entry.id}
    ListHeaderComponent={header} contentContainerStyle={styles.content}
    ListEmptyComponent={loading || error ? undefined : <EmptyState icon="layers" title="No feedback yet"
      text={section === 'patterns' ? 'Confirm, correct, or hide a suggestion in Discover.'
        : 'Confirm, rename, split, or merge an event in Connect.'} />}
    ListFooterComponent={entries.length && resetCorrections ? <Button label="Clear feedback" destructive
      disabled={busy || loading} run={() => confirmCorrections(section)} /> : undefined}
    renderItem={({ item }) => <View style={layout.entry}>
      <Heading>{item.title}</Heading>
      <Body>{item.detail}{item.at ? ` · ${dateLabel(item.at)}` : ''}</Body>
    </View>} />;

  return <FlatList key="choices" data={visible} keyExtractor={(choice) => choice.id}
    ListHeaderComponent={header} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
    ListEmptyComponent={loading || state == null ? undefined : <EmptyState icon="clock"
      title={choices.length ? 'No choices match this filter' : 'No choices saved'}
      text={choices.length ? 'Choose another filter to see your saved next steps.' : 'Choose a next step in Parallel and it will appear here.'} />}
    ListFooterComponent={recorded ? <Button label="Clear all outcomes" destructive
      disabled={busy || loading} run={() => confirmRemoval()} /> : undefined}
    renderItem={({ item }) => <View style={layout.entry}>
      <Heading>{item.title}</Heading>
      <Body>{dateLabel(item.at)} · {item.photoIds.length} {item.photoIds.length === 1 ? 'source photo' : 'source photos'}</Body>
      {!!item.constraints && <Body>{item.constraints}</Body>}
      {draft?.id === item.id ? <View style={styles.column}>
        <Text style={layout.label}>How did it go?</Text>
        <View style={styles.row}>
          {ratings.map(({ value, label }) => <Chip key={value} label={label} selected={draft.rating === value}
            run={() => setDraft({ ...draft, rating: value })} />)}
        </View>
        <TextInput value={draft.note} onChangeText={(note) => setDraft({ ...draft, note })}
          accessibilityLabel="Outcome notes" placeholder="Add a note (optional)" placeholderTextColor={color.muted}
          multiline editable={!busy} maxLength={1000} style={layout.input} />
        <View style={styles.row}>
          <Button label="Save outcome" disabled={busy || !draft.rating} run={() => {
            if (!draft.rating) return;
            const outcome = { rating: draft.rating, note: draft.note, at: Date.now() };
            void update((current) => writeOutcome(current, item.id, outcome));
          }} />
          <Button label="Cancel" subtle disabled={busy} run={() => setDraft(null)} />
        </View>
      </View> : <>
        {item.outcome && <View style={layout.outcome}>
          <Text style={layout.label}>{ratings.find(({ value }) => value === item.outcome?.rating)?.label}</Text>
          {!!item.outcome.note && <Body>{item.outcome.note}</Body>}
        </View>}
        <View style={styles.row}>
          <Button label={item.outcome ? 'Edit outcome' : 'Record outcome'} subtle disabled={busy || loading} run={() => setDraft({
            id: item.id, rating: item.outcome?.rating ?? null, note: item.outcome?.note ?? '',
          })} />
          {item.outcome && <Button label="Clear outcome" subtle disabled={busy || loading} run={() => confirmRemoval(item)} />}
        </View>
      </>}
    </View>} />;
}

const layout = StyleSheet.create({
  entry: { backgroundColor: color.white, borderRadius: 16, padding: 16, gap: 8 },
  outcome: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.rule, paddingTop: 8, gap: 4 },
  label: { color: color.blue, fontSize: 15, fontWeight: '600' },
  input: { color: color.ink, minHeight: 76, textAlignVertical: 'top', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: color.rule, backgroundColor: color.paper },
});
