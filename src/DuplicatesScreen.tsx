import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { ActionMenu } from './ActionSheet';
import { useArchiveConfirmation } from './ArchiveScreen';
import { ImageViewer } from './ImageViewer';
import { PhotoTile } from './PhotoGrid';
import { native, type DuplicateGroup, type DuplicatePhoto } from './gallery';
import { ActionLink, Body, Button, color, ErrorText, formatBytes, Heading, percent, styles } from './ui';

const maxArchiveSelection = 200;

function Group({ group, changed }: { group: DuplicateGroup; changed: () => void }) {
  const confirmArchive = useArchiveConfirmation();
  const [keeper, setKeeper] = useState(group.photos[0]?.uri);
  const [selected, setSelected] = useState(new Set<string>());
  const [mode, setMode] = useState<'browse' | 'compare' | 'select' | 'keeper'>('browse');
  const [comparison, setComparison] = useState(0);
  const [preview, setPreview] = useState<DuplicatePhoto | null>(null);
  const recommended = group.photos[0];
  const kept = group.photos.find((photo) => photo.uri === keeper) ?? recommended;
  const alternatives = group.photos.filter((photo) => photo.uri !== kept.uri);
  const selectable = alternatives.slice(0, maxArchiveSelection);
  const alternative = alternatives[comparison] ?? alternatives[0];
  const allSelected = Boolean(selectable.length) && selectable.length === selected.size && selectable.every((photo) => selected.has(photo.uri));

  function caption(photo: DuplicatePhoto) {
    if (photo.uri === kept.uri) return kept.uri === recommended.uri ? 'Suggested keeper' : 'Your keeper';
    return photo.uri === recommended.uri ? 'Suggested keeper' : photo.album || 'Gallery';
  }

  function tap(photo: DuplicatePhoto) {
    if (mode === 'keeper') {
      setKeeper(photo.uri);
      setSelected((current) => new Set([...current].filter((uri) => uri !== photo.uri)));
      setMode('browse');
      return;
    }
    if (mode !== 'select' || photo.uri === kept.uri) {
      setPreview(photo);
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(photo.uri)) next.delete(photo.uri);
      else if (next.size < maxArchiveSelection) next.add(photo.uri);
      return next;
    });
  }

  return <View style={layout.group}>
    <View style={styles.between}>
      <Heading>{group.similarity == null ? 'Exact copies' : 'Visual matches'}</Heading>
      <Body>{group.photos.length.toLocaleString()} photos</Body>
    </View>
    {mode === 'keeper' && <Body>Tap the photo you want to keep.</Body>}
    {mode === 'select' && <Text accessibilityLiveRegion="polite" style={styles.body}>
      {selected.size ? `${selected.size.toLocaleString()} selected` : 'Tap the alternatives you want to archive.'}
    </Text>}
    {mode === 'compare' && alternative ? <>
      <View style={layout.comparison}>
        {[kept, alternative].map((photo) => <View key={photo.uri} style={layout.comparisonPhoto}>
          <PhotoTile uri={photo.uri} label={`Preview ${photo.name}, ${caption(photo)}`} contain press={() => setPreview(photo)} />
          <Text style={[layout.caption, photo.uri === kept.uri && layout.accent]}>{caption(photo)}</Text>
          {photo.keeper != null && <Body>Keeper score {percent(photo.keeper)}</Body>}
        </View>)}
      </View>
      {alternatives.length > 1 && <View style={styles.between}>
        <ActionLink label="Previous photo" disabled={comparison === 0} run={() => setComparison(comparison - 1)} />
        <Text accessibilityLiveRegion="polite" style={styles.body}>{comparison + 1} of {alternatives.length} alternatives</Text>
        <ActionLink label="Next photo" disabled={comparison >= alternatives.length - 1} run={() => setComparison(comparison + 1)} />
      </View>}
    </> : <FlatList horizontal data={group.photos} extraData={[keeper, selected, mode]}
      keyExtractor={(photo) => photo.uri} contentContainerStyle={layout.strip} showsHorizontalScrollIndicator={false}
      renderItem={({ item: photo }) => {
        const isKeeper = photo.uri === kept.uri;
        return <View style={layout.tile}>
          <PhotoTile uri={photo.uri} label={`${photo.name}, ${caption(photo)}`}
            selected={mode === 'keeper' ? isKeeper : mode === 'select' && !isKeeper ? selected.has(photo.uri) : undefined}
            press={() => tap(photo)} />
          <Text style={[layout.caption, isKeeper && layout.accent]}>{caption(photo)}</Text>
        </View>;
      }} />}
    <View style={styles.between}>
      {mode === 'browse' && <>
        <ActionLink label="Compare photos" run={() => { setComparison(0); setMode('compare'); }} />
        <ActionMenu title="Duplicate actions" label="More duplicate actions" overflow options={[
          { label: 'Select photos to archive', run: () => setMode('select') },
          { label: 'Change keeper', run: () => setMode('keeper') },
        ]} />
      </>}
      {mode === 'compare' && <>
        <ActionLink label="Done comparing" run={() => setMode('browse')} />
        <ActionLink label="Select photos to archive" run={() => setMode('select')} />
      </>}
      {mode === 'keeper' && <ActionLink label="Cancel" run={() => setMode('browse')} />}
      {mode === 'select' && <>
        <ActionLink label={allSelected ? 'Clear selection' : alternatives.length > maxArchiveSelection
          ? `Select first ${maxArchiveSelection} alternatives` : 'Select alternatives'}
          run={() => setSelected(allSelected ? new Set() : new Set(selectable.map((photo) => photo.uri)))} />
        <ActionLink label="Cancel selection" run={() => { setSelected(new Set()); setMode('browse'); }} />
      </>}
    </View>
    {selected.size > 0 && mode === 'select' && <Button icon="archive" label={`Archive ${selected.size.toLocaleString()}`}
      run={() => confirmArchive([...selected], changed)} />}
    {preview && <ImageViewer uri={preview.uri} label={preview.name} album={preview.album} close={() => setPreview(null)}>
      <Heading>{preview.name}</Heading>
      <Body>{preview.album} · {preview.bytes ? formatBytes(preview.bytes) : 'Size unavailable'}</Body>
      {preview.uri === recommended.uri && <Body>Suggested keeper for this group</Body>}
      {preview.aesthetic != null && <Body>{percent(preview.aesthetic)} Eye aesthetic score</Body>}
      {preview.keeper != null && <Body>{percent(preview.keeper)} Eye keeper score</Body>}
    </ImageViewer>}
  </View>;
}

export function DuplicatesScreen({ revision, changed }: { revision: number; changed: () => void }) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState(false);
  const sequence = useRef(0);
  const busy = useRef(false);

  async function load(offset: number) {
    if (busy.current || !native) return;
    busy.current = true;
    const request = sequence.current;
    setStatus('loading');
    try {
      const page = await native.duplicatePage(offset);
      if (request !== sequence.current) return;
      setGroups((last) => offset ? [...last, ...page] : page);
      setMore(page.length === 20);
      setStatus('ready');
    } catch {
      if (request === sequence.current) setStatus('error');
    } finally {
      if (request === sequence.current) busy.current = false;
    }
  }

  useEffect(() => {
    sequence.current++;
    busy.current = false;
    setGroups([]);
    void load(0);
    return () => { sequence.current++; };
  }, [revision]);

  return <FlatList data={groups} keyExtractor={(item) => item.id} contentContainerStyle={styles.content}
    onEndReachedThreshold={0.5} onEndReached={() => { if (more && status === 'ready') void load(groups.length); }}
    ListHeaderComponent={<View style={styles.column}>
      <Heading large>Review duplicates</Heading>
      <Body>Compare photos, then select the ones you want to archive.</Body>
      {status === 'loading' && <Body>Checking indexed photos…</Body>}
      {status === 'error' && <ErrorText>Duplicate review could not be loaded.</ErrorText>}
    </View>}
    ListEmptyComponent={status === 'ready' ? <Body>No matches found among your accessible indexed photos.</Body> : undefined}
    renderItem={({ item }) => <Group group={item} changed={changed} />} />;
}

const layout = StyleSheet.create({
  group: { paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.rule, gap: 8 },
  strip: { gap: 8 },
  tile: { width: 140, gap: 4 },
  comparison: { flexDirection: 'row', gap: 8 },
  comparisonPhoto: { flex: 1, gap: 4 },
  caption: { color: color.ink, fontWeight: '500', fontSize: 14 },
  accent: { color: color.blue, fontWeight: '600' },
});
