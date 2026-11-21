import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { native, type Access, type Album, type Photo } from './gallery';
import { ImageViewer } from './ImageViewer';
import { PhotoGrid, PhotoTile } from './PhotoGrid';
import { Body, Button, Chip, color, EmptyState, ErrorText, Heading, Icon, styles } from './ui';

export function GalleryScreen({ access, albums, loading, error, album, open, manage, settings, pick, scan, revision, revisit }: {
  access: Access; albums: Album[]; loading: boolean; error: string; album: Album | 'recent' | null;
  open: (album: Album | 'recent' | null) => void; manage: () => void; settings: () => void; pick: () => void;
  scan: (albums: string[], uris: string[]) => void; revision: number; revisit: () => void;
}) {
  const [selectedAlbums, setSelectedAlbums] = useState(new Set<string>());
  const [selectedPhotos, setSelectedPhotos] = useState(new Set<string>());
  const [selecting, setSelecting] = useState(false);
  const [allPhotos, setAllPhotos] = useState(false);
  const [preview, setPreview] = useState<Photo | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [pageBusy, setPageBusy] = useState(false);
  const fetchId = useRef(0);
  const fetching = useRef(false);
  const albumId = album && album !== 'recent' ? album.id : null;

  function loadPhotos(cursor: string | null) {
    if (!native || fetching.current) return;
    const id = fetchId.current;
    fetching.current = true;
    setPageBusy(true);
    setPhotoError('');
    native.photos(albumId, cursor).then((page) => {
      if (id !== fetchId.current) return;
      setPhotos((current) => cursor ? current.concat(page.items) : page.items);
      setNext(page.next);
    }).catch(() => {
      if (id === fetchId.current) setPhotoError('These photos are unavailable. Check gallery access and try again.');
    }).finally(() => {
      if (id === fetchId.current) {
        fetching.current = false;
        setPageBusy(false);
      }
    });
  }

  useEffect(() => {
    fetchId.current++;
    fetching.current = false;
    setPhotos([]);
    setNext(null);
    setPageBusy(false);
    setPhotoError('');
    setSelectedPhotos(new Set());
    setSelecting(false);
    setAllPhotos(false);
    setPreview(null);
    if (album && access !== 'none') loadPhotos(null);
    return () => { fetchId.current++; };
  }, [albumId, album === 'recent', access, revision]);

  useEffect(() => {
    setSelectedAlbums(new Set());
    if (!album) setSelecting(false);
  }, [access, revision, album]);

  const available = access !== 'none';
  const screenshotAlbum = albums.find((item) => /^screenshots?$/i.test(item.name));
  const scopeName = album === 'recent' ? 'Recent photos' : album?.name ?? 'Gallery';
  const scopedCount = album && album !== 'recent' ? album.count : albums.reduce((total, item) => total + item.count, 0);

  function toggle(setter: (update: (current: Set<string>) => Set<string>) => void, key: string) {
    setter((current) => {
      const nextSelection = new Set(current);
      if (nextSelection.has(key)) nextSelection.delete(key);
      else nextSelection.add(key);
      return nextSelection;
    });
  }

  function resetSelection() {
    setSelecting(false);
    setSelectedAlbums(new Set());
    setSelectedPhotos(new Set());
    setAllPhotos(false);
  }

  const header = <View style={layout.header}>
    {album && <Pressable accessibilityRole="button" onPress={() => open(null)} style={styles.textAction}>
      <Icon name="back" tint={color.blue} size={17} /><Text style={styles.link}>All albums</Text>
    </Pressable>}
    <View style={styles.between}>
      <View style={layout.title}><Heading large>{scopeName}</Heading>
        {available && !loading && <Body>{scopedCount.toLocaleString()} accessible {scopedCount === 1 ? 'photo' : 'photos'}</Body>}
      </View>
      {available && scopedCount > 0 && <Chip label={selecting ? 'Done' : 'Select'} selected={selecting}
        run={() => selecting ? resetSelection() : setSelecting(true)} />}
    </View>
    {access === 'limited' && <Body>Showing the photos you shared with Android.</Body>}
    {available && !album && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={layout.filters}>
      <Chip label="Recent photos" run={() => open('recent')} />
      {screenshotAlbum && <Chip label="Screenshots" run={() => open(screenshotAlbum)} />}
      <Chip label="Worth Revisiting" run={revisit} />
    </ScrollView>}
    {available && (access === 'limited' || !album) && <View style={styles.row}>
      {access === 'limited' && <Chip label="Change shared photos" run={manage} />}
      {!album && <Chip label="Photo permissions" run={settings} />}
    </View>}
    {available && !selecting && scopedCount > 0 &&
      <Pressable accessibilityRole="button" onPress={() => scan(albumId ? [albumId] : [], [])} style={styles.textAction}>
        <Icon name="scan" tint={color.blue} size={17} />
        <Text style={styles.link}>{albumId ? 'Scan this album' : 'Scan Gallery'}</Text>
      </Pressable>}
    {!!error && <ErrorText>{error}</ErrorText>}
    {!!photoError && <ErrorText>{photoError}</ErrorText>}
  </View>;

  return <View style={layout.fill}>
    {!album || !available ? <PhotoGrid<Album> desired={2} data={available ? albums : []}
      keyExtractor={(item) => item.id} extraData={[selecting, selectedAlbums]} ListHeaderComponent={header}
      ListEmptyComponent={loading ? <ActivityIndicator color={color.blue} /> : !available
        ? <EmptyState icon="gallery" title="Bring your gallery into view" text="Share photos to browse albums, or pick a few to get started."
            action={<View style={styles.row}><Button label="Allow photo access" run={manage} /><Button label="Select Photos" subtle run={pick} />
              <Button label="Worth Revisiting" subtle run={revisit} /></View>} />
        : !error ? <EmptyState icon="gallery" title="No albums here yet" text="Accessible photo albums will appear here." /> : undefined}
      renderTile={(item) => <View style={layout.album}>
        <PhotoTile uri={item.uri} label={`${item.name}, ${item.count} photos`} ratio={1.23}
          selected={selecting ? selectedAlbums.has(item.id) : undefined}
          press={() => selecting ? toggle(setSelectedAlbums, item.id) : open(item)}
          longPress={() => { setSelecting(true); toggle(setSelectedAlbums, item.id); }} />
        <Text style={layout.albumName} numberOfLines={2}>{item.name}</Text>
        <Text style={layout.count}>{item.count.toLocaleString()} {item.count === 1 ? 'photo' : 'photos'}</Text>
      </View>} /> :
      <PhotoGrid<Photo> data={photos} extraData={[selecting, allPhotos, selectedPhotos]} keyExtractor={(item) => item.uri}
        ListHeaderComponent={header} onEndReached={() => { if (next) loadPhotos(next); }} onEndReachedThreshold={0.65}
        ListEmptyComponent={!pageBusy && !photoError ? <EmptyState icon="image" title="No photos in view" text="Try another album or check photo access." /> : undefined}
        ListFooterComponent={pageBusy ? <ActivityIndicator color={color.blue} /> : photoError ?
          <Button label="Retry loading photos" subtle run={() => loadPhotos(next)} /> : undefined}
        renderTile={(item) => <PhotoTile uri={item.uri} label={item.name}
          selected={selecting ? allPhotos || selectedPhotos.has(item.uri) : undefined}
          press={() => selecting ? !allPhotos && toggle(setSelectedPhotos, item.uri) : setPreview(item)}
          longPress={() => { if (!allPhotos) { setSelecting(true); toggle(setSelectedPhotos, item.uri); } }} />} />}
    {available && selecting && <View style={layout.actions}>
      {album ? <>
        {allPhotos && <Button label={`Scan ${scopedCount} accessible photos`} run={() => scan([], [])} />}
        {!allPhotos && selectedPhotos.size > 0 && <Button label={`Scan ${selectedPhotos.size} selected`} run={() => scan([], [...selectedPhotos])} />}
        {album === 'recent' ? <Button label={allPhotos ? 'Clear selection' : 'Select all accessible photos'}
          subtle disabled={scopedCount === 0} run={() => { setAllPhotos(!allPhotos); setSelectedPhotos(new Set()); }} />
          : selectedPhotos.size === 0 && <Button label="Scan this album" subtle disabled={!scopedCount}
              run={() => scan(albumId ? [albumId] : [], [])} />}
      </> : <Button label={`Scan ${selectedAlbums.size} selected ${selectedAlbums.size === 1 ? 'album' : 'albums'}`}
        disabled={!selectedAlbums.size} run={() => scan([...selectedAlbums], [])} />}
    </View>}
    {preview && <ImageViewer uri={preview.uri} album={preview.album} label={preview.name} close={() => setPreview(null)}>
      <Heading>{preview.name}</Heading>
      <Button label="Scan this photo" icon="scan" run={() => { setPreview(null); scan([], [preview.uri]); }} />
    </ImageViewer>}
  </View>;
}

const layout = StyleSheet.create({
  fill: { flex: 1 },
  header: { gap: 10, paddingBottom: 7 },
  title: { flex: 1, gap: 3 },
  filters: { gap: 7 },
  album: { paddingBottom: 12, gap: 2 },
  albumName: { fontSize: 15, fontWeight: '700', color: color.ink, marginTop: 4 },
  count: { fontSize: 12, color: color.muted },
  actions: { paddingHorizontal: 20, paddingVertical: 9, backgroundColor: color.black, gap: 7 },
});
