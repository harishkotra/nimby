import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { native, type Access, type AutoScanInterval, type AutoScanStatus } from './gallery';
import { Body, color, ErrorText, Heading, Segments, styles } from './ui';

const intervals = [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }] as const;
const track = { false: color.rule, true: color.blue };

function lastResult(status: AutoScanStatus) {
  switch (status.lastOutcome) {
    case 'access': return 'Gallery access was needed.';
    case 'partial': return 'The check was interrupted. Nimby will continue next time.';
    case 'error': return 'Could not finish checking photos.';
    case 'complete': {
      const analyzed = status.analyzed ? `${status.analyzed.toLocaleString()} ${status.analyzed === 1 ? 'photo' : 'photos'} analyzed` : 'No photos analyzed';
      const failures = status.failed ? ` · ${status.failed.toLocaleString()} couldn’t be analyzed` : '';
      return `${analyzed}${failures}.${status.more ? ' Nimby will check more photos next time.' : ''}`;
    }
    default: return 'Waiting for the first check.';
  }
}

export function AutoScanSettings({ access, revision, running, disabled }: {
  access: Access; revision: number; running: boolean; disabled: boolean;
}) {
  const [status, setStatus] = useState<AutoScanStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [readError, setReadError] = useState(false);
  const [saveError, setSaveError] = useState('');
  const write = useRef(false);
  const enabled = status != null && status.interval !== 'off';

  useEffect(() => {
    const load = native?.autoScanStatus;
    if (!load || saving) return;
    let active = true;
    let reading = false;
    async function refresh() {
      if (!load || reading || write.current) return;
      reading = true;
      try {
        const result = await load();
        if (active && !write.current) { setStatus(result); setReadError(false); }
      } catch { if (active && !write.current) setReadError(true); }
      finally { reading = false; }
    }
    void refresh();
    const timer = enabled ? setInterval(() => void refresh(), 4_000) : null;
    return () => { active = false; if (timer != null) clearInterval(timer); };
  }, [enabled, revision, running, saving]);

  async function configure(interval: AutoScanInterval, charging: boolean) {
    if (write.current || !native?.configureAutoScan) return;
    write.current = true;
    setSaving(true);
    setSaveError('');
    try { setStatus(await native.configureAutoScan(interval, charging)); }
    catch (cause) { setSaveError(cause instanceof Error ? cause.message : 'Could not save Auto-scan settings.'); }
    finally { write.current = false; setSaving(false); }
  }

  if (!native?.autoScanStatus || !native.configureAutoScan) return null;
  return <View style={layout.panel}>
    <View style={layout.toggle}>
      <View style={layout.label}><Heading>Auto-scan</Heading><Body>Check for new or edited photos on this phone.</Body></View>
      <Switch accessibilityLabel="Auto-scan" value={enabled} trackColor={track}
        disabled={!status || disabled || saving || (!enabled && (!status.firstScanComplete || access === 'none'))}
        onValueChange={(on) => { if (status) void configure(on ? status.preferredInterval : 'off', status.chargingOnly); }} />
    </View>
    {access === 'none' ? <Body>Gallery access needed to check for photos.</Body> :
      access === 'limited' && <Body>Nimby checks the photos you’ve shared through Android.</Body>}
    {status && !enabled && !status.firstScanComplete && <Body>Complete a photo scan to turn this on.</Body>}
    {status && status.interval !== 'off' && <>
      <Segments options={intervals} value={status.interval}
        select={(interval) => { if (!saving && !disabled && interval !== status.interval) void configure(interval, status.chargingOnly); }} />
      <View style={layout.toggle}>
        <Text style={[styles.body, layout.label]}>Only while charging</Text>
        <Switch accessibilityLabel="Only while charging" value={status.chargingOnly} trackColor={track}
          disabled={saving || disabled} onValueChange={(charging) => void configure(status.interval, charging)} />
      </View>
      <Body>Android chooses the time based on battery and system settings.</Body>
      <Text accessibilityLiveRegion="polite" style={styles.body}>{running ? 'Checking your gallery…' :
        status.lastCheck == null ? lastResult(status) : `Last check · ${new Date(status.lastCheck).toLocaleString()}\n${lastResult(status)}`}</Text>
    </>}
    {!!saveError && <ErrorText>{saveError}</ErrorText>}
    {readError && <ErrorText>Could not read Auto-scan status.</ErrorText>}
  </View>;
}

const layout = StyleSheet.create({
  panel: { gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.rule },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  label: { flex: 1, gap: 4 },
});
