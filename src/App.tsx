import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, Linking, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { DialogProvider, useDialog } from './Dialogs';
import { ActionSheet } from './ActionSheet';
import { BottomTabs } from './BottomTabs';
import { Discover, PhotoDetail, Revisit } from './Discover';
import { ExploreScreen, HomeDashboard, InsightsScreen } from './Dashboard';
import { DuplicatesScreen } from './DuplicatesScreen';
import { GalleryScreen } from './GalleryScreen';
import { LaunchSplash } from './LaunchSplash';
import { ArchiveScreen } from './ArchiveScreen';
import { SettingsScreen } from './SettingsScreen';
import { LegalDocumentScreen } from './LegalDocumentScreen';
import type { LegalDocumentId } from './legalDocuments';
import { useLifetimeLicense } from './LicenseSettings';
import { RecallScreen } from './RecallScreen';
import { PhotoMapScreen } from './PhotoMapScreen';
import { ConnectScreen } from './ConnectScreen';
import { parseCorrections } from './connectTimeline';
import { PatternsScreen } from './PatternsScreen';
import { ParallelScreen, type ParallelChoice } from './ParallelScreen';
import { EvolveScreen } from './EvolveScreen';
import { NextStepsScreen } from './NextStepsScreen';
import type { NextStepPhoto } from './nextStepFacts';
import { appendChoice, photoFeedbackScores, preferredActions, readEvolveState } from './evolve';
import { applyRecallFeedback } from './recallFeedback';
import type { RecallSearch } from './recallQuery';
import { native, openSettings, requestGalleryAccess, scanActive, type Access, type Album, type Feed, type Overview, type Result, type Scan } from './gallery';
import { NimbyMascot, mascotForScan } from './NimbyMascot';
import { ActionLink, Body, Button, color, ErrorText, Heading, Icon, IconButton, type IconName, styles } from './ui';

type Screen = 'Home' | 'Revisit' | 'Gallery' | 'Discover' | 'Analysis' | 'Settings' | 'Archive' | 'Explore' | 'Insights' | 'Duplicates'
  | 'Recall' | 'PhotoMap' | 'Connect' | 'Patterns' | 'Parallel' | 'Evolve' | 'NextSteps' | LegalDocumentId;
const tabs = [
  { name: 'Home', icon: 'home', label: 'Home' }, { name: 'Recall', icon: 'search', label: 'Search' },
  { name: 'Explore', icon: 'map', label: 'Explore' },
  { name: 'Archive', icon: 'archive', label: 'Archive' },
] as const satisfies readonly { name: Screen; icon: IconName; label: string }[];

const loadCandidates = (start: number, end: number) => native!.personalCandidates(start, end);
const loadTimelineCandidates = (start: number, end: number) => native!.timelineCandidates?.(start, end) ?? loadCandidates(start, end);
const loadCorrections = () => native!.readPersonal('connect');
const saveCorrections = (data: string) => native!.savePersonal('connect', data);
const loadPatterns = () => native!.readPersonal('patterns');
const savePatterns = (data: string) => native!.savePersonal('patterns', data);
const loadConfirmedGroups = async () => parseCorrections(await loadCorrections()).groups
  .filter((group) => group.title.trim())
  .map((group) => ({ title: group.title, photoIds: group.members }));
const loadEvolve = () => native!.readPersonal('evolve');
const saveEvolve = (data: string) => native!.savePersonal('evolve', data);
const resetCorrections = (section: 'connect' | 'patterns') => native!.savePersonal(section, null);
const saveChoice = async (choice: ParallelChoice) => {
  await saveEvolve(JSON.stringify(appendChoice(readEvolveState(await loadEvolve()), choice)));
};
const searchWithFeedback: RecallSearch = async (request, offset) => {
  const { terms, category, date, place, placeHint, textOnly, source } = request;
  const start = date?.start ?? null;
  const end = date?.end ?? null;
  const hits = native!.searchRecall ?
    native!.searchRecall({ terms, category, start, end, month: date?.month ?? null, place, ...(placeHint && { placeHint }), textOnly, source: source ?? null }, offset) :
    native!.searchMemory(terms, category, start, end, place, null, textOnly, offset);
  const [page, state] = await Promise.all([hits, loadEvolve().catch(() => null)]);
  return applyRecallFeedback(page, terms, photoFeedbackScores(readEvolveState(state)));
};

export default function App() {
  const [showLaunch, setShowLaunch] = useState(true);
  const finishLaunch = useCallback(() => setShowLaunch(false), []);
  return <View style={layout.shell}>
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={layout.shell}>
        {native ? <DialogProvider><Nimby /></DialogProvider> : <View style={styles.content}>
          <Heading large>Nimby</Heading>
          <Body>Install the Nimby Android build to access your gallery and run Eye.</Body>
        </View>}
      </SafeAreaView>
    </SafeAreaProvider>
    {native && showLaunch && <LaunchSplash onFinish={finishLaunch} />}
  </View>;
}

function Nimby() {
  const show = useDialog();
  const license = useLifetimeLicense();
  const [screen, setScreen] = useState<Screen>('Home');
  const [searchVisited, setSearchVisited] = useState(false);
  const [access, setAccess] = useState<Access>(() => native!.access());
  const [albums, setAlbums] = useState<Album[]>([]);
  const [album, setAlbum] = useState<Album | 'recent' | null>(null);
  const [loadingAlbums, setLoadingAlbums] = useState(false);
  const [galleryError, setGalleryError] = useState('');
  const [galleryRevision, setGalleryRevision] = useState(0);
  const [revision, setRevision] = useState(0);
  const [preferred, setPreferred] = useState<string[]>([]);
  const [recent, setRecent] = useState<Result[]>([]);
  const [discovery, setDiscovery] = useState<Result | null>(null);
  const [discoveryDay, setDiscoveryDay] = useState(() => new Date().toDateString());
  const [nextStep, setNextStep] = useState<NextStepPhoto | null>(null);
  const [nextStepTarget, setNextStepTarget] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [feed, setFeed] = useState<Feed | 'scan'>('suggestions');
  const [feedCategory, setFeedCategory] = useState<string | null>(null);
  const [reviewScan, setReviewScan] = useState<string | null>(null);
  const reviewBack = useRef<Screen>('Home');
  const analysisBack = useRef<Screen>('Home');
  const [browseReferences, setBrowseReferences] = useState(false);
  const backTo = useRef<Screen>('Home');
  const [recentError, setRecentError] = useState(false);
  const [detail, setDetail] = useState<Result | null>(null);
  const [scan, setScan] = useState<Scan>(() => native!.scanStatus());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const scanStartPending = useRef(false);
  const albumRequest = useRef(0);
  const navigation = useRef(screen);
  navigation.current = screen;

  useEffect(() => {
    let active = true;
    function openNotification(url: string | null | undefined) {
      const id = url?.match(/^nimby:\/\/next-steps\/(\d+)$/)?.[1];
      if (!active || !id) return;
      if (tabs.some((tab) => tab.name === navigation.current)) backTo.current = navigation.current;
      Keyboard.dismiss();
      setDetail(null);
      setNextStepTarget(id);
      setScreen('NextSteps');
    }
    const subscription = Linking.addEventListener('url', ({ url }) => openNotification(url));
    void Linking.getInitialURL().then(openNotification).catch(() => {});
    return () => { active = false; subscription.remove(); };
  }, []);

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
    if (screen !== 'Parallel' || !license.premium) return;
    let current = true;
    void loadEvolve().then((state) => {
      if (current) setPreferred(preferredActions(readEvolveState(state)));
    }).catch(() => { if (current) setPreferred([]); });
    return () => { current = false; };
  }, [screen, revision, license.premium]);

  useEffect(() => {
    const state = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        setDiscoveryDay(new Date().toDateString());
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
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const timer = setTimeout(() => setDiscoveryDay(new Date().toDateString()), midnight.getTime() - Date.now() + 1000);
    return () => clearTimeout(timer);
  }, [discoveryDay]);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
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
    (native!.dailyDiscoveries?.() ?? native!.revisitPicks([])).then((picks) => {
      if (live) setDiscovery(picks.find((item) => item.uri) ?? null);
    }).catch(() => { if (live) setDiscovery(null); });
    native!.nextSteps?.(null).then((items) => {
      if (!live) return;
      setNextStep(items.find((item) => item.state === 'delivered') ?? items.find((item) => !item.state) ?? null);
    }).catch(() => { if (live) setNextStep(null); });
    return () => { live = false; };
  }, [discoveryDay, revision, screen]);

  const needsOverview = screen === 'Home' || screen === 'Insights' || screen === 'Recall';
  useEffect(() => {
    if (!needsOverview) return;
    let live = true;
    setOverviewError(false);
    native!.overview().then((value) => { if (live) setOverview(value); })
      .catch(() => { if (live) setOverviewError(true); });
    return () => { live = false; };
  }, [needsOverview, revision]);

  async function start(albumsToScan: string[], uris: string[]) {
    const currentScan = native!.scanStatus();
    if (scanActive(currentScan) && !currentScan.automatic) {
      navigate('Analysis');
      return;
    }
    if (scanStartPending.current) return;
    scanStartPending.current = true;
    try {
      await native!.startScan(albumsToScan, uris);
      setScan(native!.scanStatus());
      navigate('Analysis');
    } catch (error) {
      show({ title: 'Could not start scan', message: error instanceof Error ? error.message : 'Try again in a moment.' });
    } finally {
      scanStartPending.current = false;
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
          show({ title: 'Photo access is off', message: 'Allow access in Android settings or pick individual photos from Home.',
            action: { label: 'Open Android settings', run: showSettings } });
        }
      }
      setGalleryRevision((value) => value + 1);
      if (action === 'scan' && current !== 'none') {
        setAccess(current);
        await start([], []);
      } else {
        if (action === 'browse') setAlbum(null);
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
    void openSettings().catch(() => show({ title: 'Settings unavailable', message: 'Open Nimby’s app permissions in Android settings.' }));
  }

  async function pick() {
    if (busyRef.current) return;
    const currentScan = native!.scanStatus();
    if (scanActive(currentScan) && !currentScan.automatic) {
      navigate('Analysis');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const uris = await native!.pickPhotos();
      if (uris.length) await start([], uris);
    } catch {
      show({ title: 'Could not select photos', message: 'Android’s photo picker was unavailable. Try again.' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function navigate(requested: Screen) {
    const destination = (requested === 'Parallel' || requested === 'Evolve') && !license.premium ? 'Settings' : requested;
    if (destination === screen) return;
    if (destination === 'Recall') setSearchVisited(true);
    if (screen === 'Recall') Keyboard.dismiss();
    if (tabs.some((tab) => tab.name === screen)) backTo.current = screen;
    if (destination === 'Analysis' && screen !== 'Analysis') {
      analysisBack.current = screen === 'Discover' ? backTo.current : screen;
    }
    if (destination === 'Gallery' && screen !== 'Gallery') refreshGallery(true);
    setScreen(destination);
  }

  function goBack() {
    if (screen === 'Gallery') {
      if (album) setAlbum(null);
      else navigate('Home');
    } else if (screen === 'Discover') {
      if (feedCategory && feed !== 'suggestions') setFeedCategory(null);
      else navigate(reviewBack.current);
    } else if (screen === 'Analysis') {
      navigate(analysisBack.current);
    } else if (screen === 'PrivacyPolicy' || screen === 'TermsAndConditions') {
      navigate('Settings');
    } else if (screen === 'Settings' || screen === 'Duplicates' || screen === 'Recall' || screen === 'PhotoMap'
      || screen === 'Connect' || screen === 'Patterns' || screen === 'Parallel' || screen === 'Evolve' || screen === 'NextSteps'
      || screen === 'Insights') {
      navigate(backTo.current);
    } else {
      navigate('Home');
    }
  }

  function openReview(mode: Feed | 'scan', category: string | null = null, scanId: string | null = null) {
    if (mode === 'suggestions' && category == null) {
      navigate('Revisit');
      return;
    }
    if (screen !== 'Discover') reviewBack.current = screen;
    setFeed(mode);
    setFeedCategory(category);
    setReviewScan(scanId);
    navigate('Discover');
  }

  function changed() {
    setRevision((value) => value + 1);
  }

  function openNextSteps(id: string | null = null) {
    setNextStepTarget(id);
    navigate('NextSteps');
  }

  const links = {
    gallery: () => void galleryAction('browse'),
    duplicates: () => navigate('Duplicates'),
    archive: () => navigate('Archive'),
    discover: openReview,
    recall: () => navigate('Recall'),
    photoMap: () => navigate('PhotoMap'),
    connect: () => navigate('Connect'),
    patterns: () => navigate('Patterns'),
    parallel: () => navigate('Parallel'),
    evolve: () => navigate('Evolve'),
    nextSteps: openNextSteps,
    insights: () => navigate('Insights'),
  };

  const primary = tabs.some((tab) => tab.name === screen);
  const selectedTab = primary ? screen : backTo.current;

  return <>
    {(screen === 'Home' || !primary) && <View style={layout.top}>
      {screen === 'Home'
        ? <Pressable accessibilityRole="button" accessibilityLabel="Nimby Home" onPress={() => navigate('Home')} style={layout.brand}>
            <Text style={layout.wordmark}>nimby<Text style={layout.wordmarkDot}>.</Text></Text>
          </Pressable>
        : <IconButton icon="back" label="Go back" run={goBack} style={layout.headerButton} />}
      <View style={layout.headerActions}>
        {scanActive(scan) && screen !== 'Analysis' && <Pressable accessibilityRole="button"
          accessibilityLabel={scanActive(scan) ? 'View active scan' : 'View latest scan'} onPress={() => navigate('Analysis')}
          style={({ pressed }) => [layout.scanShortcut, pressed && styles.faded]}>
          {scanActive(scan) && <View style={layout.liveDot} />}
          <Icon name={scanActive(scan) ? 'scan' : 'clock'} size={20} tint={scanActive(scan) ? color.blue : color.muted} />
        </Pressable>}
        {screen === 'Home' && <IconButton icon="settings" label="Settings" run={() => navigate('Settings')} style={layout.headerButton} />}
      </View>
    </View>}
    <View style={layout.main}>
      {searchVisited && <View style={[StyleSheet.absoluteFill, screen !== 'Recall' && layout.hiddenScreen]}
        pointerEvents={screen === 'Recall' ? 'auto' : 'none'} accessibilityElementsHidden={screen !== 'Recall'}
        importantForAccessibility={screen === 'Recall' ? 'auto' : 'no-hide-descendants'}>
        <RecallScreen revision={revision} open={setDetail} active={screen === 'Recall'} indexed={overview?.localAnalyzed ?? null}
          scan={() => void galleryAction('scan')} openMap={links.photoMap} search={searchWithFeedback}
          status={native!.memoryStatus} startBackfill={native!.requestMemoryBackfill} />
      </View>}
      {screen === 'Home' && <HomeDashboard {...links} data={overview} error={overviewError} busy={busy}
        scan={() => void galleryAction('scan')} pick={() => void pick()} previews={recent} discovery={discovery} nextStep={nextStep} recentError={recentError}
        openPhoto={setDetail} openScan={(id) => openReview('scan', null, id)} />}
      {screen === 'Gallery' && <GalleryScreen access={access} albums={albums} loading={loadingAlbums} error={galleryError}
        album={album} open={setAlbum} manage={() => void galleryAction('manage')} settings={showSettings}
        pick={() => void pick()} scan={start} revision={galleryRevision} />}
      {screen === 'Revisit' && <Revisit key={discoveryDay} revision={revision} open={setDetail} openMode={openReview}
        openCategory={(name) => openReview('suggestions', name)}
        browsing={browseReferences} toggleBrowse={() => setBrowseReferences((value) => !value)} />}
      {screen === 'PhotoMap' && <PhotoMapScreen revision={revision} open={setDetail} />}
      {screen === 'Connect' && <ConnectScreen revision={revision} open={setDetail} loadCandidates={loadTimelineCandidates}
        loadCorrections={loadCorrections} saveCorrections={saveCorrections} onCorrectionsChanged={changed} />}
      {screen === 'Patterns' && <PatternsScreen revision={revision} open={setDetail} loadCandidates={loadCandidates}
        loadFeedback={loadPatterns} saveFeedback={savePatterns} loadConfirmedGroups={loadConfirmedGroups} />}
      {!license.premium && (screen === 'Parallel' || screen === 'Evolve') && <View style={styles.content}>
        <Heading large>Lifetime license required</Heading>
        <Body>Your saved choices stay on this phone.</Body>
        <Button label="Open License settings" run={() => navigate('Settings')} />
      </View>}
      {screen === 'Parallel' && license.premium && <ParallelScreen revision={revision} open={setDetail} loadCandidates={loadCandidates}
        saveChoice={saveChoice} preferredActions={preferred} />}
      {screen === 'Evolve' && license.premium && <EvolveScreen revision={revision} loadState={loadEvolve} saveState={saveEvolve}
        changed={changed} loadConnectCorrections={loadCorrections} loadPatternFeedback={loadPatterns}
        resetCorrections={resetCorrections} />}
      {screen === 'NextSteps' && <NextStepsScreen revision={revision} target={nextStepTarget} scanning={scanActive(scan)}
        open={setDetail} changed={changed} />}
      {screen === 'Discover' && <Discover key={JSON.stringify([feed, reviewScan])} mode={feed}
        category={feedCategory} scanId={reviewScan} revision={revision} open={setDetail} changed={changed}
        openCategory={setFeedCategory} />}
      {screen === 'Explore' && <ExploreScreen {...links} scanning={scanActive(scan)} premium={license.premium} />}
      {screen === 'Insights' && <InsightsScreen {...links} data={overview} error={overviewError} />}
      {screen === 'Duplicates' && <DuplicatesScreen revision={revision} changed={() => setRevision((value) => value + 1)} />}
      {screen === 'Analysis' && <AnalysisScreen key={scan.runId} scan={scan} access={access} control={control}
        revision={revision} open={setDetail} changed={changed} done={goBack} />}
      {screen === 'Settings' && <SettingsScreen access={access} scan={scan} revision={revision} license={license}
        changed={changed} openPermissionSettings={showSettings} openArchive={() => navigate('Archive')}
        openScan={(id) => openReview('scan', null, id)}
        openLegal={navigate}
        onResume={() => { setScan(native!.scanStatus()); navigate('Analysis'); }} />}
      {(screen === 'PrivacyPolicy' || screen === 'TermsAndConditions') && <LegalDocumentScreen key={screen} document={screen} />}
      {screen === 'Archive' && <ArchiveScreen revision={revision} scanning={scanActive(scan)}
        changed={() => setRevision((value) => value + 1)} openDuplicates={() => navigate('Duplicates')} />}
    </View>
    <BottomTabs tabs={tabs} selected={selectedTab} navigate={navigate} />
    {detail && <PhotoDetail key={detail.sourceKey ?? detail.id} item={detail} close={() => setDetail(null)} open={setDetail}
      changed={() => setRevision((value) => value + 1)} />}
  </>;
}

function AnalysisScreen({ scan, access, control, revision, open, changed, done }: {
  scan: Scan; access: Access; control: (action: 'pause' | 'resume' | 'cancel') => void;
  revision: number; open: (photo: Result) => void; changed: () => void; done: () => void;
}) {
  const [category, setCategory] = useState<string | null>(null);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const title = {
    idle: 'Ready to scan', preparing: 'Preparing Eye', running: 'Analyzing photos', paused: 'Scan paused', matching: 'Checking for duplicates',
    complete: !scan.total ? 'No accessible photos' : scan.failed === scan.total ? 'No photos analyzed' : 'Scan complete',
    cancelled: 'Scan cancelled', blocked: 'Scan stopped',
  }[scan.phase];
  const progress = scan.total ? Math.min(100, Math.floor(scan.processed / scan.total * 100)) : 0;
  const hasResults = scan.analyzed + scan.cached > 0;
  const active = scanActive(scan);
  const counts = `${scan.analyzed.toLocaleString()} newly analyzed · ${scan.cached.toLocaleString()} cached · ${scan.failed.toLocaleString()} failed`;
  const errors = scan.errors.map((error, index) => <ErrorText key={`${index}-${error}`}>{error}</ErrorText>);
  if (!active && scan.resultId && hasResults) return <>
    <Discover mode="scan" scanId={scan.resultId} category={category} revision={revision} open={open} changed={changed}
      openCategory={setCategory} summary={<View style={styles.column}>
        <View style={layout.scanSummary}>
          <Heading large>{title}</Heading>
          <Body>{counts}</Body>
          {!!scan.problem && <ErrorText>{scan.problem}</ErrorText>}
        </View>
        {errors.length > 0 && <ActionLink label="Show scan errors" run={() => setErrorsOpen(true)} />}
      </View>} />
    {errorsOpen && <ActionSheet title="Scan errors" close={() => setErrorsOpen(false)}>{errors}</ActionSheet>}
  </>;

  const mood = mascotForScan(scan.phase, hasResults);
  return <ScrollView contentContainerStyle={styles.content}>
    <View style={layout.mascotHero}>
      <NimbyMascot state={mood} size={168} />
    </View>
    <Heading large>{scan.automatic && active ? 'Auto-scan' : title}</Heading>
    {access === 'limited' && <Body>Gallery scans use the photos you shared with Nimby through Android.</Body>}
    {scan.phase === 'preparing' && <Body>{scan.automatic ? 'Checking for new or edited photos.' : 'Nimby is checking your selection and getting the on-device Eye model ready.'}</Body>}
    {scan.phase === 'paused' && <Body>Nimby pauses between photos. Resume to continue this scan.</Body>}
    {scan.phase === 'complete' && !scan.total && <Body>{scan.automatic ? 'No new photos analyzed in this check.' : 'Choose another album, update photo access, or select photos manually.'}</Body>}
    {scan.phase === 'cancelled' && <Body>Photos Nimby already analyzed are saved.</Body>}
    <View style={layout.progressCard}>
      <Text accessibilityLiveRegion="polite" style={layout.progressNumber}>
        {scan.processed.toLocaleString()} / {scan.total.toLocaleString()}
      </Text>
      <Body>Photos processed</Body>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }}
        style={layout.track}><View style={[layout.progress, { width: `${progress}%` }]} /></View>
      <Body>{counts}</Body>
    </View>
    <View style={styles.row}>
      {active ? <>
        {!scan.automatic && scan.phase !== 'matching' && <Button label={scan.phase === 'paused' ? 'Resume' : 'Pause'} run={() => control(scan.phase === 'paused' ? 'resume' : 'pause')} />}
        <Button label={scan.automatic ? 'Stop this check' : 'Cancel scan'} subtle run={() => control('cancel')} />
      </> : <Button label="Done" run={done} />}
    </View>
    {!!scan.problem && <ErrorText>{scan.problem}</ErrorText>}
    {errors.length > 0 && <View style={styles.column}>
      <Heading>Recent errors</Heading>
      {errors}
    </View>}
  </ScrollView>;
}

const layout = StyleSheet.create({
  shell: { flex: 1, backgroundColor: color.paper },
  main: { flex: 1 },
  hiddenScreen: { opacity: 0 },
  top: { minHeight: 48, paddingHorizontal: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  brand: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
  wordmark: { color: color.ink, fontWeight: '600', fontSize: 28, letterSpacing: -1 },
  wordmarkDot: { color: color.blue },
  headerActions: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  headerButton: { backgroundColor: 'transparent' },
  scanShortcut: { minHeight: 48, minWidth: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  liveDot: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: color.blue, top: 8, right: 10 },
  mascotHero: { alignItems: 'center', paddingTop: 8, paddingBottom: 4, minHeight: 180, justifyContent: 'center' },
  scanSummary: { gap: 4 },
  progressCard: { backgroundColor: color.white, borderWidth: 1, borderColor: color.rule, borderRadius: 16, padding: 16, gap: 8 },
  progressNumber: { color: color.ink, fontVariant: ['tabular-nums'], fontSize: 34 },
  track: { height: 10, borderRadius: 20, backgroundColor: color.tint, overflow: 'hidden', marginVertical: 7 },
  progress: { height: '100%', backgroundColor: color.blue, borderRadius: 20 },
});
