import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { native, scanActive, type Access, type Album, type EyeStatus, type Processing, type Scan, type ScanRecord } from './gallery';
import { Body, Button, Chip, color, ErrorText, formatBytes, Heading, Icon, type IconName, styles } from './ui';

export function scanLine(record: ScanRecord) {
  const date = new Date(record.started).toLocaleDateString();
  const phase = record.phase === 'complete' ? 'Completed' : record.phase === 'blocked' ? 'Stopped'
    : record.phase[0].toUpperCase() + record.phase.slice(1);
  return `${date} · ${phase} · ${record.analyzed} analyzed, ${record.cached} cached, ${record.failed} failed`;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <View style={layout.detail}>
    <Text style={layout.detailLabel}>{label}</Text>
    <Text style={layout.value}>{value}</Text>
  </View>;
}

function SettingsAction({ name, icon, run, disabled, danger, expanded }: {
  name: string; icon: IconName; run: () => void; disabled?: boolean; danger?: boolean; expanded?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, expanded }} disabled={disabled}
    onPress={run} style={({ pressed }) => [layout.action, (pressed || disabled) && styles.faded]}>
    <Icon name={icon} size={20} tint={danger ? color.danger : color.deep} />
    <Text style={[layout.actionTitle, danger && layout.danger]}>{name}</Text>
    <Icon name={expanded == null ? 'chevron' : expanded ? 'up' : 'down'} tint={color.muted} size={16} />
  </Pressable>;
}

export function SettingsScreen({ access, scan, openPermissionSettings, revision, changed, openArchive, onResume, openScan }: {
  access: Access; scan: Scan; openPermissionSettings: () => void; revision: number; changed: () => void;
  openArchive: () => void; onResume: () => void; openScan: (id: string) => void;
}) {
  const [status, setStatus] = useState<EyeStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [testing, setTesting] = useState(false);
  const [processing, setProcessing] = useState<Processing | null>(null);
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [modelDetails, setModelDetails] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scanning = scanActive(scan);
  const scanLabel = { preparing: 'Preparing', running: 'Analyzing photos', paused: 'Paused', matching: 'Checking duplicates',
    idle: 'Idle', complete: 'Idle', blocked: 'Last scan stopped', cancelled: 'Last scan cancelled' }[scan.phase];

  useEffect(() => {
    let active = true;
    let inFlight = false;
    async function refresh() {
      if (!native || inFlight) return;
      inFlight = true;
      try {
        const next = await native.eyeStatus();
        if (active) {
          setStatus(next);
          setStatusError(false);
        }
      } catch {
        if (active) setStatusError(true);
      } finally {
        inFlight = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 750);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    native?.processing().then((value) => { if (active) setProcessing(value); })
      .catch(() => { if (active) setRequestError('Could not read processing history.'); });
    return () => { active = false; };
  }, [revision, scanning]);

  async function openExclusions() {
    if (albums) { setAlbums(null); return; }
    if (!native || access === 'none') { setAlbums([]); return; }
    try { setAlbums(await native.albums()); }
    catch { setRequestError('Could not list accessible albums.'); }
  }

  async function updateExclusion(id: string, name: string, excluded: boolean) {
    try { await native?.excludeAlbum(id, name, excluded); changed(); }
    catch { setRequestError('Could not update excluded albums.'); }
  }

  function confirmClear(all: boolean) {
    const label = all ? 'Delete analysis metadata' : 'Clear analysis cache';
    Alert.alert(label, all ? 'Remove the photo index, scan history, and Keep, Dismiss, and collection decisions from Nimby. Gallery originals and archive records stay in place.'
      : 'Remove cached Eye results and embeddings. Decisions and scan history stay in Nimby. Gallery originals are safe.', [
      { text: 'Cancel', style: 'cancel' }, { text: label, style: 'destructive', onPress: async () => {
        setPrivacyBusy(true);
        try { await native?.clearAnalysis(all); changed(); }
        catch (error) { setRequestError(error instanceof Error ? error.message : 'Could not clear analysis data.'); }
        finally { setPrivacyBusy(false); }
      } },
    ]);
  }

  async function runCheck() {
    if (!native || testing) return;
    setTesting(true);
    setRequestError('');
    try {
      await native.runEyeCheck();
      setStatus(await native.eyeStatus());
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Could not start the Eye check.');
    } finally {
      setTesting(false);
    }
  }

  const checking = testing || status?.checkPhase === 'running';
  const checkLabel = checking ? 'Running self-test' : status?.checkPhase === 'failed' ? 'Check failed' :
    status?.checkPhase === 'passed' ? 'Self-test passed' : 'Ready to check';
  const duration = status?.checkDurationMs;
  const photoAccess = {
    full: 'Full access', limited: 'Selected photos only', denied: 'Permission denied',
    revoked: 'Permission revoked', unrequested: 'Access not requested',
  }[native?.permissionStatus?.(false) ?? 'unrequested'];
  const currentProcessing = checking ? 'Self-test active' : processing?.history[0]?.phase === 'interrupted' && !scanning
    ? 'Last scan interrupted' : scanLabel;

  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={layout.intro}>
      <Heading large>Settings</Heading>
      <Body>Model health, photo access, and your data.</Body>
    </View>
    <View style={layout.panel}>
      <View style={layout.modelHeader}>
        <View style={layout.modelIcon}><Icon name="spark" tint={color.blue} /></View>
        <View style={layout.modelText}><Heading>Desert Ant Eye</Heading><Body>Runs on your device</Body></View>
      </View>
      <View style={styles.row}>
        {checking ? <ActivityIndicator color={color.blue} /> : <View style={[layout.dot, status?.checkPhase === 'failed' && layout.errorDot]} />}
        <Text accessibilityLiveRegion="polite" style={[layout.status, status?.checkPhase === 'failed' && layout.danger]}>{checkLabel}</Text>
      </View>
      {!checking && status?.checkPhase === 'passed' && duration != null && <Body>Inference completed in {duration.toLocaleString()} ms.</Body>}
      {!checking && status?.checkPhase === 'failed' && <ErrorText>{status.checkError}</ErrorText>}
      {status?.runtimeError && status.runtimeError !== status.checkError && <ErrorText>{status.runtimeError}</ErrorText>}
      <Body>{scanning ? 'Finish or cancel the current scan to run the check.' : 'The self-test analyzes a bundled image.'}</Body>
      <Button label={checking ? 'Checking Eye…' : 'Run Self-Test'} disabled={checking || scanning || !status}
        run={() => void runCheck()} />
    </View>
    {statusError && <ErrorText>Could not read model status. Install the current Nimby Android build and reopen Settings.</ErrorText>}
    {status && <View style={layout.section}>
      <View style={layout.details}>
        <Detail label="Runtime" value={{ initialized: 'Initialized', unloaded: 'Unloaded', loading: 'Loading', error: 'Error' }[status.runtime] ?? 'Unavailable'} />
        <Detail label="Model files" value={status.filesReady ? 'Prepared' : status.packagedBytes ? 'Bundled' : 'Unavailable'} />
      </View>
      <SettingsAction name="Model details" icon="info" expanded={modelDetails} run={() => setModelDetails(!modelDetails)} />
      {modelDetails && <>
        <View style={layout.details}>
          <Detail label="Eye SDK" value={status.sdkVersion} />
          <Detail label="Model version" value={status.modelVersion ?? 'Available after inference'} />
          <Detail label="In app package" value={formatBytes(status.packagedBytes)} />
          <Detail label="Prepared files" value={formatBytes(status.stagedBytes)} />
          <Detail label="Last successful inference" value={status.lastSuccess ? new Date(status.lastSuccess).toLocaleString() : 'None recorded'} />
          <Detail label="Last inference latency" value={status.lastInferenceMs == null ? 'None recorded' : `${status.lastInferenceMs} ms`} />
        </View>
        <Body>Nimby loads Eye during scans and self-tests.</Body>
      </>}
    </View>}
    <View style={layout.section}>
      <Heading>Photo access</Heading>
      <View style={layout.permission}>
        <View style={layout.modelIcon}><Icon name="gallery" tint={color.blue} /></View>
        <View style={layout.modelText}><Text style={layout.value}>{photoAccess}</Text>
          {access === 'none' && <Body>Pick individual photos whenever you like.</Body>}
        </View>
      </View>
      <SettingsAction name="Android permission settings" icon="external" run={openPermissionSettings} />
    </View>
    <View style={layout.section}>
      <Heading>Processing</Heading>
      <View style={layout.details}>
        <Detail label="Photos indexed" value={processing?.indexed.toLocaleString() ?? 'Unavailable'} />
        <Detail label="Analysis data" value={formatBytes(processing?.cacheBytes ?? null)} />
        <Detail label="Last completed scan" value={processing?.lastScan ? new Date(processing.lastScan).toLocaleString() : 'None recorded'} />
        <Detail label="Current processing" value={currentProcessing} />
      </View>
      {processing?.history[0]?.resumable && !scanning && <Button label="Resume interrupted scan" subtle disabled={checking}
        run={() => {
          native?.resumeInterrupted().then(onResume)
            .catch((error: unknown) => setRequestError(error instanceof Error ? error.message : 'Could not resume the scan.'));
        }} />}
      <SettingsAction name="Scan history" icon="clock" expanded={historyOpen} run={() => setHistoryOpen(!historyOpen)} />
      {historyOpen && <View style={layout.history}>
        {processing?.history.length ? processing.history.map((record) =>
          <View key={record.id} style={layout.historyItem}><View style={layout.historyDot} /><View style={layout.modelText}>
            <Body>{scanLine(record)}</Body>
            {record.hasResults && record.finished != null && <Button label="View results" subtle run={() => openScan(record.id)} />}
          </View></View>) : <Body>New scans will appear here.</Body>}
      </View>}
    </View>
    <View style={layout.section}>
      <Heading>Privacy & data</Heading>
      <SettingsAction name="Manage excluded albums" icon="gallery" expanded={albums !== null} run={() => void openExclusions()} />
      {albums && <>
        <Body>Excluded albums are skipped in full-gallery scans. You can still scan them individually.</Body>
        <View style={styles.row}>
          {[...(processing?.excluded ?? []), ...albums.filter((album) => !processing?.excluded.some((excluded) => excluded.id === album.id))]
            .map((album) => {
              const excluded = processing?.excluded.some((entry) => entry.id === album.id) ?? false;
              return <Chip key={album.id} label={`${album.name} · ${excluded ? 'Excluded' : 'Included'}`} selected={excluded}
                run={() => void updateExclusion(album.id, album.name, !excluded)} />;
            })}
        </View>
      </>}
      <SettingsAction name="Review archived media" icon="archive" run={openArchive} />
      <SettingsAction name="Clear AI analysis cache" icon="layers" disabled={scanning || checking || privacyBusy} run={() => confirmClear(false)} />
      <SettingsAction name="Delete local analysis metadata" icon="info" danger disabled={scanning || checking || privacyBusy} run={() => confirmClear(true)} />
    </View>
    {requestError !== '' && <ErrorText>{requestError}</ErrorText>}
  </ScrollView>;
}

const layout = StyleSheet.create({
  intro: { gap: 6 },
  panel: { backgroundColor: color.white, borderRadius: 23, padding: 17, gap: 10 },
  modelHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  modelIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: color.tint },
  modelText: { flex: 1, gap: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.blue },
  errorDot: { backgroundColor: color.danger },
  status: { color: color.ink, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  section: { gap: 7 },
  details: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 6 },
  detail: { flexBasis: '46%', flexGrow: 1, gap: 4 },
  detailLabel: { color: color.muted, fontSize: 13 },
  value: { color: color.ink, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  permission: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 5 },
  action: { minHeight: 48, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 11 },
  actionTitle: { color: color.ink, flex: 1, fontSize: 14, fontWeight: '600' },
  danger: { color: color.danger },
  history: { gap: 10, paddingVertical: 5 },
  historyItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  historyDot: { width: 7, height: 7, borderRadius: 4, marginTop: 7, backgroundColor: color.blue },
});
