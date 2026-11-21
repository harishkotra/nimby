import { useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, View } from 'react-native';
import { native } from './gallery';
import { Body, Button, ErrorText, formatBytes, styles } from './ui';

export function VoiceSearch({ onTranscript, deferPrompt = false }: {
  onTranscript: (text: string) => void;
  /** When true, skip the blocking download dialog until the user has searched by text once. */
  deferPrompt?: boolean;
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

  async function install() {
    if (!native || busy.current) return;
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

  if (Number(Platform.Version) < 26) return null;
  if (phase === 'recording') return <View style={styles.row}>
    <Button label="Stop recording" run={() => void finish()} />
    <Button label="Cancel" subtle run={() => cancel(true)} />
  </View>;

  return <View style={styles.column}>
    <Button label={phase === 'installing' ? 'Downloading voice pack…' : phase === 'transcribing' ? 'Transcribing…' : 'Voice search'}
      subtle disabled={phase !== 'idle'} run={() => void start()} />
    {offerDownload && <View style={styles.column}>
      <Body>English voice search needs a one-time download{packBytes != null ? ` (${formatBytes(packBytes)})` : ''}. Transcription stays on this phone.</Body>
      <View style={styles.row}>
        <Button label="Download voice pack" run={() => void install()} />
        <Button label="Not now" subtle run={() => { setOfferDownload(false); setError(''); }} />
      </View>
    </View>}
    {!!error && <ErrorText>{error}</ErrorText>}
  </View>;
}
