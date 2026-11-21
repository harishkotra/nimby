import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActionSheet } from './ActionSheet';
import { native, type Result } from './gallery';
import { PhotoTile } from './PhotoGrid';
import { ReadingStatus } from './ReadingStatus';
import { visionSceneTerms } from './recallQuery';
import { ActionLink, Body, Chip, ErrorText, Heading, styles, Thumbnail } from './ui';

export function ReferenceSearchSheet({ uri, close, open, search }: {
  uri: string; close: () => void; open: (photo: Result) => void; search: (query: string) => void;
}) {
  const [matches, setMatches] = useState<Result[] | null>(null);
  const [terms, setTerms] = useState<string[] | null>(null);
  const [describing, setDescribing] = useState(false);
  const [matchError, setMatchError] = useState('');
  const [sceneError, setSceneError] = useState('');
  const hasQwen = native?.productVisionStatus?.().installed && !!native.describeReferenceScene;

  useEffect(() => {
    let active = true;
    native?.searchReferencePhoto?.(uri).then((results) => { if (active) setMatches(results); })
      .catch((cause) => { if (active) setMatchError(cause instanceof Error ? cause.message : 'Could not compare this photo.'); });
    return () => { active = false; };
  }, [uri]);

  async function describe() {
    const read = native?.describeReferenceScene;
    if (!read || describing) return;
    setDescribing(true);
    setSceneError('');
    try { setTerms(visionSceneTerms(await read(uri))); }
    catch (cause) { setSceneError(cause instanceof Error ? cause.message : 'Could not describe this scene.'); }
    finally { setDescribing(false); }
  }

  return <ActionSheet title="Similar photos" close={close}>
    <View style={styles.column}>
      <View style={layout.reference}>
        <Thumbnail uri={uri} label="Reference photo" style={layout.preview} />
        <View style={layout.copy}><Heading>Reference photo</Heading>
          <Body>Nimby looks for a similar scene, layout, or style on this phone. It doesn’t identify people.</Body>
        </View>
      </View>
      {!!matchError && <ErrorText>{matchError}</ErrorText>}
      {!matches && !matchError && <ReadingStatus label="Looking for similar photos" />}
      {matches && (matches.length ? <View style={layout.grid}>
        {matches.map((photo) => <View key={photo.id} style={layout.tile}>
          <PhotoTile uri={photo.uri} label={`Open similar photo ${photo.name}`} press={() => { close(); open(photo); }} />
        </View>)}
      </View> : <Body>No close visual matches among your scanned photos.</Body>)}
      {hasQwen && (matches || matchError) && <View style={layout.copy}>
        <Heading>Search the scene</Heading>
        <Body>Qwen can suggest words for visible objects, decor, or the type of venue.</Body>
        {describing ? <ReadingStatus label="Qwen is reading this image on your phone" /> :
          <ActionLink label={terms === null ? 'Suggest search terms' : 'Try again'} run={() => void describe()} />}
        {!!sceneError && <ErrorText>{sceneError}</ErrorText>}
        {terms && (terms.length ? <View style={styles.row}>
          {terms.map((term) => <Chip key={term} label={term} run={() => { close(); search(term); }} />)}
        </View> : <Body>Qwen didn’t find a scene detail to suggest.</Body>)}
      </View>}
    </View>
  </ActionSheet>;
}

const layout = StyleSheet.create({
  reference: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, gap: 6 },
  preview: { width: 72, height: 72, borderRadius: 12, overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 6 },
  tile: { width: '32%' },
});
