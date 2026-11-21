import { ActionMenu } from './ActionSheet';
import { requireNativeView } from 'expo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Linking, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import { native as gallery, type MapBounds, type MapPage, type PhotoLocationStatus, type Result } from './gallery';
import { ActionLink, Body, Button, color, ErrorText, Heading, Icon, styles, Thumbnail } from './ui';
import { useDialog } from './Dialogs';

type Viewport = MapBounds & { zoom: number };
type Cluster = { id: string; count: number; lat: number; lon: number };
type MapPhoto = MapPage['photos'][number];
type MapViewProps = ViewProps & {
  points: string;
  fit?: string;
  onViewport: (event: NativeSyntheticEvent<Viewport>) => void;
  onCluster: (event: NativeSyntheticEvent<{ id: string }>) => void;
  onMapError: (event: NativeSyntheticEvent<{ message: string }>) => void;
};
type TimeFilter = 'all' | 'year' | 'month';
type ListScope = { id: string | null; viewport: Viewport };
const world: Viewport = { south: -90, west: -180, north: 90, east: 180, zoom: 0 };
const allTime: readonly [number | null, number | null] = [null, null];
const allPhotos: ListScope = { id: null, viewport: world };

function filterRange(filter: TimeFilter): readonly [number | null, number | null] {
  if (filter === 'all') return allTime;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (filter === 'month') start.setDate(start.getDate() - 29);
  else start.setMonth(0, 1);
  return [start.getTime(), null];
}

function boundsArgs(bounds: Viewport, range: readonly [number | null, number | null]) {
  return [bounds.south, bounds.west, bounds.north, bounds.east, bounds.zoom, ...range] as const;
}

export function PhotoMapScreen({ revision, open }: { revision: number; open: (photo: Result) => void }) {
  const MapView = useMemo(() => requireNativeView<MapViewProps>('NimbyPhotoMap'), []);
  const show = useDialog();
  const [status, setStatus] = useState<PhotoLocationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [mapError, setMapError] = useState('');
  const [queryError, setQueryError] = useState('');
  const [listError, setListError] = useState('');
  const [filter, setFilter] = useState<TimeFilter>('all');
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const clusterViewport = useRef<Viewport>(world);
  const [coveredCount, setCoveredCount] = useState(0);
  const [fit, setFit] = useState<string>();
  const [ready, setReady] = useState(false);
  const firstBounds = useRef(false);
  const [scope, setScope] = useState<ListScope | null>(null);
  const [photos, setPhotos] = useState<MapPhoto[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [morePending, setMorePending] = useState(false);
  const listRequest = useRef(0);
  const pagePending = useRef(false);
  const [retry, setRetry] = useState(0);
  const range = useMemo(() => filterRange(filter), [filter]);
  const active = !!status?.enabled && !!status.permission;
  const geoJson = useMemo(() => JSON.stringify({ type: 'FeatureCollection', features: active ? clusters.map((point) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [point.lon, Math.max(-85.05112878, Math.min(85.05112878, point.lat))] },
    properties: { clusterId: point.id, count: point.count },
  })) : [] }), [active, clusters]);

  async function readStatus() {
    if (!gallery?.photoLocationStatus) throw new Error('Install the current Nimby Android build to use Photo Map.');
    return gallery.photoLocationStatus();
  }

  useEffect(() => {
    let current = true;
    let request = 0;
    const load = () => {
      const loadId = ++request;
      void readStatus().then((value) => {
        if (current && loadId === request) {
          setStatus(value);
          setStatusError('');
        }
      }).catch((error: unknown) => {
        if (current && loadId === request) {
          setStatus(null);
          setStatusError(error instanceof Error ? error.message : 'Could not read photo locations.');
        }
      });
    };
    load();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
      else {
        request++;
        setStatus(null);
      }
    });
    const timer = status?.running || status?.pending ? setInterval(load, 1500) : undefined;
    return () => {
      current = false;
      listener.remove();
      if (timer) clearInterval(timer);
    };
  }, [revision, retry, status?.running, status?.pending]);

  useEffect(() => {
    if (!active || !gallery || scope) return;
    let current = true;
    setQueryError('');
    const requested = viewport ?? world;
    void gallery.mapPhotoClusters(...boundsArgs(requested, range)).then((result) => {
      if (!current) return;
      clusterViewport.current = requested;
      setClusters(result.clusters);
      if (viewport == null) setCoveredCount(result.total);
      if (!firstBounds.current && result.bounds) {
        firstBounds.current = true;
        setFit(JSON.stringify(result.bounds));
      }
      setReady(true);
    }).catch(() => {
      if (current) setQueryError('Could not show locations. Refresh the map and try again.');
    });
    return () => { current = false; };
  }, [active, viewport, range, revision, status?.mapped, scope, retry]);

  async function loadPage(currentScope: ListScope, offset: number) {
    if (!gallery || pagePending.current) return;
    const request = listRequest.current;
    pagePending.current = true;
    setMorePending(true);
    setListError('');
    try {
      const { south, west, north, east, zoom } = currentScope.viewport;
      const page = await gallery.mapPhotoPage([south, west, north, east], zoom, ...range, currentScope.id, offset);
      if (request !== listRequest.current) return;
      setPhotos((current) => offset === 0 ? page.photos : [...current, ...page.photos]);
      setNext(page.nextOffset);
    } catch {
      if (request === listRequest.current) setListError('Could not load photos for this view.');
    } finally {
      if (request === listRequest.current) {
        setMorePending(false);
        pagePending.current = false;
      }
    }
  }

  useEffect(() => {
    listRequest.current++;
    pagePending.current = false;
    setPhotos([]);
    setMorePending(false);
    setNext(null);
    setListError('');
    if (active && scope) void loadPage(scope, 0);
    return () => { listRequest.current++; };
  }, [active, scope, range, revision, status?.mapped, retry]);

  function resetView() {
    firstBounds.current = false;
    setReady(false);
    setViewport(null);
    setFit(undefined);
    setClusters([]);
    setCoveredCount(0);
  }

  async function enable() {
    if (!gallery || busy) return;
    setBusy(true);
    setStatusError('');
    try {
      if (Platform.OS === 'android' && Number(Platform.Version) >= 29) {
        const permission = 'android.permission.ACCESS_MEDIA_LOCATION' as Parameters<typeof PermissionsAndroid.request>[0];
        const granted = await PermissionsAndroid.request(permission);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          setStatusError('Allow access to photo locations to map your photos.');
          return;
        }
      }
      await gallery.setPhotoLocationsEnabled(true);
      resetView();
      setRetry((value) => value + 1);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Could not enable photo locations.');
    } finally {
      setBusy(false);
    }
  }

  function confirmClear() {
    show({ title: 'Clear photo locations?', message: 'Nimby will remove the coordinates it saved and turn off location indexing. Your photos and their analysis stay in place.',
      action: { label: 'Clear locations', destructive: true, run: async () => {
        setBusy(true);
        try {
          await gallery?.clearPhotoLocations();
          setStatus(null);
          setScope(null);
          resetView();
          setRetry((value) => value + 1);
        } catch (error) {
          setStatusError(error instanceof Error ? error.message : 'Could not clear photo locations.');
        } finally {
          setBusy(false);
        }
      } },
    });
  }

  function setTime(value: TimeFilter) {
    if (value === filter) return;
    if (scope?.id) setScope(allPhotos);
    resetView();
    setFilter(value);
  }

  function handleViewport(nextViewport: Viewport) {
    if (!ready) return;
    setViewport((current) => {
      if (current && Object.keys(nextViewport).every((key) => {
        const field = key as keyof Viewport;
        return Math.abs(current[field] - nextViewport[field]) < 0.0001;
      })) return current;
      return nextViewport;
    });
  }

  return <View style={layout.screen}>
    <View style={layout.header}>
      <View style={styles.between}>
        <Heading large>Photo map</Heading>
        {active && <ActionMenu title="Photo map options" label="Map options" overflow options={[
          { label: scope ? 'Show map' : 'Show photo list', run: () => setScope(scope ? null : allPhotos) },
          ...((status.mapped > 0 || coveredCount > 0) ? [{ label: 'Clear locations', danger: true, run: confirmClear }] : []),
        ]} />}
      </View>
      {active ? <ActionMenu title="Photo dates" label={filter === 'all' ? 'Any date' : filter === 'year' ? 'This year' : 'Past 30 days'}
        options={[
          { label: 'Any date', selected: filter === 'all', run: () => setTime('all') },
          { label: 'This year', selected: filter === 'year', run: () => setTime('year') },
          { label: 'Past 30 days', selected: filter === 'month', run: () => setTime('month') },
        ]} /> : <Body>See places saved in your photos. Locations stay on this phone.</Body>}
      {statusError ? <ErrorText>{statusError}</ErrorText> : null}
    </View>
    {!active && status ? <View style={layout.emptyCard}>
      <Heading>No locations yet</Heading>
      <Body>Turn on photo locations to plot GPS from your gallery. You can clear them any time from this screen.</Body>
    </View> : null}
    {active && scope ? <FlatList style={layout.content} contentContainerStyle={layout.list}
      data={photos} keyExtractor={(item) => item.sourceKey ?? item.uri ?? item.id}
      ListHeaderComponent={<View style={layout.listHeader}><Heading>{scope.id ? 'Photos in this area' : 'Photos with locations'}</Heading>
        {scope.id && <ActionLink label="Show all mapped photos" run={() => setScope(allPhotos)} />}
      </View>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={item.name} onPress={() => open(item)}
        style={({ pressed }) => [layout.photoRow, pressed && styles.faded]}>
        <Thumbnail uri={item.uri} style={layout.thumbnail} />
        <View style={layout.photoText}><Text numberOfLines={2} style={layout.photoName}>{item.name}</Text>
          <Body>{item.captured ? new Date(item.captured).toLocaleDateString() : item.album || 'Date unavailable'}</Body></View>
        <Icon name="chevron" size={20} tint={color.muted} />
      </Pressable>}
      ListEmptyComponent={morePending || listError ? undefined : <Body>No photos with locations match this view.</Body>}
      ListFooterComponent={morePending ? <ActivityIndicator color={color.blue} /> : listError
        ? <ErrorText>{listError}</ErrorText> : next !== null ? <Button label="Load more" subtle run={() => void loadPage(scope, next)} /> : undefined}
      onEndReached={() => { if (next !== null && !listError) void loadPage(scope, next); }} onEndReachedThreshold={0.4}
    /> : <View style={layout.content}>
      {mapError ? <View style={layout.message}>
        <ErrorText>{mapError}</ErrorText>
        <Button label="Retry map" subtle run={() => setMapError('')} />
      </View> : <MapView style={layout.content} points={geoJson} fit={active ? fit : undefined}
        importantForAccessibility="no-hide-descendants"
        onViewport={({ nativeEvent }) => { if (active && nativeEvent) handleViewport(nativeEvent); }}
        onCluster={({ nativeEvent }) => {
          if (active && clusters.some((item) => item.id === nativeEvent.id)) setScope({ id: nativeEvent.id, viewport: clusterViewport.current });
        }} onMapError={({ nativeEvent }) => setMapError(nativeEvent.message)} />}
      <Pressable accessibilityRole="link" accessibilityLabel="OpenStreetMap contributors and license" style={layout.attribution}
        onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright').catch(() => {})}>
        <Text style={layout.attributionText}>© OpenStreetMap contributors</Text>
      </Pressable>
    </View>}
    <View style={layout.footer}>
      {queryError && active ? <View style={styles.row}><ErrorText>{queryError}</ErrorText>
        <Button label="Refresh locations" subtle run={() => setRetry((value) => value + 1)} /></View> : null}
      {!active ? status ? <View style={layout.emptyFooter}>
        <Body>Nimby can read GPS from photos you allow. Coordinates stay on this phone.</Body>
        <Button label="Enable photo locations" disabled={busy} run={() => void enable()} />
      </View> : statusError ? <Button label="Retry" subtle run={() => setRetry((value) => value + 1)} />
        : <ActivityIndicator color={color.blue} /> : <View style={styles.between}>
        <Body>{status.running || status.pending ? 'Reading photo locations…'
          : ready && coveredCount === 0 ? 'No accessible photos with GPS match these dates'
          : !scope && ready && clusters.length === 0 ? 'No mapped photos in this view'
          : `${coveredCount.toLocaleString()} ${coveredCount === 1 ? 'photo' : 'photos'} with locations`}</Body>
      </View>}
    </View>
  </View>;
}

const layout = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 8 },
  content: { flex: 1, backgroundColor: '#142128' },
  message: { padding: 20, gap: 12 },
  list: { padding: 16, gap: 8 },
  listHeader: { paddingBottom: 8, gap: 8 },
  photoRow: { padding: 8, borderRadius: 12, backgroundColor: color.white, flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumbnail: { width: 52, height: 52, borderRadius: 8 },
  photoText: { flex: 1, gap: 4 },
  photoName: { color: color.ink, fontSize: 15, fontWeight: '600' },
  attribution: { position: 'absolute', bottom: 4, right: 8, minHeight: 48, justifyContent: 'flex-end' },
  attributionText: { padding: 4, color: color.lightText, backgroundColor: color.paper, fontSize: 11 },
  footer: { paddingHorizontal: 20, paddingVertical: 8, paddingBottom: 16, borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.rule, gap: 8 },
  emptyFooter: { gap: 10 },
  emptyCard: { marginHorizontal: 20, marginBottom: 12, padding: 16, borderRadius: 16, backgroundColor: color.white, gap: 6 },
});
