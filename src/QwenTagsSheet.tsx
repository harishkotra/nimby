import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ActionSheet } from './ActionSheet';
import { native, type Result } from './gallery';
import { ReadingStatus } from './ReadingStatus';
import { ActionLink, Body, Button, Chip, ErrorText, styles } from './ui';

export function QwenTagsSheet({ photo, close, changed }: { photo: Result; close: () => void; changed: () => void }) {
  const [saved, setSaved] = useState<string[] | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [noSuggestions, setNoSuggestions] = useState(false);
  const available = native?.productVisionStatus?.()?.installed === true;
  const source = photo.sourceKey ?? null;
  const dirty = saved != null && (saved.length !== selected.length || saved.some((tag) => !selected.includes(tag)));

  useEffect(() => {
    let active = true;
    native?.readQwenTags?.(photo.id).then((tags) => {
      if (!active) return;
      setSaved(tags);
      setChoices(tags);
      setSelected(tags);
    }).catch(() => { if (active) setError('Could not load this photo’s search tags.'); });
    return () => { active = false; };
  }, [photo.id]);

  async function suggest() {
    if (reading || !native?.suggestQwenTags) return;
    setReading(true);
    setError('');
    setNoSuggestions(false);
    try {
      const tags = await native.suggestQwenTags(photo.id, source);
      if (!tags.length) { setNoSuggestions(true); return; }
      const merged = [...new Set([...selected, ...tags, ...choices])].slice(0, 8);
      setChoices(merged);
      setSelected(merged.filter((tag) => selected.includes(tag) || (!choices.includes(tag) && tags.includes(tag))));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not suggest search tags.'); }
    finally { setReading(false); }
  }

  async function save() {
    if (saving || !native?.saveQwenTags) return;
    setSaving(true);
    setError('');
    try { await native.saveQwenTags(photo.id, source, selected); changed(); close(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save search tags.'); }
    finally { setSaving(false); }
  }

  return <ActionSheet title="Search tags" close={() => { if (!reading && !saving) close(); }}
    footer={dirty && <Button label={saving ? 'Saving tags…' : 'Save search tags'} disabled={reading || saving} run={() => void save()} />}>
    <View style={styles.column}>
      <Body>Qwen can suggest words for visible details. Choose which ones Nimby should use in Search.</Body>
      {saved === null && !error && <Body>Loading search tags…</Body>}
      {!!choices.length && <View style={styles.row}>{choices.map((tag) => <Chip key={tag} label={tag} selected={selected.includes(tag)}
        run={() => { if (!reading && !saving) setSelected((value) => value.includes(tag) ? value.filter((item) => item !== tag) : [...value, tag]); }} />)}</View>}
      {reading ? <ReadingStatus label="Qwen is reading this photo on your phone" /> : available ?
        <ActionLink label={choices.length ? 'Suggest more tags' : 'Suggest tags with Qwen'} disabled={saved === null || saving || selected.length >= 8}
          run={() => void suggest()} /> : <Body>Download Qwen in Explore or in Settings under On-device models.</Body>}
      {noSuggestions && <Body>Qwen didn’t find any tags to suggest.</Body>}
      {!!error && <ErrorText>{error}</ErrorText>}
    </View>
  </ActionSheet>;
}
