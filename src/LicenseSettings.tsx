import { useEffect, useState } from 'react';
import { AppState, StyleSheet, TextInput, View } from 'react-native';
import { lifetimeTestProduct } from './demoConfig';
import { useDialog } from './Dialogs';
import { native } from './gallery';
import { LifetimeLicense } from './lifetimeLicense';
import { ActionLink, Body, Button, color, ErrorText, styles } from './ui';

export function useLifetimeLicense() {
  const [manager] = useState(() => {
    if (!lifetimeTestProduct || !native?.readLicense || !native.writeLicense) return null;
    const read = native.readLicense;
    const write = native.writeLicense;
    return new LifetimeLicense({
      productId: lifetimeTestProduct, read: () => read(), write: (record) => write(record),
      fetch: (url, options) => fetch(url, options), now: Date.now,
    });
  });
  const [view, setView] = useState(() => manager?.view() ?? null);

  useEffect(() => {
    if (!manager) return;
    const unsubscribe = manager.subscribe(() => setView(manager.view()));
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void manager.foreground();
    });
    void manager.foreground();
    return () => { unsubscribe(); appState.remove(); };
  }, [manager]);

  useEffect(() => {
    if (!manager || view?.status !== 'active' || view.expiresAt == null) return;
    const timer = setTimeout(() => setView(manager.view()), Math.max(0, view.expiresAt - Date.now()) + 5);
    return () => clearTimeout(timer);
  }, [manager, view?.status, view?.expiresAt]);

  return { manager, view, premium: lifetimeTestProduct === null || view?.status === 'active' };
}

export function LicenseSettings({ license }: { license: ReturnType<typeof useLifetimeLicense> }) {
  const show = useDialog();
  const [key, setKey] = useState('');
  const { view, manager } = license;
  const busy = view?.busy ?? false;
  if (!view || !manager) return <Body>License redemption requires the current Nimby demo build.</Body>;

  async function redeem() {
    if (!manager) return;
    const input = key;
    setKey('');
    await manager.redeem(input);
  }

  const statusLabel = { loading: 'Reading license', free: 'Free', active: 'Lifetime active', verify: 'Verification required' };
  return <View style={styles.column}>
    <Body>{statusLabel[view.status]}</Body>
    {view.status === 'active' && view.expiresAt !== null && <Body>
      Available offline through {new Date(view.expiresAt).toLocaleString()}.
    </Body>}
    {view.status === 'free' && <>
      <TextInput value={key} onChangeText={setKey} accessibilityLabel="License key" placeholder="Paste your license key"
        placeholderTextColor={color.muted} autoCapitalize="none" autoCorrect={false} autoComplete="off" secureTextEntry
        maxLength={256} editable={!busy} style={layout.key} />
      <Button label={busy ? 'Redeeming…' : 'Redeem license'} disabled={!key.trim() || busy} run={() => void redeem()} />
    </>}
    {view.status === 'loading' && !busy && <ActionLink label="Retry" run={() => void manager.foreground()} />}
    {view.hasActivation && <View style={styles.row}>
      <ActionLink label={busy ? 'Working…' : 'Check license'} disabled={busy} run={() => void manager.check()} />
      <ActionLink label="Release this device" disabled={busy} run={() => show({
        title: 'Release this device?', message: 'Nimby will switch to Free here and you can redeem the key on another device.',
        action: { label: 'Release device', run: () => void manager.release() },
      })} />
    </View>}
    {!!view.message && (view.message === 'This device was released.' ? <Body>{view.message}</Body> : <ErrorText>{view.message}</ErrorText>)}
    <Body>License checks contact Dodo Payments. Your photos and history stay on this phone.</Body>
  </View>;
}

const layout = StyleSheet.create({
  key: { color: color.ink, backgroundColor: color.paper, borderRadius: 12, minHeight: 48, paddingHorizontal: 12, fontSize: 16 },
});
