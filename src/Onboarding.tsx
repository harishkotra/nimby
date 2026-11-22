import { useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NimbyMascot } from './NimbyMascot';
import { ActionLink, Button, color, Icon, IconButton, type IconName } from './ui';

const chapters = [
  { title: 'Your camera roll is a junk drawer.',
    description: 'Receipts you need to file, screenshots you meant to come back to, and trip photos buried in between.' },
  { title: 'Your phone. Your agent.',
    description: 'Nimby turns the photos you already saved into searchable memory. Photo analysis runs on your phone, even offline.' },
  { title: 'Find a photo by what you remember.',
    description: 'Search for a word on a bill. Nimby brings back the original photo and shows why it matched.' },
  { title: 'Remember it. Do something with it.',
    description: 'Keep a receipt, revisit a trip, or follow up on something you saved.' },
] as const;

type Finish = 'home' | 'scan';

export function Onboarding({ finish, saving, replay }: {
  finish: (action: Finish) => void; saving: boolean; replay: boolean;
}) {
  const [page, setPage] = useState(0);
  const [searched, setSearched] = useState(false);
  const [kept, setKept] = useState(false);
  const last = page === chapters.length - 1;
  const chapter = chapters[page];

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!saving) {
        if (page > 0) setPage(page - 1);
        else finish('home');
      }
      return true;
    });
    return () => subscription.remove();
  }, [page, finish, saving]);

  return <View style={layout.screen}>
    <View style={layout.navigation}>
      {page > 0
        ? <IconButton icon="back" label="Previous introduction screen" disabled={saving} run={() => setPage(page - 1)} />
        : <View style={layout.backSpace} />}
      <Text style={layout.progress} accessibilityLabel={`Introduction, step ${page + 1} of ${chapters.length}`}>
        {page + 1} of {chapters.length}
      </Text>
      <ActionLink label={replay ? 'Close' : 'Skip'} disabled={saving} run={() => finish('home')} />
    </View>
    <ScrollView key={page} style={layout.scroll} contentContainerStyle={layout.content}>
      <View style={layout.chapter}>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={layout.title}>{chapter.title}</Text>
        <Text style={layout.description}>{chapter.description}</Text>
        {page === 0 && <View style={layout.cameraRoll}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={layout.mascot}>
            <NimbyMascot state="thinking" size={112} />
          </View>
          <View style={layout.tiles}>
            <CameraTile icon="image" label="Trip photos" />
            <CameraTile icon="layers" label="Screenshots" />
            <CameraTile icon="archive" label="Receipts" />
          </View>
        </View>}
        {page === 1 && <View style={layout.local}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={layout.mascot}>
            <NimbyMascot state="scanning" size={112} />
          </View>
          <View style={layout.panel}>
            <Technique icon="scan" title="Desert Ant Eye sees" detail="Recognizes what’s in a photo." />
            <Technique icon="search" title="Local OCR reads" detail="Makes text in photos searchable." />
          </View>
        </View>}
        {page === 2 && <View style={layout.panel}>
          <Text style={layout.caption}>Sample search</Text>
          {searched
            ? <View style={[layout.technique, layout.query]}><Icon name="search" size={18} tint={color.blue} />
                <Text style={layout.itemTitle}>electricity</Text>
              </View>
            : <Button label="Try “electricity”" icon="search" subtle run={() => setSearched(true)} />}
          {searched && <View accessibilityLiveRegion="polite" style={layout.result}>
            <Receipt />
            <View style={layout.resultDetails}>
              <Text style={layout.itemTitle}>Electricity bill</Text>
              <Text style={layout.itemDetail}>Photo text · “Electricity”</Text>
              <Text style={layout.itemDetail}>Eye category · Documents</Text>
            </View>
          </View>}
        </View>}
        {last && <View style={layout.panel}>
          <Text style={layout.caption}>Sample photo</Text>
          <View accessibilityLiveRegion="polite" style={layout.result}>
            <Receipt />
            <View style={layout.resultDetails}>
              <Text style={layout.itemTitle}>Electricity bill</Text>
              <Text style={layout.itemDetail}>{kept ? 'Saved to Kept photos' : 'Tap Keep to find it again later.'}</Text>
            </View>
          </View>
          <Button label={kept ? 'Kept' : 'Keep'} icon={kept ? 'check' : 'bookmark'} subtle disabled={kept} run={() => setKept(true)} />
          <Text style={layout.path}>Recall → Discover → Decide → Evolve</Text>
        </View>}
      </View>
      <View style={layout.footer}>
        {last ? <>
          <Button label="Choose photos to scan" icon="image" disabled={saving} run={() => finish('scan')} />
          <Button label={replay ? 'Done' : 'Go to Home'} subtle disabled={saving} run={() => finish('home')} />
        </> : <Button label="Continue" run={() => setPage(page + 1)} />}
      </View>
    </ScrollView>
  </View>;
}

function CameraTile({ icon, label }: { icon: IconName; label: string }) {
  return <View style={layout.tile}>
    <Icon name={icon} size={22} tint={color.blue} />
    <Text style={layout.tileLabel}>{label}</Text>
  </View>;
}

function Technique({ icon, title, detail }: { icon: IconName; title: string; detail: string }) {
  return <View style={layout.technique}>
    <Icon name={icon} size={22} tint={color.blue} />
    <View style={layout.resultDetails}>
      <Text style={layout.itemTitle}>{title}</Text>
      <Text style={layout.itemDetail}>{detail}</Text>
    </View>
  </View>;
}

function Receipt() {
  return <View accessible={false} importantForAccessibility="no" style={layout.receipt}>
    <View style={layout.receiptHeading} />
    <View style={layout.receiptLine} /><View style={layout.receiptLine} /><View style={layout.receiptShortLine} />
  </View>;
}

const layout = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  navigation: { width: '100%', maxWidth: 536, alignSelf: 'center', flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center', minHeight: 56, paddingHorizontal: 24, gap: 8 },
  backSpace: { width: 48 },
  progress: { color: color.muted, fontSize: 14, fontVariant: ['tabular-nums'], textAlign: 'center', flexShrink: 1 },
  scroll: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'space-between', gap: 26, width: '100%', maxWidth: 536, alignSelf: 'center',
    paddingTop: 24, paddingHorizontal: 24, paddingBottom: 24 },
  chapter: { gap: 14 },
  title: { color: color.ink, fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.9 },
  description: { color: color.lightText, fontSize: 17, lineHeight: 25 },
  cameraRoll: { backgroundColor: color.tint, borderRadius: 22, marginTop: 8, padding: 14, gap: 10 },
  mascot: { alignSelf: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: 82, alignItems: 'center', backgroundColor: color.paper, padding: 9, borderRadius: 12, gap: 6 },
  tileLabel: { color: color.lightText, fontSize: 13, textAlign: 'center' },
  local: { gap: 8, marginTop: 8 },
  panel: { backgroundColor: color.white, borderRadius: 20, gap: 14, padding: 16, marginTop: 8 },
  technique: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  query: { backgroundColor: color.paper, borderRadius: 12, padding: 12 },
  caption: { color: color.blue, fontSize: 14, fontWeight: '600' },
  result: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 },
  resultDetails: { flex: 1, gap: 4 },
  itemTitle: { color: color.ink, fontWeight: '600', fontSize: 16 },
  itemDetail: { color: color.muted, fontSize: 14 },
  path: { color: color.blue, fontSize: 14, fontWeight: '600' },
  receipt: { width: 48, height: 62, backgroundColor: color.lightText, padding: 8, gap: 5, borderRadius: 5 },
  receiptHeading: { width: 25, height: 5, borderRadius: 2, backgroundColor: color.tint, marginBottom: 4 },
  receiptLine: { width: '100%', height: 2, borderRadius: 1, backgroundColor: color.tint, opacity: 0.45 },
  receiptShortLine: { width: 19, height: 2, borderRadius: 1, backgroundColor: color.tint, opacity: 0.45 },
  footer: { gap: 8 },
});
