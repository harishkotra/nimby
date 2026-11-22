import { useDialog } from './Dialogs';
import { AutoScanSettings } from './AutoScanSettings';
import { QwenModelControls } from './QwenModelControls';
import { licenseDemo } from './demoConfig';
import { LicenseSettings, type useLifetimeLicense } from './LicenseSettings';
import { legalDocuments, type LegalDocumentId } from './legalDocuments';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { native, scanActive, type Access, type Album, type EyeStatus, type Processing, type Scan, type ScanRecord } from './gallery';
import { ActionLink, Body, Button, Chip, color, ErrorText, formatBytes, Heading, Icon, type IconName, styles } from './ui';

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

function SettingsCard({ title, subtitle, icon, children }: {
  title: string; subtitle: string; icon: IconName; children: ReactNode;
}) {
  return <View style={layout.panel}>
    <View style={layout.cardHeader}>
      <View style={layout.cardIcon}><Icon name={icon} tint={color.blue} /></View>
      <View style={layout.modelText}><Heading>{title}</Heading><Body>{subtitle}</Body></View>
    </View>
    {children}
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

export function SettingsScreen({ access, scan, openPermissionSettings, revision, changed, openArchive, onResume, openScan, license, openLegal }: {
  access: Access; scan: Scan; openPermissionSettings: () => void; revision: number; changed: () => void;
  openArchive: () => void; onResume: () => void; openScan: (id: string) => void;
  license: ReturnType<typeof useLifetimeLicense>;
  openLegal: (document: LegalDocumentId) => void;
}) {
  const show = useDialog();
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
    show({ title: label, message: all
      ? 'Remove the photo index, scan history, photo decisions, timeline edits, and saved feedback. This turns off Auto-scan. Original photos and archive records stay in place.'
      : 'Remove cached Eye results and embeddings and turn off Auto-scan. Photo decisions, scan history, and your originals stay in place.',
      action: { label, destructive: true, run: async () => {
        setPrivacyBusy(true);
        try { await native?.clearAnalysis(all); changed(); }
        catch (error) { setRequestError(error instanceof Error ? error.message : 'Could not clear analysis data.'); }
        finally { setPrivacyBusy(false); }
      } },
    });
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
  const duration = status?.checkDurationMs;
  const photoAccess = {
    full: 'Full access', limited: 'Selected photos only', denied: 'Permission denied',
    revoked: 'Permission revoked', unrequested: 'Access not requested',
  }[native?.permissionStatus?.(false) ?? 'unrequested'];
  const currentProcessing = checking ? 'Self-test active' : processing?.history[0]?.phase === 'interrupted' && !scanning
    ? 'Last scan interrupted' : scanLabel;
  const eyeFiles = status ? status.filesReady || !!status.packagedBytes : null;
  const checkLabel = checking ? 'Running self-test' : status?.checkPhase === 'failed' ? 'Self-test failed' :
    status?.checkPhase === 'passed' ? 'Self-test passed' : eyeFiles ? 'Self-test ready' : 'Self-test unavailable';
  const eyeRuntime = status ? { initialized: 'Initialized', unloaded: 'Unloaded', loading: 'Loading', error: 'Error' }[status.runtime] : null;

  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={layout.intro}>
      <Heading large>Settings</Heading>
    </View>
    {licenseDemo && <SettingsCard title="License" subtitle="Nimby Lifetime demo" icon="bookmark">
      <LicenseSettings license={license} />
    </SettingsCard>}
    <SettingsCard title="Photo access" subtitle={photoAccess} icon="gallery">
      {access === 'none' && <Body>You can still choose individual photos.</Body>}
      <SettingsAction name="Manage access in Android" icon="external" run={openPermissionSettings} />
      <AutoScanSettings access={access} revision={revision} running={scanning && scan.automatic === true} disabled={privacyBusy} />
    </SettingsCard>
    <SettingsCard title="Library status" subtitle={currentProcessing === 'Idle' ? 'Your on-device photo index' : currentProcessing} icon="clock">
      <View style={layout.details}>
        <Detail label="Photos indexed" value={processing?.indexed.toLocaleString() ?? 'Unavailable'} />
        <Detail label="Analysis data" value={formatBytes(processing?.cacheBytes ?? null)} />
      </View>
      <Body>{processing?.lastScan ? `Last scan completed ${new Date(processing.lastScan).toLocaleString()}` : 'No completed scans yet.'}</Body>
      {processing?.history.some((record) => record.resumable) && (!scanning || scan.automatic) && <Button label="Resume interrupted scan" subtle disabled={checking}
        run={() => {
          native?.resumeInterrupted().then(onResume)
            .catch((error: unknown) => setRequestError(error instanceof Error ? error.message : 'Could not resume the scan.'));
        }} />}
      <SettingsAction name="Scan history" icon="clock" expanded={historyOpen} run={() => setHistoryOpen(!historyOpen)} />
      {historyOpen && <View style={layout.history}>
        {processing?.history.length ? processing.history.map((record) =>
          <View key={record.id} style={layout.historyItem}><View style={layout.historyDot} /><View style={layout.modelText}>
            <Body>{scanLine(record)}</Body>
            {record.hasResults && record.finished != null && <ActionLink label="View results" run={() => openScan(record.id)} />}
          </View></View>) : <Body>New scans will appear here.</Body>}
      </View>}
    </SettingsCard>
    <SettingsCard title="On-device models" subtitle="Photo analysis runs on this phone" icon="scan">
      <View style={layout.model}>
        <View style={layout.modelHeader}>
          <Heading>Desert Ant Eye</Heading>
          <Text style={layout.detailLabel}>{!status ? 'Checking…' : status.packagedBytes ? 'Bundled' : status.filesReady ? 'Prepared' : 'Files unavailable'}</Text>
        </View>
        <Body>Recognizes photo categories and finds similar images.</Body>
        {eyeRuntime && <Body>Runtime · {eyeRuntime}</Body>}
        <View style={styles.row}>
          {checking ? <ActivityIndicator color={color.blue} /> : <View style={[layout.dot,
            status?.checkPhase === 'passed' && layout.successDot, status?.checkPhase === 'failed' && layout.errorDot]} />}
          <Text accessibilityLiveRegion="polite" style={[layout.status, status?.checkPhase === 'failed' && layout.danger]}>
            {checkLabel}{!checking && status?.checkPhase === 'passed' && duration != null ? ` · ${duration.toLocaleString()} ms` : ''}
          </Text>
        </View>
        {!checking && status?.checkPhase === 'failed' && <ErrorText>{status.checkError}</ErrorText>}
        {status?.runtimeError && status.runtimeError !== status.checkError && <ErrorText>{status.runtimeError}</ErrorText>}
        {statusError && <ErrorText>Could not read Eye status from this Android build.</ErrorText>}
        {scanning && <Body>Finish or cancel the current scan to run the check.</Body>}
        <ActionLink label={checking ? 'Checking Eye…' : 'Run Self-Test'} disabled={checking || scanning || !eyeFiles || statusError}
          run={() => void runCheck()} />
      </View>
      <View style={layout.divider} />
      <QwenModelControls scanning={scanning} />
      {status && <>
        <View style={layout.divider} />
        <SettingsAction name="Model details" icon="info" expanded={modelDetails} run={() => setModelDetails(!modelDetails)} />
        {modelDetails && <>
          <View style={layout.details}>
            <Detail label="Eye SDK" value={status.sdkVersion} />
            <Detail label="Model version" value={status.modelVersion ?? 'Available after inference'} />
            <Detail label="In app package" value={formatBytes(status.packagedBytes)} />
            <Detail label="Prepared model files" value={status.filesReady ? formatBytes(status.stagedBytes) : 'Not staged'} />
            <Detail label="Last successful inference" value={status.lastSuccess ? new Date(status.lastSuccess).toLocaleString() : 'None recorded'} />
            <Detail label="Last inference latency" value={status.lastInferenceMs == null ? 'None recorded' : `${status.lastInferenceMs} ms`} />
          </View>
          <Body>Nimby loads Eye during scans and tests it with a bundled image.</Body>
        </>}
      </>}
    </SettingsCard>
    <SettingsCard title="Your data" subtitle="Review the archive and manage albums" icon="archive">
      <SettingsAction name="Review archived media" icon="archive" run={openArchive} />
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
    </SettingsCard>
    <SettingsCard title="Legal" subtitle="How Nimby handles data and the terms for using it" icon="info">
      <SettingsAction name={legalDocuments.PrivacyPolicy.title} icon="info" run={() => openLegal('PrivacyPolicy')} />
      <SettingsAction name={legalDocuments.TermsAndConditions.title} icon="info" run={() => openLegal('TermsAndConditions')} />
    </SettingsCard>
    <SettingsCard title="Danger zone" subtitle="Remove Nimby’s analysis and keep your original photos" icon="info">
      <SettingsAction name="Clear AI analysis cache" icon="layers" danger disabled={scanning || checking || privacyBusy} run={() => confirmClear(false)} />
      <SettingsAction name="Delete local analysis metadata" icon="info" danger disabled={scanning || checking || privacyBusy} run={() => confirmClear(true)} />
    </SettingsCard>
    {requestError !== '' && <ErrorText>{requestError}</ErrorText>}
  </ScrollView>;
}

const layout = StyleSheet.create({
  intro: { gap: 8 },
  panel: { backgroundColor: color.white, borderRadius: 16, padding: 16, gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: color.tint },
  model: { gap: 4 },
  modelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 12, rowGap: 4 },
  modelText: { flex: 1, gap: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.rule },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.muted },
  successDot: { backgroundColor: color.blue },
  errorDot: { backgroundColor: color.danger },
  status: { color: color.ink, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  details: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 6 },
  detail: { flexBasis: '46%', flexGrow: 1, gap: 4 },
  detailLabel: { color: color.muted, fontSize: 13 },
  value: { color: color.ink, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  action: { minHeight: 48, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionTitle: { color: color.ink, flex: 1, fontSize: 14, fontWeight: '600' },
  danger: { color: color.danger },
  history: { gap: 10, paddingVertical: 4 },
  historyItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  historyDot: { width: 7, height: 7, borderRadius: 4, marginTop: 7, backgroundColor: color.blue },
});
