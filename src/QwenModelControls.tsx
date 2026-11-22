import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View, type DimensionValue } from 'react-native';
import { useDialog } from './Dialogs';
import { licenseDemo } from './demoConfig';
import { native, type ProductVisionStatus } from './gallery';
import { ActionLink, Body, color, ErrorText, Heading, styles } from './ui';

export function QwenModelControls({ scanning, compact }: { scanning: boolean; compact?: boolean }) {
  const show = useDialog();
  const [status, setStatus] = useState<ProductVisionStatus>();
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const refresh = useCallback(() => {
    try {
      const next = native?.productVisionStatus?.();
      setStatus(next);
      setStatusError(!next);
    } catch { setStatus(undefined); setStatusError(true); }
  }, []);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    if (!busy && (!status?.phase || status.phase === 'idle')) return;
    const timer = setInterval(refresh, 700);
    return () => clearInterval(timer);
  }, [busy, refresh, status?.phase]);

  async function update(install: boolean) {
    if ((install && licenseDemo) || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (install) await native?.installProductVision?.();
      else await native?.removeProductVision?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : install ? 'Could not download Qwen.' : 'Could not remove Qwen.');
    } finally {
      pending.current = false;
      setBusy(false);
      refresh();
    }
  }

  const downloading = status?.phase === 'downloading';
  const busyReading = status?.phase === 'reading';
  const progress = status?.total ? Math.min(100, Math.floor(100 * status.received / status.total)) : 0;
  const label = statusError ? 'Status unavailable' : !status ? 'Checking…' : !status.supported ? 'Unavailable on this device' :
    downloading ? 'Downloading' : busyReading ? 'Reading a photo' : status.installed ? 'Ready' : 'Not installed';

  return <View style={layout.group}>
    <View style={layout.header}>
      <Heading>Qwen vision</Heading>
      <Text accessibilityLiveRegion="polite" style={[layout.status, status?.supported && status.installed && layout.ready]}>{label}</Text>
    </View>
    <Body>{status?.supported === false ? 'Requires a compatible 64-bit Android device with enough memory.' :
      'Suggest photo tags, identify products, and review receipts on your phone.'}</Body>
    {statusError && <ErrorText>Could not read Qwen status from this Android build.</ErrorText>}
    {!!error && <ErrorText>{error}</ErrorText>}
    {!statusError && downloading && <>
      <View accessibilityRole="progressbar" accessibilityLabel="Qwen download" accessibilityValue={{ min: 0, max: 100, now: progress }}
        style={layout.track}>
        <View style={[layout.fill, { width: `${progress}%` as DimensionValue }]} />
      </View>
      <View style={styles.between}>
        <Body>{progress}% downloaded</Body>
        <ActionLink label="Cancel download" run={() => native?.cancelProductVisionDownload?.()} />
      </View>
    </>}
    {!statusError && status?.supported && !downloading && (status.installed ?
      !compact && !!native?.removeProductVision && <ActionLink label="Remove download" danger disabled={busy || busyReading}
        run={() => show({ title: 'Remove Qwen?', message: 'This frees model storage. Your photos and reminders stay in Nimby.',
          action: { label: 'Remove download', destructive: true, run: () => void update(false) },
        })} /> : licenseDemo ? <Body>Use an installed model in this demo.</Body> : !!native?.installProductVision && <>
      <ActionLink label={busy ? 'Preparing download…' : 'Download Qwen · 1.3 GB'}
        disabled={busy || scanning} run={() => void update(true)} />
      {scanning && <Body>Finish or cancel the current scan to download Qwen.</Body>}
    </>)}
  </View>;
}

const layout = StyleSheet.create({
  group: { gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 12, rowGap: 4 },
  status: { color: color.muted, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  ready: { color: color.blue },
  track: { height: 4, borderRadius: 2, backgroundColor: color.rule, overflow: 'hidden', marginTop: 8 },
  fill: { height: '100%', backgroundColor: color.blue },
});
