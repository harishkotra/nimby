import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import { native } from './gallery';
import { licenseDemo } from './demoConfig';
import { ActionLink, Body, Button, IconButton, color, ErrorText, formatBytes, styles } from './ui';

export function VoiceSearch({ onTranscript, active, deferPrompt = false, children }: {
  onTranscript: (text: string) => void;
  active: boolean;
  /** Wait until the first search before offering the voice pack. */
  deferPrompt?: boolean;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<'idle' | 'installing' | 'recording' | 'transcribing'>('idle');
  const [error, setError] = useState('');
  const [offerDownload, setOfferDownload] = useState(false);
  const [packBytes, setPackBytes] = useState<number | null>(null);
  const version = useRef(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onResult = useRef(onTranscript);
  onResult.current = onTranscript;

  function clearTimer() {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
  }

  function cancel(update: boolean) {
    version.current++;
    clearTimer();
    native?.cancelVoice();
    busy.current = false;
    if (update) setPhase('idle');
  }

  useEffect(() => {
    const state = AppState.addEventListener('change', (next) => {
      // The Android permission prompt can temporarily make the app inactive.
      if (next === 'background' && timer.current != null) cancel(true);
    });
    return () => {
      state.remove();
      cancel(false);
    };
  }, []);

  useEffect(() => {
    if (!active && busy.current && phase !== 'installing') cancel(true);
  }, [active, phase]);

  async function install() {
    if (licenseDemo || !native || busy.current) return;
    const attempt = ++version.current;
    busy.current = true;
    setPhase('installing');
    setError('');
    setOfferDownload(false);
    try {
      await native.installVoice();
    } catch {
      if (version.current === attempt) setError('Could not download the voice pack. Try again when connected.');
    } finally {
      if (version.current === attempt) {
        busy.current = false;
        setPhase('idle');
      }
    }
  }

  async function finish() {
    if (!native || timer.current == null) return;
    clearTimer();
    const attempt = version.current;
    setPhase('transcribing');
    try {
      const text = await native.finishVoice();
      if (version.current !== attempt) return;
      if (text) onResult.current(text);
      else setError('Nimby did not hear any words. Try again or type your search.');
    } catch {
      if (version.current === attempt) setError('Nimby could not transcribe this recording.');
    } finally {
      if (version.current === attempt) {
        busy.current = false;
        setPhase('idle');
      }
    }
  }

  async function start() {
    if (!native || busy.current) return;
    const attempt = ++version.current;
    busy.current = true;
    setError('');
    setOfferDownload(false);
    try {
      const { ready, bytes } = await native.voiceStatus();
      if (version.current !== attempt) return;
      if (!ready) {
        if (licenseDemo) { setError('Voice search needs an installed voice pack. You can still type your search.'); return; }
        setPackBytes(bytes);
        if (deferPrompt) {
          setError('Search once by typing first. Voice download will be ready afterward.');
          setOfferDownload(false);
        } else {
          setOfferDownload(true);
        }
        return;
      }
      const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
      const granted = await PermissionsAndroid.request(permission);
      if (version.current !== attempt) return;
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        setError('Microphone access is off. You can still type your search.');
        return;
      }
      native.startVoice();
      timer.current = setTimeout(() => void finish(), 12_000);
      setPhase('recording');
    } catch {
      if (version.current === attempt) setError('Could not start voice search.');
    } finally {
      if (version.current === attempt && timer.current == null) busy.current = false;
    }
  }

  return <View style={styles.column}>
    <View style={layout.field}>{children}
      {Number(Platform.Version) >= 26 && (phase === 'recording'
        ? <IconButton icon="check" label="Stop recording and transcribe" run={() => void finish()} style={layout.icon} />
        : <IconButton icon="mic" label="Voice search" disabled={phase !== 'idle'} run={() => void start()} style={layout.icon} />)}
    </View>
    {phase === 'recording' && <View style={styles.between}><Body>Listening…</Body>
      <ActionLink label="Cancel recording" run={() => cancel(true)} /></View>}
    {(phase === 'installing' || phase === 'transcribing') && <Text accessibilityLiveRegion="polite" style={styles.body}>
      {phase === 'installing' ? 'Downloading voice pack…' : 'Transcribing…'}
    </Text>}
    {offerDownload && <View style={styles.column}>
      <Body>English voice search needs a one-time download{packBytes != null ? ` (${formatBytes(packBytes)})` : ''}. Transcription stays on this phone.</Body>
      <View style={styles.row}>
        <Button label="Download voice pack" run={() => void install()} />
        <ActionLink label="Not now" run={() => { setOfferDownload(false); setError(''); }} />
      </View>
    </View>}
    {!!error && <ErrorText>{error}</ErrorText>}
  </View>;
}

const layout = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.white, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: color.rule },
  icon: { backgroundColor: 'transparent' },
});
