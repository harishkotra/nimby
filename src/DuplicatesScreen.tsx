import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useArchiveConfirmation } from './ArchiveScreen';
import { ImageViewer } from './ImageViewer';
import { PhotoTile } from './PhotoGrid';
import { native, type DuplicateGroup, type DuplicatePhoto } from './gallery';
import { Body, Button, color, ErrorText, formatBytes, Heading, percent, styles } from './ui';

const maxArchiveSelection = 200;

function Group({ group, changed }: { group: DuplicateGroup; changed: () => void }) {
  const confirmArchive = useArchiveConfirmation();
  const [keeper, setKeeper] = useState(group.photos[0]?.uri);
  const [selected, setSelected] = useState(new Set<string>());
  const [choosingKeeper, setChoosingKeeper] = useState(false);
  const [preview, setPreview] = useState<DuplicatePhoto | null>(null);
  const recommended = group.photos[0];
  const kept = group.photos.find((photo) => photo.uri === keeper) ?? recommended;
  const alternatives = group.photos.filter((photo) => photo.uri !== kept.uri);
  const selectable = alternatives.slice(0, maxArchiveSelection);
  const allSelected = selectable.length === selected.size && selectable.every((photo) => selected.has(photo.uri));

  function tap(photo: DuplicatePhoto) {
    if (choosingKeeper) {
      setKeeper(photo.uri);
      setSelected((current) => new Set([...current].filter((uri) => uri !== photo.uri)));
      setChoosingKeeper(false);
      return;
    }
    if (photo.uri === kept.uri) {
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
    <Body>{choosingKeeper ? 'Tap the photo you want to keep.' : 'Tap photos to select them for the archive. Hold to preview.'}</Body>
    <FlatList horizontal data={group.photos} extraData={[keeper, selected, choosingKeeper]}
      keyExtractor={(photo) => photo.uri} contentContainerStyle={layout.strip} showsHorizontalScrollIndicator={false}
      renderItem={({ item: photo }) => {
        const isKeeper = photo.uri === kept.uri;
        return <View style={layout.tile}>
          <PhotoTile uri={photo.uri} label={`${photo.name}${isKeeper ? ', keeper' : ''}`}
            selected={choosingKeeper ? isKeeper : isKeeper ? undefined : selected.has(photo.uri)}
            press={() => tap(photo)} longPress={() => setPreview(photo)} />
          <Text style={[layout.caption, isKeeper && layout.accent]} numberOfLines={1}>
            {isKeeper ? 'Keeping' : photo.uri === recommended.uri ? 'Recommended' : photo.album || 'Gallery'}
          </Text>
          {photo.keeper != null && <Body>{percent(photo.keeper)} keeper score</Body>}
        </View>;
      }} />
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: choosingKeeper }}
        style={styles.textAction} onPress={() => setChoosingKeeper(!choosingKeeper)}>
        <Text style={styles.link}>{choosingKeeper ? 'Cancel' : 'Change keeper'}</Text>
      </Pressable>
      {!choosingKeeper && <Pressable accessibilityRole="button" style={styles.textAction}
        onPress={() => setSelected(allSelected ? new Set() : new Set(selectable.map((photo) => photo.uri)))}>
        <Text style={styles.link}>{allSelected ? 'Clear selection' : alternatives.length > maxArchiveSelection
          ? `Select first ${maxArchiveSelection}` : 'Select alternatives'}</Text>
      </Pressable>}
    </View>
    {selected.size > 0 && !choosingKeeper && <Button icon="archive" label={`Archive ${selected.size.toLocaleString()}`}
      run={() => confirmArchive([...selected], changed)} />}
    {preview && <ImageViewer uri={preview.uri} label={preview.name} album={preview.album} close={() => setPreview(null)}>
      <Heading>{preview.name}</Heading>
      <Body>{preview.album} · {preview.bytes ? formatBytes(preview.bytes) : 'Size unavailable'}</Body>
      {preview.uri === recommended.uri && <Body>Recommended keeper</Body>}
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
      <Body>Nimby suggests one keeper per group. You choose what to archive.</Body>
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
  caption: { color: color.ink, fontWeight: '500', fontSize: 14 },
  accent: { color: color.blue, fontWeight: '600' },
});
