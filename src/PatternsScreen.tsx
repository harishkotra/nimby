import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Result } from './gallery';
import {
  buildPhotoPatterns, readPatternFeedback, writePatternFeedback,
  type ConfirmedPatternGroup, type PatternCandidate, type PatternFeedback, type PhotoPattern,
} from './patterns';
import { PhotoTile } from './PhotoGrid';
import { Body, Button, color, EmptyState, ErrorText, Heading, styles } from './ui';

type Props = {
  revision: number;
  loadCandidates: (start: number, end: number) => Promise<{ items: PatternCandidate[]; truncated: boolean }>;
  open: (photo: Result) => void;
  loadFeedback: () => Promise<string | null>;
  saveFeedback: (data: string) => Promise<void>;
  loadConfirmedGroups?: () => Promise<ConfirmedPatternGroup[]>;
};

const shortDate = (captured: number) => new Date(captured).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function PatternsScreen({ revision, loadCandidates, open, loadFeedback, saveFeedback, loadConfirmedGroups }: Props) {
  const [items, setItems] = useState<PatternCandidate[]>([]);
  const [groups, setGroups] = useState<ConfirmedPatternGroup[]>([]);
  const [feedback, setFeedback] = useState<PatternFeedback[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hiddenVisible, setHiddenVisible] = useState(false);
  const [error, setError] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const end = Date.now() + 1;
    const start = new Date(end);
    start.setDate(start.getDate() - 90);
    void Promise.all([
      loadCandidates(start.getTime(), end),
      loadFeedback(),
      loadConfirmedGroups?.().catch(() => []) ?? Promise.resolve([]),
    ]).then(([page, stored, eventGroups]) => {
      if (!active) return;
      setItems(page.items);
      setTruncated(page.truncated);
      setFeedback(readPatternFeedback(stored));
      setGroups(eventGroups);
    }).catch(() => {
      if (active) setError('Could not read your scanned photos and saved feedback.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [loadCandidates, loadFeedback, loadConfirmedGroups, retry, revision]);

  const patterns = useMemo(() => buildPhotoPatterns(items, feedback, groups), [items, feedback, groups]);
  const hidden = feedback.filter(({ action }) => action === 'hidden');

  async function persist(next: PatternFeedback[]): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    setFeedbackError('');
    try {
      await saveFeedback(writePatternFeedback(next));
      setFeedback(next);
      return true;
    } catch {
      setFeedbackError('Could not save your feedback. Try again.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  function mark(pattern: PhotoPattern, action: PatternFeedback['action'], label = pattern.title) {
    return persist([...feedback.filter((entry) => entry.id !== pattern.id), { id: pattern.id, label, action, at: Date.now() }]);
  }

  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={layout.header}>
      <Heading large>Discover</Heading>
      <Body>Explore patterns that showed up on several different days over the last 90 days.</Body>
      {truncated && <Body>Suggestions use the most recent scanned photos in this range.</Body>}
    </View>
    {loading && <ActivityIndicator accessibilityLabel="Finding photo patterns" color={color.blue} />}
    {!!error && <View style={styles.column}>
      <ErrorText>{error}</ErrorText>
      <Button label="Try again" subtle run={() => setRetry((value) => value + 1)} />
    </View>}
    {!loading && !error && patterns.length === 0 && <EmptyState icon="image" title="No recurring patterns yet"
      text="Patterns need matching photos from at least three different days. Scan more photos or review hidden patterns." />}
    {!!feedbackError && <ErrorText>{feedbackError}</ErrorText>}
    {!loading && !error && patterns.map((pattern) => <View key={pattern.id} style={layout.card}>
      <View style={layout.header}>
        <Heading>{pattern.title}</Heading>
        <Body>{pattern.evidence}. Seen on {pattern.dates} different days.</Body>
        {pattern.groupNames.length > 0 && <Body>Also appears in {pattern.groupNames.join(' and ')}.</Body>}
        {pattern.feedback && <Text style={layout.status}>{pattern.feedback.action === 'corrected' ? 'Corrected' : 'Confirmed'}</Text>}
      </View>
      <View style={layout.previews}>
        {pattern.members.slice(0, 3).map(({ photo, captured }) => <View key={photo.id} style={layout.preview}>
          <PhotoTile uri={photo.uri} ratio={1.18} label={`${photo.name}, ${shortDate(captured)}`} press={() => open(photo)} />
          <Text style={layout.caption}>{shortDate(captured)}</Text>
        </View>)}
      </View>
      {editing?.id === pattern.id ? <View style={layout.header}>
        <TextInput value={editing.title} onChangeText={(title) => setEditing({ id: pattern.id, title })}
          accessibilityLabel="Corrected pattern name" autoFocus maxLength={60} style={layout.input} />
        <View style={styles.row}>
          <Button label="Save correction" disabled={saving || !editing.title.trim()} run={() => {
            void mark(pattern, 'corrected', editing.title.trim()).then((saved) => { if (saved) setEditing(null); });
          }} />
          <Button label="Cancel" subtle run={() => setEditing(null)} />
        </View>
      </View> : <View style={styles.row}>
        {!pattern.feedback && <Button label="Confirm" disabled={saving} run={() => void mark(pattern, 'confirmed')} />}
        <Button label="Correct" subtle disabled={saving} run={() => setEditing({ id: pattern.id, title: pattern.title })} />
        <Button label="Hide" subtle disabled={saving} run={() => void mark(pattern, 'hidden')} />
      </View>}
    </View>)}
    {!loading && !error && hidden.length > 0 && <View style={styles.column}>
      <Button label={hiddenVisible ? 'Close hidden patterns' : `Hidden patterns (${hidden.length})`} subtle
        run={() => setHiddenVisible(!hiddenVisible)} />
      {hiddenVisible && hidden.map((item) => <View key={item.id} style={styles.between}>
        <Body>{item.label}</Body>
        <Button label="Restore" subtle disabled={saving}
          run={() => void persist(feedback.filter((record) => record.id !== item.id))} />
      </View>)}
    </View>}
  </ScrollView>;
}

const layout = StyleSheet.create({
  header: { gap: 6 },
  card: { padding: 14, borderRadius: 16, gap: 14, backgroundColor: color.white },
  previews: { flexDirection: 'row', gap: 6 },
  preview: { flex: 1, gap: 4 },
  caption: { color: color.muted, fontSize: 12 },
  status: { color: color.blue, fontSize: 13, fontWeight: '600' },
  input: { color: color.ink, paddingHorizontal: 12, minHeight: 48, borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.rule, borderRadius: 10, fontSize: 16, backgroundColor: color.paper },
});
