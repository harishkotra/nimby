import { useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, View } from 'react-native';
import { useDialog } from './Dialogs';
import { native } from './gallery';
import { Button, ErrorText, formatBytes, styles } from './ui';

export function VoiceSearch({ onTranscript }: { onTranscript: (text: string) => void }) {
  const show = useDialog();
  const [phase, setPhase] = useState<'idle' | 'installing' | 'recording' | 'transcribing'>('idle');
  const [error, setError] = useState('');
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
    try {
      const { ready, bytes } = await native.voiceStatus();
      if (version.current !== attempt) return;
      if (!ready) {
        show({
          title: 'Download English voice search?',
          message: `${formatBytes(bytes)}. After download, transcription runs on your phone.`,
          action: { label: 'Download voice pack', run: () => void install() },
        });
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
    {!!error && <ErrorText>{error}</ErrorText>}
  </View>;
}
