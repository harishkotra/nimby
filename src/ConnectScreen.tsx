import { ActionMenu } from './ActionSheet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Result } from './gallery';
import {
  buildEvents, emptyCorrections, mergeEvents, parseCorrections, renameEvent, splitEvent,
  type ConnectCandidate, type ConnectCorrections, type ConnectEvent, type ConnectPage,
} from './connectTimeline';
import { pickEventHighlights } from './eventHighlights';
import { PhotoGrid, PhotoTile } from './PhotoGrid';
import { ActionLink, Body, Button, color, EmptyState, ErrorText, Heading, styles } from './ui';

export type ConnectScreenProps = {
  revision: number;
  open: (photo: Result) => void;
  loadCandidates: (start: number, end: number) => Promise<ConnectPage>;
  loadCorrections: () => Promise<string | null>;
  saveCorrections: (data: string) => Promise<void>;
  onCorrectionsChanged?: () => void;
};

function dateLabel(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function spanLabel(event: ConnectEvent) {
  const first = dateLabel(event.first);
  const last = dateLabel(event.last);
  return first === last ? first : `${first} – ${last}`;
}

function ranges(period: number) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1 - period * 90);
  const start = new Date(end);
  start.setDate(end.getDate() - 90);
  return { start: start.getTime(), end: end.getTime() };
}

export function ConnectScreen({
  revision, open, loadCandidates, loadCorrections, saveCorrections, onCorrectionsChanged,
}: ConnectScreenProps) {
  const [period, setPeriod] = useState(0);
  const [reload, setReload] = useState(0);
  const [snapshot, setSnapshot] = useState<ConnectPage | null>(null);
  const [corrections, setCorrections] = useState(emptyCorrections);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const write = useRef(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showHighlights, setShowHighlights] = useState(false);
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [split, setSplit] = useState<Set<string> | null>(null);
  const range = useMemo(() => ranges(period), [period, revision]);

  useEffect(() => {
    let live = true;
    setLoadError(false);
    setSnapshot(null);
    setMergeFrom(null);
    setRename(null);
    setSplit(null);
    setSaveError(false);
    Promise.all([loadCandidates(range.start, range.end), loadCorrections()]).then(([page, saved]) => {
      if (!live) return;
      setCorrections(parseCorrections(saved));
      setSnapshot(page);
    }).catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
  }, [loadCandidates, loadCorrections, range, reload]);

  const events = useMemo(() => buildEvents(snapshot?.items ?? [], corrections), [snapshot, corrections]);
  const active = events.find((event) => event.id === activeId);
  const merging = events.find((event) => event.id === mergeFrom);
  const highlights = useMemo(() => showHighlights && active ? pickEventHighlights(active.items) : [], [active, showHighlights]);

  useEffect(() => {
    if (snapshot && activeId && !active) {
      setActiveId(null);
      setShowHighlights(false);
    }
  }, [active, activeId, snapshot]);

  useEffect(() => {
    if (!activeId && !mergeFrom) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (write.current) return true;
      if (rename !== null) setRename(null);
      else if (split !== null) setSplit(null);
      else if (showHighlights) setShowHighlights(false);
      else {
        setActiveId(null);
        setMergeFrom(null);
        setSaveError(false);
      }
      return true;
    });
    return () => back.remove();
  }, [activeId, mergeFrom, rename, split, showHighlights]);

  function showEvent(id: string | null) {
    setActiveId(id);
    setShowHighlights(false);
    setRename(null);
    setSplit(null);
    setSaveError(false);
  }

  async function save(next: ConnectCorrections) {
    if (write.current || next === corrections) return;
    write.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      await saveCorrections(JSON.stringify(next));
      setCorrections(next);
      setActiveId(null);
      setMergeFrom(null);
      setRename(null);
      setSplit(null);
      onCorrectionsChanged?.();
    } catch {
      setSaveError(true);
    } finally {
      write.current = false;
      setSaving(false);
    }
  }

  if (activeId && !snapshot && !loadError) return <View style={styles.content}>
    <ActivityIndicator accessibilityLabel="Refreshing moment" color={color.blue} />
  </View>;

  if (active && showHighlights) return <PhotoGrid<ConnectCandidate>
    key="event-highlights"
    desired={2}
    data={highlights}
    keyExtractor={(item) => item.photo.id}
    showsVerticalScrollIndicator={false}
    ListHeaderComponent={<View style={layout.header}>
      <View style={styles.row}><ActionLink label="Back to moment" run={() => setShowHighlights(false)} /></View>
      <Heading large>Highlights</Heading>
      <Body>{active.title} · {spanLabel(active)}</Body>
      {!!highlights.length && <Body>{highlights.length} {highlights.length === 1 ? 'photo' : 'photos'} picked using Eye’s saved scores, with one frame per detected burst.</Body>}
    </View>}
    ListEmptyComponent={<EmptyState icon="image" title="No highlights for this moment yet"
      text="Highlights need a scanned photo or selfie with an Eye score. Screenshots and documents are skipped." />}
    renderTile={({ photo }) => <PhotoTile uri={photo.uri} label={`Open highlight ${photo.name}`} press={() => open(photo)} />}
  />;

  if (active) {
    const changeSplit = (id: string) => setSplit((previous) => {
      if (!previous) return previous;
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    return <PhotoGrid<ConnectCandidate>
      data={active.items}
      keyExtractor={(item) => item.photo.id}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={layout.header}>
        <View style={styles.row}>
          <ActionLink label="All moments" disabled={saving} run={() => showEvent(null)} />
        </View>
        <Heading large>{active.title}</Heading>
        <Body>{spanLabel(active)} · {active.items.length.toLocaleString()} {active.items.length === 1 ? 'photo' : 'photos'}</Body>
        {active.reasons.map((reason) => <Body key={reason}>{reason}</Body>)}
        {!active.reasons.length && <Body>This photo sits on its own in the timeline.</Body>}
        {saveError && <ErrorText>Could not save this change. Try again.</ErrorText>}
        {rename !== null ? <>
          <TextInput value={rename} onChangeText={setRename} maxLength={80} placeholder="Name this moment"
            placeholderTextColor={color.muted} accessibilityLabel="Moment name" style={layout.input} />
          <View style={styles.row}>
            <Button label="Save name" disabled={saving || !rename.trim()} run={() => void save(renameEvent(corrections, active, rename))} />
            <ActionLink label="Cancel" disabled={saving} run={() => setRename(null)} />
          </View>
        </> : split !== null ? <>
          <Body>Pick the photos for a new moment.</Body>
          <View style={styles.row}>
            <Button label="Save split" disabled={saving || !split.size || split.size >= active.items.length}
              run={() => void save(splitEvent(corrections, active, split))} />
            <ActionLink label="Cancel" disabled={saving} run={() => setSplit(null)} />
          </View>
        </> : <>
          <Button label="Pick highlights" disabled={saving} run={() => setShowHighlights(true)} />
          <View style={styles.row}>
            {!active.confirmed && <ActionLink label="Confirm moment" disabled={saving} run={() => void save(renameEvent(corrections, active, active.title))} />}
            <ActionMenu title="Edit this moment" label="Edit moment" disabled={saving} options={[
              { label: 'Rename moment', run: () => setRename(active.title) },
              ...(active.items.length > 1 ? [{ label: 'Split moment', run: () => setSplit(new Set<string>()) }] : []),
              ...(events.length > 1 ? [{ label: 'Merge with another moment', run: () => {
                setMergeFrom(active.id);
                showEvent(null);
              } }] : []),
            ]} />
          </View>
        </>}
      </View>}
      renderTile={({ photo }) => <PhotoTile uri={photo.uri} label={photo.name}
        selected={split ? split.has(photo.id) : undefined}
        press={() => split ? changeSplit(photo.id) : open(photo)} />}
    />;
  }

  return <FlatList<ConnectEvent>
    data={events}
    keyExtractor={(event) => event.id}
    contentContainerStyle={styles.content}
    showsVerticalScrollIndicator={false}
    ListHeaderComponent={<View style={layout.header}>
      <Heading large>Timeline</Heading>
      <Body>Moments from photos taken around the same time or place.</Body>
      {merging ? <View style={layout.band}>
        <Body>Choose a moment to merge with “{merging.title}”.</Body>
        <View style={styles.row}>
          <ActionLink label="Cancel merge" disabled={saving} run={() => {
            setMergeFrom(null);
            setSaveError(false);
          }} />
        </View>
      </View> : <>
        <Body>{dateLabel(range.start)} – {dateLabel(range.end - 1)}</Body>
        <View style={styles.row}>
          <ActionLink label="Earlier" run={() => setPeriod(period + 1)} />
          {period > 0 && <ActionLink label="Later" run={() => setPeriod(period - 1)} />}
        </View>
      </>}
      {snapshot?.truncated && <Body>Showing the most recent indexed photos in this period.</Body>}
      {loadError ? <><ErrorText>Could not load the timeline.</ErrorText>
        <Button label="Retry" subtle run={() => setReload(reload + 1)} /></> : !snapshot &&
        <ActivityIndicator accessibilityLabel="Building timeline" color={color.blue} />}
      {saveError && <ErrorText>Could not save this change. Try again.</ErrorText>}
    </View>}
    ListEmptyComponent={snapshot && !loadError ? <EmptyState icon="clock" mascot="resting" title="No moments in this period"
      text="Scan photos with capture dates or choose a different period." /> : undefined}
    renderItem={({ item }) => <View style={layout.moment}>
      <View style={layout.rule}><View style={layout.dot} /></View>
      <View style={layout.card}>
        <Text style={layout.date}>{spanLabel(item)}</Text>
        <Heading>{item.title}</Heading>
        {!!item.reasons.length && <Body>{item.reasons.join(' · ')}</Body>}
        <View style={layout.previews}>
          {item.items.slice(0, 3).map(({ photo }) => <View key={photo.id} style={layout.preview}>
            <PhotoTile uri={photo.uri} label={photo.name} press={() => open(photo)} />
          </View>)}
        </View>
        <View style={styles.row}>
          {merging ? <ActionLink label={item.id === merging.id ? 'Selected moment' : 'Merge with this moment'}
            disabled={saving || item.id === merging.id}
            run={() => void save(mergeEvents(corrections, merging, item))} /> :
            <ActionLink label={`Open ${item.items.length.toLocaleString()} ${item.items.length === 1 ? 'photo' : 'photos'}`}
              run={() => showEvent(item.id)} />}
        </View>
      </View>
    </View>}
  />;
}

const layout = StyleSheet.create({
  header: { gap: 10 },
  band: { padding: 14, borderRadius: 12, backgroundColor: color.tint, gap: 8 },
  moment: { flexDirection: 'row', gap: 12 },
  rule: { width: 1, backgroundColor: color.rule, marginLeft: 5, marginTop: 9 },
  dot: { position: 'absolute', width: 7, height: 7, borderRadius: 4, top: 0, left: -3, backgroundColor: color.blue },
  card: { flex: 1, gap: 7 },
  date: { color: color.blue, fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  previews: { flexDirection: 'row', gap: 6, marginVertical: 2 },
  preview: { flex: 1, maxWidth: '36%' },
  input: { minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderColor: color.rule,
    paddingHorizontal: 14, borderRadius: 12, color: color.ink, backgroundColor: color.white, fontSize: 16 },
});
