import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDialog } from './Dialogs';
import { ImageViewer } from './ImageViewer';
import { PhotoGrid, PhotoTile } from './PhotoGrid';
import { native, type ArchivedPhoto } from './gallery';
import { Body, Button, Chip, color, EmptyState, ErrorText, formatBytes, Heading, Icon, IconButton, styles, Thumbnail, useReducedMotion } from './ui';

export function useArchiveConfirmation() {
  const show = useDialog();
  return (uris: string[], success: () => void) => {
    if (!uris.length) return;
    show({
      title: uris.length === 1 ? 'Archive this photo?' : `Archive ${uris.length} photos?`,
      message: 'This hides the photos in Nimby. Originals stay on your phone, and you can restore them in Nimby at any time.',
      action: { label: 'Archive', run: () => {
        native?.archive(uris).then(success).catch((error: unknown) => show({
          title: 'Could not archive photos',
          message: error instanceof Error ? error.message : 'Check that the originals are accessible.',
        }));
      } },
    });
  };
}

export function ArchiveScreen({ revision, scanning, changed, openDuplicates }: {
  revision: number; scanning: boolean; changed: () => void; openDuplicates?: () => void;
}) {
  const show = useDialog();
  const [items, setItems] = useState<ArchivedPhoto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<ArchivedPhoto[]>([]);
  const [preview, setPreview] = useState<ArchivedPhoto | null>(null);
  const [selecting, setSelecting] = useState(false);
  const reduced = useReducedMotion();
  const version = useRef(0);
  const inFlight = useRef(false);

  async function load(offset: number) {
    if (!native || inFlight.current) return;
    const request = version.current;
    inFlight.current = true;
    setLoading(true);
    setError('');
    try {
      const page = await native.archivePage(offset);
      if (version.current !== request) return;
      setItems((value) => offset === 0 ? page : [...value, ...page]);
      setMore(page.length === 40);
    } catch {
      if (version.current === request) setError('Could not read your archive.');
    } finally {
      if (version.current === request) { setLoading(false); inFlight.current = false; }
    }
  }

  useEffect(() => {
    version.current++;
    inFlight.current = false;
    setSelected(new Set());
    setSelecting(false);
    void load(0);
    return () => { version.current++; };
  }, [revision]);

  function toggle(item: ArchivedPhoto) {
    setSelected((existing) => {
      const next = new Set(existing);
      if (next.has(item.id)) next.delete(item.id);
      else if (next.size < 50) next.add(item.id);
      return next;
    });
  }

  async function restore(ids: string[]) {
    setBusy(true);
    try { await native?.restore(ids); changed(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not restore the selection.'); }
    finally { setBusy(false); }
  }

  function deleteConfirmed() {
    if (busy || scanning) return;
    show({
      title: 'Permanently delete these originals?',
      message: `Android will ask you to approve deletion of ${review.length} original photos. Deleted files may be impossible to recover.`,
      action: { label: 'Continue to Android', destructive: true, run: async () => {
        setBusy(true);
        try {
          const result = await native?.deleteArchived(review.map((item) => item.id));
          setReview([]);
          changed();
          if (result?.approved && result.removed !== result.requested) {
            show({ title: 'Deletion could not be fully verified',
              message: `${result.removed} of ${result.requested} deletions were confirmed. Unverified items stay in the archive.` });
          }
        } catch (cause) {
          show({ title: 'Deletion review unavailable',
            message: cause instanceof Error ? cause.message : 'The selection could not be verified.' });
        } finally { setBusy(false); }
      } },
    });
  }

  const selectedItems = items.filter((item) => selected.has(item.id));
  const reviewBytes = review.filter((item) => item.canDelete).reduce((sum, item) => sum + item.bytes, 0);
  function openReview(photos: ArchivedPhoto[]) {
    setPreview(null);
    setReview(photos);
    const ids = photos.filter((item) => item.canDelete).map((item) => item.id);
    if (ids.length) native?.markReviewed(ids).then(changed).catch(() => setError('Could not save the review.'));
  }
  function daysLeft(item: ArchivedPhoto) {
    return Math.max(0, Math.ceil((item.eligible - Date.now()) / 86_400_000));
  }

  return <View style={layout.fill}>
    <PhotoGrid<ArchivedPhoto> desired={2} data={items} keyExtractor={(item) => item.id} extraData={[selecting, selected]}
      onEndReachedThreshold={0.5} onEndReached={() => { if (more) void load(items.length); }}
      ListHeaderComponent={<View style={layout.header}>
        <View style={styles.between}>
          <Heading large>Archive</Heading>
          {!!items.length && <Chip label={selecting ? 'Done' : 'Select'} selected={selecting} run={() => {
            setSelecting(!selecting);
            setSelected(new Set());
          }} />}
        </View>
        <Body>Photos you set aside in Nimby</Body>
        <View style={layout.notice}>
          <View style={layout.noticeIcon}><Icon name="clock" tint={color.blue} /></View>
          <View style={layout.description}>
            <Text style={layout.name}>30 days before deletion review</Text>
            <Body>Your originals stay in the gallery. Restore at any time.</Body>
          </View>
        </View>
        {error !== '' && <ErrorText>{error}</ErrorText>}
      </View>}
      ListFooterComponent={loading ? <ActivityIndicator color={color.blue} /> : error ?
        <Button label="Retry" subtle run={() => void load(items.length)} /> : undefined}
      ListEmptyComponent={!loading && !error ? <EmptyState icon="archive" mascot="organizing" title="Your archive is empty"
        text="Photos archived from Revisit or duplicate review will appear here."
        action={openDuplicates ? <Button label="Review duplicates" icon="layers" subtle run={openDuplicates} /> : undefined} />
        : undefined}
      renderTile={(item) => {
        const days = daysLeft(item);
        const timing = days ? `${days} ${days === 1 ? 'day' : 'days'} until review` : 'Ready for review';
        return <View style={layout.album}>
          <PhotoTile uri={item.uri} label={`${item.name}, ${timing}`} ratio={1.12}
            selected={selecting ? selected.has(item.id) : undefined}
            press={() => selecting ? toggle(item) : setPreview(item)}
            longPress={() => { setSelecting(true); toggle(item); }} />
          <Text style={[layout.timing, !days && layout.ready]}>{timing}</Text>
          <Text style={layout.caption} numberOfLines={1}>{item.album}</Text>
        </View>;
      }} />
    {!!selected.size && <View style={layout.bar}>
      <Text accessibilityLiveRegion="polite" style={layout.name}>{selected.size} selected</Text>
      <View style={styles.row}>
        <Button label="Restore selected" subtle disabled={busy} run={() => void restore([...selected])} />
        <Button label="Review selected" disabled={busy || selectedItems.some((item) => item.eligible > Date.now())}
          run={() => openReview(selectedItems)} />
      </View>
    </View>}
    {preview && <ImageViewer uri={preview.uri} label={preview.name} album={preview.album}
      summary="Archive details" close={() => setPreview(null)}>
      <Heading>{preview.name}</Heading>
      <Body>Archived {new Date(preview.archived).toLocaleDateString()}</Body>
      <Body>{daysLeft(preview) ? `Eligible for deletion review ${new Date(preview.eligible).toLocaleDateString()}.`
        : 'Eligible for deletion review.'}</Body>
      {!preview.uri && <Body>Original unavailable. You can still remove this archive entry by restoring it.</Body>}
      <Button label="Restore" disabled={busy} run={() => { setPreview(null); void restore([preview.id]); }} />
      {!daysLeft(preview) && <Button label="Review for deletion" subtle disabled={busy} run={() => openReview([preview])} />}
    </ImageViewer>}
    <Modal visible={review.length > 0} onRequestClose={() => { if (!busy) setReview([]); }} animationType={reduced ? 'none' : 'fade'} hardwareAccelerated statusBarTranslucent navigationBarTranslucent>
      <SafeAreaView style={layout.shell}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.between}><Heading large>Review deletion</Heading>
            {!busy && <IconButton icon="close" label="Back to archive" run={() => setReview([])} />}
          </View>
          <Body>{review.length} original photos. {reviewBytes ? `Estimated deletable file size ${formatBytes(reviewBytes)}.` : 'File sizes are unavailable.'}</Body>
          <Body>Deleting the originals may be irreversible.</Body>
          {review.map((item) => <View style={layout.selection} key={item.id}>
            <Thumbnail uri={item.uri} style={layout.thumb} />
            <View style={layout.description}><Text style={layout.name}>{item.name}</Text>
              <Body>{item.album} · {item.bytes ? formatBytes(item.bytes) : 'Size unavailable'}</Body></View>
          </View>)}
          {review.some((item) => !item.canDelete) && <Body>An original is unavailable or can only be managed in its source app.</Body>}
          {scanning && <Body>Finish or cancel the active scan before requesting deletion.</Body>}
          <Button label="Permanently delete originals" destructive disabled={busy || scanning || review.some((item) => !item.canDelete)} run={deleteConfirmed} />
          <Button label="Back to archive" subtle disabled={busy} run={() => setReview([])} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </View>;
}

const layout = StyleSheet.create({
  fill: { flex: 1 },
  shell: { flex: 1, backgroundColor: color.paper },
  header: { gap: 12, paddingBottom: 8 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: color.white, borderRadius: 16, padding: 12 },
  noticeIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' },
  album: { gap: 4, paddingBottom: 12 },
  timing: { color: color.ink, fontSize: 13, fontWeight: '600', marginTop: 2 },
  ready: { color: color.blue },
  caption: { color: color.muted, fontSize: 12 },
  selection: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  description: { flex: 1, gap: 3 },
  thumb: { height: 64, width: 64, borderRadius: 10 },
  name: { color: color.ink, fontWeight: '600', fontSize: 14 },
  bar: { paddingHorizontal: 20, paddingVertical: 8, backgroundColor: color.paper, gap: 8 },
});
