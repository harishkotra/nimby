import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { confirmArchive } from './ArchiveScreen';
import { native, type DuplicateGroup } from './gallery';
import { Body, Button, color, ErrorText, formatBytes, Heading, percent, styles, Thumbnail } from './ui';

function Group({ group, changed }: { group: DuplicateGroup; changed: () => void }) {
  const [keeper, setKeeper] = useState(group.photos[0]?.uri);
  const [selected, setSelected] = useState(new Set<string>());
  const recommended = group.photos[0];
  const kept = group.photos.find((photo) => photo.uri === keeper) ?? recommended;

  function selectKeeper(uri: string) {
    setKeeper(uri);
    setSelected((current) => new Set([...current].filter((item) => item !== uri)));
  }

  function toggle(uri: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(uri)) next.delete(uri);
      else if (next.size < 200) next.add(uri);
      return next;
    });
  }

  return <View style={layout.group}>
    <Heading>{group.similarity == null ? 'Exact copies' : 'Visual matches'}</Heading>
    <Body>{group.similarity == null ? 'These originals have identical file contents.'
      : 'Eye linked visually similar images in this group. Review each photo before choosing.'}</Body>
    <FlatList horizontal data={group.photos} extraData={[keeper, selected]} keyExtractor={(photo) => photo.uri} contentContainerStyle={layout.strip}
      renderItem={({ item: photo }) => <View style={layout.tile}>
        <Pressable accessibilityRole="radio" accessibilityLabel={`Retain ${photo.name}`}
          accessibilityState={{ checked: kept.uri === photo.uri }} onPress={() => selectKeeper(photo.uri)}
          style={[layout.photo, kept.uri === photo.uri && layout.chosen]}>
          <Thumbnail uri={photo.uri} style={layout.image} />
          <Text style={layout.name} numberOfLines={2}>{photo.name}</Text>
          <Body>{photo.album} · {photo.bytes ? formatBytes(photo.bytes) : 'Size unavailable'}</Body>
          {photo.uri === recommended.uri && <Text style={layout.accent}>Recommended keeper</Text>}
          {photo.uri === kept.uri && <Text style={layout.accent}>Keep this file</Text>}
          {photo.uri !== kept.uri && <Body>{photo.imageId === kept.imageId ? 'Exact copy of keeper' : 'Visual group member'}</Body>}
          {photo.keeper != null && <Body>Eye keeper score {percent(photo.keeper)}</Body>}
          {photo.aesthetic != null && <Body>Eye aesthetic score {percent(photo.aesthetic)}</Body>}
        </Pressable>
        {photo.uri !== kept.uri && <Button subtle label={selected.has(photo.uri) ? 'Selected' : 'Select to archive'}
          run={() => toggle(photo.uri)} />}
      </View>} />
    <Button label={selected.size ? `Archive ${selected.size} selected` : 'Select alternatives to archive'}
      disabled={!selected.size} run={() => confirmArchive([...selected], changed)} />
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
      <Body>Choose the original you want to retain, then select any alternatives to archive.</Body>
      {status === 'loading' && <Body>Checking indexed photos…</Body>}
      {status === 'error' && <ErrorText>Duplicate review could not be loaded.</ErrorText>}
    </View>}
    ListEmptyComponent={status === 'ready' ? <Body>No matches found among your accessible indexed photos.</Body> : undefined}
    renderItem={({ item }) => <Group group={item} changed={changed} />} />;
}

const layout = StyleSheet.create({
  group: { paddingBottom: 16, borderBottomWidth: 1, borderColor: color.rule, gap: 12 },
  strip: { gap: 10 },
  tile: { width: 169, gap: 8 },
  photo: { backgroundColor: color.white, borderRadius: 14, borderWidth: 1, borderColor: color.rule, padding: 8, gap: 4 },
  chosen: { borderColor: color.blue },
  image: { height: 124, borderRadius: 9 },
  accent: { color: color.blue, fontSize: 13, fontWeight: '700' },
  name: { color: color.ink, fontWeight: '700' },
});
