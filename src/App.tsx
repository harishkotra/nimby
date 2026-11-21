import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Discover, PhotoDetail } from './Discover';
import { HomeDashboard, InsightsScreen } from './Dashboard';
import { DuplicatesScreen } from './DuplicatesScreen';
import { GalleryScreen } from './GalleryScreen';
import { ArchiveScreen } from './ArchiveScreen';
import { SettingsScreen } from './SettingsScreen';
import { native, openSettings, requestGalleryAccess, scanActive, type Access, type Album, type Feed, type Overview, type Result, type Scan } from './gallery';
import { Body, Button, color, ErrorText, Heading, Icon, IconButton, type IconName, styles } from './ui';

type Screen = 'Home' | 'Gallery' | 'Discover' | 'Analysis' | 'Settings' | 'Archive' | 'Insights' | 'Duplicates';
const tabs = [
  { name: 'Home', icon: 'home' }, { name: 'Gallery', icon: 'gallery' },
  { name: 'Insights', icon: 'insights' }, { name: 'Archive', icon: 'archive' },
] as const satisfies readonly { name: Screen; icon: IconName }[];


export default function App() {
  return <SafeAreaProvider>
    <StatusBar barStyle="light-content" />
    <SafeAreaView style={layout.shell}>
      {native ? <Nimby /> : <View style={styles.content}>
        <Heading large>Nimby</Heading>
        <Body>Install the Nimby Android build to access your gallery and run Eye.</Body>
      </View>}
    </SafeAreaView>
  </SafeAreaProvider>;
}

function Nimby() {
  const [screen, setScreen] = useState<Screen>('Home');
  const [access, setAccess] = useState<Access>(() => native!.access());
  const [albums, setAlbums] = useState<Album[]>([]);
  const [album, setAlbum] = useState<Album | 'recent' | null>(null);
  const [loadingAlbums, setLoadingAlbums] = useState(false);
  const [galleryError, setGalleryError] = useState('');
  const [galleryRevision, setGalleryRevision] = useState(0);
  const [revision, setRevision] = useState(0);
  const [recent, setRecent] = useState<Result[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [feed, setFeed] = useState<Feed | 'scan'>('suggestions');
  const [feedCategory, setFeedCategory] = useState<string | null>(null);
  const [reviewScan, setReviewScan] = useState<string | null>(null);
  const reviewBack = useRef<Screen>('Home');
  const backTo = useRef<Screen>('Home');
  const [recentError, setRecentError] = useState(false);
  const [detail, setDetail] = useState<Result | null>(null);
  const [scan, setScan] = useState<Scan>(() => native!.scanStatus());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const albumRequest = useRef(0);
  const navigation = useRef(screen);
  navigation.current = screen;

  function refreshGallery(loadAlbums: boolean) {
    const current = native!.access();
    setAccess(current);
    const request = ++albumRequest.current;
    setGalleryError('');
    if (current === 'none') {
      setAlbums([]);
      setAlbum(null);
      setLoadingAlbums(false);
    } else if (loadAlbums) {
      setLoadingAlbums(true);
      native!.albums().then((items) => {
        if (albumRequest.current !== request) return;
        setAlbums(items);
        setAlbum((previous) => previous === 'recent' ? previous : items.find((item) => item.id === previous?.id) ?? null);
      }).catch(() => {
        if (albumRequest.current !== request) return;
        setAlbums([]);
        setAlbum(null);
        setGalleryError('Albums could not be loaded. Check photo access and try again.');
      }).finally(() => {
        if (albumRequest.current === request) setLoadingAlbums(false);
      });
    }
    return current;
  }

  useEffect(() => {
    const state = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        refreshGallery(navigation.current === 'Gallery');
        setGalleryRevision((value) => value + 1);
        setRevision((value) => value + 1);
      }
    });
    let previousScan = native!.scanStatus();
    const timer = setInterval(() => {
      const status = native!.scanStatus();
      if (JSON.stringify(status) !== JSON.stringify(previousScan)) {
        setScan(status);
        if (!scanActive(status)) setRevision((value) => value + 1);
      }
      previousScan = status;
    }, 375);
    return () => {
      state.remove();
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'Gallery' && album) {
        setAlbum(null);
        return true;
      }
      if (screen === 'Home') return false;
      goBack();
      return true;
    });
    return () => back.remove();
  }, [screen, album, feedCategory, feed]);

  useEffect(() => {
    if (screen !== 'Home') return;
    let live = true;
    setRecentError(false);
    native!.feed('recent', null, 0, 5).then((latest) => {
      if (live) setRecent(latest);
    }).catch(() => {
      if (live) setRecentError(true);
    });
    return () => { live = false; };
  }, [revision, screen]);

  useEffect(() => {
    if (screen !== 'Home' && screen !== 'Insights') return;
    let live = true;
    setOverviewError(false);
    native!.overview().then((value) => { if (live) setOverview(value); })
      .catch(() => { if (live) setOverviewError(true); });
    return () => { live = false; };
  }, [screen, revision]);

  function start(albumsToScan: string[], uris: string[]) {
    if (scanActive(native!.scanStatus())) {
      navigate('Analysis');
      return;
    }
    try {
      native!.startScan(albumsToScan, uris);
      setScan(native!.scanStatus());
      navigate('Analysis');
    } catch (error) {
      Alert.alert('Could not start scan', error instanceof Error ? error.message : 'Try again in a moment.');
    }
  }

  function control(action: 'pause' | 'resume' | 'cancel') {
    native!.controlScan(action);
    setScan(native!.scanStatus());
    if (action === 'cancel') setRevision((value) => value + 1);
  }

  async function galleryAction(action: 'scan' | 'browse' | 'manage') {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      let current = native!.access();
      if (current === 'none' || action === 'manage') {
        const result = await requestGalleryAccess();
        current = result.access;
        if (current === 'none' && result.settings) {
          Alert.alert('Photo access is off', 'You can allow access in Settings or select photos manually.',
            [{ text: 'OK' }, { text: 'Open Settings', onPress: showSettings }]);
        }
      }
      setGalleryRevision((value) => value + 1);
      if (action === 'scan' && current !== 'none') {
        setAccess(current);
        start([], []);
      } else {
        navigate('Gallery');
        refreshGallery(true);
      }
    } catch {
      setScreen('Gallery');
      refreshGallery(true);
      setGalleryError('Android could not update photo permissions.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function showSettings() {
    void openSettings().catch(() => Alert.alert('Settings unavailable', 'Open Nimby’s app permissions in Android Settings.'));
  }

  async function pick() {
    if (busyRef.current) return;
    if (scanActive(native!.scanStatus())) {
      setScreen('Analysis');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const uris = await native!.pickPhotos();
      if (uris.length) start([], uris);
    } catch {
      Alert.alert('Could not select photos', 'Android’s photo picker was unavailable. Try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function navigate(destination: Screen) {
    if (['Home', 'Gallery', 'Insights', 'Archive'].includes(screen)) backTo.current = screen;
    if (destination === 'Gallery' && screen !== 'Gallery') refreshGallery(true);
    setScreen(destination);
  }

  function goBack() {
    if (screen === 'Discover') {
      if (feedCategory) setFeedCategory(null);
      else if (feed === 'kept' || feed === 'dismissed') setFeed('suggestions');
      else navigate(reviewBack.current);
    } else if (screen === 'Analysis' || screen === 'Settings' || screen === 'Duplicates') {
      navigate(backTo.current);
    } else {
      navigate('Home');
    }
  }

  function openReview(mode: Feed | 'scan', category: string | null = null, scanId: string | null = null) {
    if (screen !== 'Discover') reviewBack.current = screen;
    setFeed(mode);
    setFeedCategory(category);
    setReviewScan(scanId);
    navigate('Discover');
  }

  function changed() {
    setRevision((value) => value + 1);
  }

  const links = {
    gallery: () => void galleryAction('browse'),
    duplicates: () => navigate('Duplicates'),
    archive: () => navigate('Archive'),
    discover: openReview,
  };

  const primary = tabs.some((tab) => tab.name === screen);
  const selectedTab = screen === 'Duplicates' ? 'Insights' : primary ? screen : backTo.current;

  return <>
    <View style={layout.top}>
      {primary
        ? <Pressable accessibilityRole="button" accessibilityLabel="Nimby Home" onPress={() => navigate('Home')} style={layout.brand}>
            <Text style={layout.wordmark}>nimby<Text style={layout.wordmarkDot}>.</Text></Text>
          </Pressable>
        : <IconButton icon="back" label="Go back" run={goBack} style={layout.headerButton} />}
      <View style={layout.headerActions}>
        {scan.phase !== 'idle' && screen !== 'Analysis' && <Pressable accessibilityRole="button"
          accessibilityLabel={scanActive(scan) ? 'View active scan' : 'View latest scan'} onPress={() => navigate('Analysis')}
          style={({ pressed }) => [layout.scanShortcut, pressed && styles.faded]}>
          {scanActive(scan) && <View style={layout.liveDot} />}
          <Icon name={scanActive(scan) ? 'scan' : 'clock'} size={20} tint={scanActive(scan) ? color.blue : color.muted} />
        </Pressable>}
        {screen === 'Home' && <IconButton icon="settings" label="Settings" run={() => navigate('Settings')} style={layout.headerButton} />}
      </View>
    </View>
    <View style={layout.main}>
      {screen === 'Home' && <HomeDashboard {...links} data={overview} error={overviewError} busy={busy}
        scan={() => void galleryAction('scan')} pick={() => void pick()} previews={recent} recentError={recentError}
        openPhoto={setDetail} openScan={(id) => openReview('scan', null, id)} />}
      {screen === 'Gallery' && <GalleryScreen access={access} albums={albums} loading={loadingAlbums} error={galleryError}
        album={album} open={setAlbum} manage={() => void galleryAction('manage')} settings={showSettings}
        pick={() => void pick()} scan={start} revision={galleryRevision} revisit={() => links.discover('suggestions')} />}
      {screen === 'Discover' && <Discover key={JSON.stringify([feed, reviewScan])} mode={feed}
        category={feedCategory} scanId={reviewScan} revision={revision} open={setDetail} changed={changed}
        openCategory={setFeedCategory} openMode={openReview} />}
      {screen === 'Insights' && <InsightsScreen {...links} data={overview} error={overviewError} />}
      {screen === 'Duplicates' && <DuplicatesScreen revision={revision} changed={() => setRevision((value) => value + 1)} />}
      {screen === 'Analysis' && <AnalysisScreen scan={scan} access={access} control={control}
        results={(id) => openReview('scan', null, id)} done={goBack} />}
      {screen === 'Settings' && <SettingsScreen access={access} scan={scan} revision={revision}
        changed={changed} openPermissionSettings={showSettings} openArchive={() => navigate('Archive')}
        openScan={(id) => openReview('scan', null, id)}
        onResume={() => { setScan(native!.scanStatus()); navigate('Analysis'); }} />}
      {screen === 'Archive' && <ArchiveScreen revision={revision} scanning={scanActive(scan)} changed={() => setRevision((value) => value + 1)} />}
    </View>
    <View style={layout.nav}>
      {tabs.map(({ name, icon }) => {
        const active = selectedTab === name;
        return <Pressable key={name} accessibilityRole="tab" accessibilityLabel={name}
          accessibilityState={{ selected: active }} onPress={() => navigate(name)}
          style={({ pressed }) => [layout.navItem, pressed && styles.faded]}>
          <View style={[layout.navIcon, active && layout.navActive]}>
            <Icon name={icon} size={21} tint={active ? color.blue : color.muted} />
          </View>
          <Text style={[layout.navText, active && layout.navTextActive]}>{name}</Text>
        </Pressable>;
      })}
    </View>
    {detail && <PhotoDetail key={detail.id} item={detail} close={() => setDetail(null)} open={setDetail}
      changed={() => setRevision((value) => value + 1)} />}
  </>;
}

function AnalysisScreen({ scan, access, control, results, done }: {
  scan: Scan; access: Access; control: (action: 'pause' | 'resume' | 'cancel') => void;
  results: (id: string) => void; done: () => void;
}) {
  const title = {
    idle: 'Ready to scan', preparing: 'Preparing Eye', running: 'Analyzing photos', paused: 'Scan paused', matching: 'Checking for duplicates',
    complete: !scan.total ? 'No accessible photos' : scan.failed === scan.total ? 'No photos analyzed' : 'Scan complete',
    cancelled: 'Scan cancelled', blocked: 'Scan stopped',
  }[scan.phase];
  const progress = scan.total ? Math.min(100, Math.floor(scan.processed / scan.total * 100)) : 0;
  return <ScrollView contentContainerStyle={styles.content}>
    <Heading large>{title}</Heading>
    {access === 'limited' && <Body>Gallery scans use the photos you shared with Nimby through Android.</Body>}
    {scan.phase === 'preparing' && <Body>Nimby is checking your selection and getting the on-device Eye model ready.</Body>}
    {scan.phase === 'paused' && <Body>Nimby pauses between photos. Resume to continue this scan.</Body>}
    {scan.phase === 'complete' && !scan.total && <Body>Choose another album, update photo access, or select photos manually.</Body>}
    {scan.phase === 'cancelled' && <Body>Photos Nimby already analyzed are saved.</Body>}
    <View style={layout.progressCard}>
      <Text accessibilityLiveRegion="polite" style={layout.progressNumber}>
        {scan.processed.toLocaleString()} / {scan.total.toLocaleString()}
      </Text>
      <Body>Photos processed</Body>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }}
        style={layout.track}><View style={[layout.progress, { width: `${progress}%` }]} /></View>
      <Body>{scan.analyzed} newly analyzed · {scan.cached} cached · {scan.failed} failed</Body>
    </View>
    <View style={styles.row}>
      {scanActive(scan) ? <>
        {scan.phase !== 'matching' && <Button label={scan.phase === 'paused' ? 'Resume' : 'Pause'} run={() => control(scan.phase === 'paused' ? 'resume' : 'pause')} />}
        <Button label="Cancel scan" subtle run={() => control('cancel')} />
      </> : scan.resultId && scan.analyzed + scan.cached > 0
        ? <Button label="Review scan results" icon="gallery" run={() => results(scan.resultId!)} />
        : <Button label="Done" run={done} />}
    </View>
    {!!scan.problem && <ErrorText>{scan.problem}</ErrorText>}
    {scan.errors.length > 0 && <View style={styles.column}>
      <Heading>Recent errors</Heading>
      {scan.errors.map((error, index) => <ErrorText key={`${index}-${error}`}>{error}</ErrorText>)}
    </View>}
  </ScrollView>;
}

const layout = StyleSheet.create({
  shell: { flex: 1, backgroundColor: color.paper },
  main: { flex: 1 },
  top: { minHeight: 49, paddingHorizontal: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  brand: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 5 },
  wordmark: { color: color.ink, fontFamily: 'sans-serif-black', fontSize: 28, letterSpacing: -1.6 },
  wordmarkDot: { color: color.blue },
  headerActions: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  headerButton: { backgroundColor: 'transparent' },
  scanShortcut: { minHeight: 48, minWidth: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  liveDot: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: color.blue, top: 8, right: 10 },
  nav: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 5, gap: 3, backgroundColor: color.black },
  navItem: { flex: 1, minHeight: 53, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 1, gap: 2 },
  navIcon: { minWidth: 48, height: 31, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  navActive: { backgroundColor: color.tint },
  navText: { color: color.muted, fontWeight: '600', fontSize: 11, textAlign: 'center' },
  navTextActive: { color: color.blue },
  progressCard: { backgroundColor: color.white, borderWidth: 1, borderColor: color.rule, borderRadius: 18, padding: 20, gap: 8 },
  progressNumber: { color: color.ink, fontFamily: 'serif', fontSize: 34 },
  track: { height: 10, borderRadius: 20, backgroundColor: color.tint, overflow: 'hidden', marginVertical: 7 },
  progress: { height: '100%', backgroundColor: color.blue, borderRadius: 20 },
});
