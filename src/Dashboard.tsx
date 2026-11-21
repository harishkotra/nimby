import { ActionMenu } from './ActionSheet';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type DimensionValue } from 'react-native';
import type { Feed, Overview, Result } from './gallery';
import { homeLeadAction } from './homeActions';
import { PhotoTile } from './PhotoGrid';
import { NimbyMascot } from './NimbyMascot';
import {
  ActionLink, Body, Button, color, ErrorText, formatBytes, Heading, Icon, type IconName,
  percent, SectionTitle, styles, Thumbnail, titleCase,
} from './ui';

const count = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString();
const measure = (n: number | null | undefined) => n == null ? '—' : formatBytes(n);
const chartPalette = ['#A4E3C3', '#8AC3CE', '#C4B4DD', '#E2C291', '#8BA699', '#546B61'];
const ratio = (a: number | null | undefined, b: number | null | undefined) => b ? Math.min(1, Math.max(0, (a ?? 0) / b)) : 0;
const widthPercent = (value: number) => `${value * 100}%` as DimensionValue;
type Links = {
  gallery: () => void; duplicates: () => void; archive: () => void;
  discover: (mode: Feed, category?: string) => void; recall: () => void; photoMap: () => void;
  connect: () => void; patterns: () => void; parallel: () => void; evolve: () => void;
};

function Action({ label, value, icon, run }: { label: string; value?: string; icon: IconName; run: () => void }) {
  return <Pressable accessibilityRole="button" onPress={run}
    style={({ pressed }) => [layout.action, pressed && styles.pressed]}>
    <View style={layout.actionIcon}><Icon name={icon} size={20} tint={color.blue} /></View>
    <View style={layout.actionText}><Text style={layout.actionName}>{label}</Text>{value && <Body>{value}</Body>}</View>
    <Icon name="chevron" size={16} tint={color.muted} />
  </Pressable>;
}

function Bar({ value, tint = color.blue }: { value: number; tint?: string }) {
  return <View style={layout.track}><View style={[layout.fill, { width: widthPercent(value), backgroundColor: tint }]} /></View>;
}

export function CoverageRing({ value, size }: { value: number | null; size: number }) {
  const total = (value ?? 0) * 360;
  const half = size / 2;
  const stroke = Math.round(size * 0.072);
  const halfCircle = (right: boolean, angle: number) => <View pointerEvents="none"
    style={{ position: 'absolute', overflow: 'hidden', top: 0, left: right ? half : 0, width: half, height: size }}>
    <View style={{ position: 'absolute', width: size, height: size, left: right ? -half : 0,
      transform: [{ rotate: `${angle}deg` }] }}>
      <View style={{ position: 'absolute', left: right ? 0 : half, width: half, height: size, backgroundColor: color.blue }} />
    </View>
  </View>;
  return <View accessibilityRole={value == null ? undefined : 'progressbar'}
    accessibilityLabel="Gallery analysis coverage" accessibilityValue={value == null ? undefined : { min: 0, max: 100, now: Math.round(value * 100) }}
    style={[layout.ring, { width: size, height: size, borderRadius: half }]}>
    {value != null && value > 0 && halfCircle(true, Math.min(total, 180))}
    {total > 180 && halfCircle(false, total - 180)}
    <View style={[layout.ringCenter, { top: stroke, left: stroke, right: stroke, bottom: stroke, borderRadius: half - stroke }]}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={[layout.ringValue, { fontSize: size * 0.235 }]}>{value == null ? '—' : percent(value)}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={layout.caption}>Analyzed</Text>
    </View>
  </View>;
}

export function HomeDashboard({ data, error, scan, pick, busy, previews, discovery, recentError, openPhoto, openScan, ...links }: Links & {
  data: Overview | null; error: boolean; scan: () => void; pick: () => void; busy: boolean;
  previews: Result[]; discovery: Result | null; recentError: boolean; openPhoto: (item: Result) => void; openScan: (id: string) => void;
}) {
  const activity = data?.history.find((record) => record.finished != null);
  const photos = previews.filter((item) => item.uri).slice(0, 3);
  const reviewed = activity ? activity.analyzed + activity.cached : 0;
  const lead = homeLeadAction(data);
  const coverage = data?.accessible == null ? null : ratio(data.analyzed, data.accessible);
  const awaiting = data?.awaiting ?? (data?.accessible != null && data.analyzed != null
    ? Math.max(0, data.accessible - data.analyzed) : null);
  const discoveryLabel = discovery?.category ?? (discovery?.kind ? titleCase(discovery.kind) : 'Saved reference');
  const revisit = () => links.discover('suggestions');
  const homeMood = lead === 'scan' ? 'scanning' as const : discovery?.uri ? 'discovering' as const : 'happy' as const;
  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={layout.intro}>
      <View style={styles.between}>
        <Heading large>Your gallery</Heading>
        <ActionMenu title="Add photos" label="Add photos" overflow disabled={busy} options={[
          ...(lead !== 'scan' ? [{ label: awaiting === 0 ? 'Check for new photos' : 'Scan more of your gallery', run: scan }] : []),
          { label: 'Choose an album', run: links.gallery },
          ...(lead !== 'pick' ? [{ label: 'Choose individual photos', run: pick }] : []),
        ]} />
      </View>
      <View style={layout.mascotRow}>
        <NimbyMascot state={homeMood} size={112} />
        <View style={layout.mascotCopy}>
          <Body>{data?.localAnalyzed
            ? `${data.localAnalyzed.toLocaleString()} photos analyzed on this device. Nothing leaves your phone.`
            : 'Scan your photos on this device to find receipts, screenshots, and other saved references.'}</Body>
        </View>
      </View>
    </View>
    {lead === 'scan' ? <Button label="Scan gallery" icon="scan" run={scan} disabled={busy} /> :
      lead === 'pick' ? <Button label="Choose photos" icon="image" run={pick} disabled={busy} /> :
      <Pressable accessibilityRole="button" accessibilityLabel="Find a photo" onPress={links.recall}
        style={({ pressed }) => [layout.searchHero, pressed && styles.faded]}>
        <Icon name="search" size={24} tint={color.blue} />
        <View style={layout.flex}><Heading>Find a photo</Heading><Body>Try “screenshots with text” or a word you remember</Body></View>
        <Icon name="chevron" tint={color.muted} />
      </Pressable>}
    {discovery?.uri && <View style={layout.section}>
      <SectionTitle title="Worth revisiting" action="See all picks" run={revisit} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Open suggested photo, ${discoveryLabel}`}
        onPress={() => openPhoto(discovery)} style={({ pressed }) => [layout.feature, pressed && styles.faded]}>
        <Thumbnail uri={discovery.uri} contain style={layout.featurePhoto} />
        <View style={layout.featureCaption}>
          <View style={layout.flex}><Heading>{discoveryLabel}</Heading><Body>Suggested by Eye</Body></View>
          <Icon name="chevron" size={18} tint={color.muted} />
        </View>
      </Pressable>
    </View>}
    {data && (coverage != null || awaiting != null) && <View style={layout.coverageStrip}>
      <View style={styles.between}>
        <Text style={layout.stripTitle}>{count(data.analyzed)} of {count(data.accessible)} photos analyzed</Text>
        <Text style={layout.stripPercent}>{coverage == null ? '—' : percent(coverage)}</Text>
      </View>
      <View style={layout.track}><View style={[layout.fill, { width: widthPercent(coverage ?? 0) }]} /></View>
      {!!awaiting && <Body>{count(awaiting)} still to scan</Body>}
    </View>}
    {!!error && <ErrorText>Gallery totals are temporarily unavailable.</ErrorText>}
    <View style={layout.section}>
      <SectionTitle title="Recently analyzed" action={photos.length ? 'See all' : undefined} run={() => links.discover('recent')} />
      {!!photos.length && <View style={layout.preview}>
        {photos.map((photo) => <View key={photo.id} style={layout.previewTile}>
          <PhotoTile uri={photo.uri} label={photo.name} press={() => openPhoto(photo)} />
        </View>)}
      </View>}
      {!photos.length && <Body>Analyzed photos will appear here.</Body>}
      {recentError && <ErrorText>Recent photos could not be loaded.</ErrorText>}
    </View>
    {activity && <View style={layout.section}>
      <Heading>Last scan</Heading>
      <Body>{new Date(activity.started).toLocaleDateString()} · {count(reviewed)} with results
        {activity.failed ? ` · ${count(activity.failed)} failed` : ''}</Body>
      {activity.hasResults && <ActionLink label="Review scan results" run={() => openScan(activity.id)} />}
    </View>}
    <View style={layout.section}>
      <Heading>Review photos</Heading>
      {!discovery?.uri && <Action icon="bookmark" label="Worth revisiting" value="A short list of saved references" run={revisit} />}
      <Action icon="layers" label="Duplicates" value={data ? `${count(data.duplicateGroups)} groups to review` : undefined} run={links.duplicates} />
      <Action icon="map" label="See where photos were taken" run={links.photoMap} />
    </View>
  </ScrollView>;
}

export function InsightsScreen({ data, error, ...links }: Links & { data: Overview | null; error: boolean }) {
  const [details, setDetails] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const { width } = useWindowDimensions();
  const coverage = data?.accessible == null ? null : ratio(data.analyzed, data.accessible);
  const categories = data?.categories ?? [];
  const totalCategories = categories.reduce((sum, item) => sum + item.count, 0);
  const maximumStorage = Math.max(1, data?.duplicateBytes ?? 0, data?.lowQualityBytes ?? 0);
  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={layout.intro}><Heading large>Insights</Heading><Body>A closer look at what’s in your gallery.</Body></View>
    {error && <ErrorText>Could not read the latest gallery totals.</ErrorText>}
    <View style={layout.coverage}>
      <CoverageRing value={coverage} size={Math.min(196, width * 0.50)} />
      <Text style={layout.chartTitle}>Gallery coverage</Text>
      {data?.accessible != null
        ? <Text style={layout.coverageCount}>{count(data.analyzed)} of {count(data.accessible)}</Text>
        : <Body>{data ? 'Allow photo access to measure coverage.' : 'Reading gallery coverage…'}</Body>}
      {data?.accessible != null && <Text style={layout.caption}>accessible photos analyzed</Text>}
      {data?.awaiting != null && <Text style={layout.insetLabel}>{count(data.awaiting)} still to scan</Text>}
      {data && data.accessible == null && <Button subtle label="Manage gallery access" run={links.gallery} />}
    </View>
    <View style={layout.section}>
      <Heading>Room to reclaim</Heading>
      <View style={layout.storage}>
        <View style={layout.intro}>
          <Text style={layout.saving}>{measure(data?.potentialBytes)}</Text>
          <Text style={layout.caption}>Estimated potential savings</Text>
        </View>
        {([
          ['Duplicate groups', data?.duplicateBytes, color.blue, links.duplicates],
          ['Low-quality candidates', data?.lowQualityBytes, chartPalette[3], () => links.discover('quality')],
        ] as const).map(([label, bytes, tint, run]) => <Pressable key={label} onPress={run} accessibilityRole="button"
          accessibilityLabel={`${label}, ${measure(bytes)}`} style={({ pressed }) => [layout.storageAction, pressed && styles.pressed]}>
          <View style={styles.between}><Text style={layout.actionName}>{label}</Text>
            <View style={styles.row}><Text style={layout.legendCount}>{measure(bytes)}</Text><Icon name="chevron" tint={color.muted} size={16} /></View>
          </View>
          <Bar value={ratio(bytes, maximumStorage)} tint={tint} />
        </Pressable>)}
      </View>
      <Pressable onPress={() => setDetails(!details)} accessibilityRole="button" accessibilityState={{ expanded: details }}
        style={styles.textAction}><Text style={styles.link}>Storage details</Text>
        <Icon name={details ? 'up' : 'down'} size={16} tint={color.blue} /></Pressable>
      {details && <View style={layout.details}>
        {([
          ['Accessible gallery', data?.galleryBytes],
          ['Reviewed archive candidates', data?.reviewedBytes],
          ['Archive media copies in Nimby', data?.archiveBytes],
          ['Archive metadata estimate', data?.archiveMetadataBytes],
          ['Originals associated with archive', data?.archivedOriginalBytes],
          ['Confirmed deleted file bytes', data?.reclaimed],
        ] as const).map(([label, value]) => <View key={label} style={layout.detail}><Text style={layout.caption}>{label}</Text>
          <Text style={layout.actionName}>{measure(value)}</Text></View>)}
        <Body>Potential savings exclude overlapping candidates. Confirmed deletions count original file sizes reported by Android.</Body>
        {!!data?.unknownSizes && <Body>{count(data.unknownSizes)} accessible photos have no reported file size.</Body>}
      </View>}
    </View>
    <View style={layout.section}>
      <Heading>Saved categories</Heading>
      {totalCategories > 0 ? <>
        <View accessible accessibilityLabel={categories.map((item) => `${item.name}: ${item.count}`).join(', ')} style={layout.stack}>
          {categories.map((item, index) => <View key={item.name} style={{ flex: item.count,
            backgroundColor: chartPalette[index % chartPalette.length] }} />)}
        </View>
        <View style={layout.legend}>
          {categories.map((item, index) => <Pressable key={item.name} accessibilityRole="button"
            onPress={() => links.discover('recent', item.name)}
            style={({ pressed }) => [layout.legendItem, pressed && styles.pressed]}>
            <View style={[layout.dot, { backgroundColor: chartPalette[index % chartPalette.length] }]} />
            <Text style={layout.legendText}>{item.name}</Text><Text style={layout.legendCount}>{count(item.count)}</Text>
          </Pressable>)}
        </View>
      </> : <Body>Category colors will appear as Eye finds photos worth revisiting.</Body>}
      <Action icon="image" label="Screenshots" value={data?.screenshots == null ? undefined : `${count(data.screenshots)} detected`}
        run={() => links.discover('screenshots')} />
      <Action icon="bookmark" label="Worth Revisiting" value={data ? `${count(data.worth)} photos` : undefined}
        run={() => links.discover('suggestions')} />
      <Action icon="archive" label="Archived photos" value={data ? `${count(data.archived)} in your archive` : undefined} run={links.archive} />
    </View>
    <View style={layout.section}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: exploreOpen }}
        onPress={() => setExploreOpen(!exploreOpen)} style={({ pressed }) => [layout.exploreToggle, pressed && styles.pressed]}>
        <Heading>Explore</Heading>
        <Icon name={exploreOpen ? 'up' : 'down'} size={18} tint={color.muted} />
      </Pressable>
      {exploreOpen && <>
        <Action icon="map" label="See where photos were taken" value="Explore where your photos were taken" run={links.photoMap} />
        <Action icon="clock" label="Timeline" value="Browse related moments" run={links.connect} />
        <Action icon="layers" label="Discover patterns" value="See themes that show up over time" run={links.patterns} />
        <Action icon="chevron" label="Plan from saved photos" value="Make a plan from saved photos" run={links.parallel} />
        <Action icon="check" label="Review past choices" value="Remember what worked" run={links.evolve} />
      </>}
    </View>
  </ScrollView>;
}

const layout = StyleSheet.create({
  intro: { gap: 8 },
  mascotRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  mascotCopy: { flex: 1, paddingRight: 4 },
  caption: { color: color.muted, fontSize: 13, fontWeight: '500' },
  searchHero: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, backgroundColor: color.tint, padding: 16, minHeight: 76 },
  feature: { borderRadius: 16, overflow: 'hidden', backgroundColor: color.white },
  featurePhoto: { aspectRatio: 2.1, maxHeight: 240, backgroundColor: color.black },
  featureCaption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  flex: { flex: 1 },
  section: { gap: 8 },
  preview: { flexDirection: 'row', gap: 8 },
  previewTile: { flex: 1, maxWidth: '45%' },
  action: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' },
  actionText: { flex: 1, gap: 2 },
  actionName: { color: color.ink, fontWeight: '600', fontSize: 15, flexShrink: 1 },
  coverageStrip: { backgroundColor: color.white, borderRadius: 16, padding: 14, gap: 8 },
  stripTitle: { color: color.ink, fontWeight: '600', fontSize: 14, flexShrink: 1 },
  stripPercent: { color: color.blue, fontWeight: '700', fontSize: 14, fontVariant: ['tabular-nums'] },
  coverage: { alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 8 },
  coverageCount: { color: color.ink, fontSize: 22, fontWeight: '600', letterSpacing: -0.6, fontVariant: ['tabular-nums'], textAlign: 'center' },
  ring: { overflow: 'hidden', backgroundColor: color.tint, marginBottom: 10 },
  ringCenter: { position: 'absolute', backgroundColor: color.paper, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, gap: 0 },
  ringValue: { color: color.ink, fontWeight: '600', letterSpacing: -1.6, fontVariant: ['tabular-nums'], maxWidth: '100%' },
  chartTitle: { color: color.ink, fontSize: 20, fontWeight: '600', textAlign: 'center' },
  insetLabel: { color: color.blue, fontSize: 13, fontWeight: '600', paddingVertical: 8 },
  stack: { flexDirection: 'row', height: 14, borderRadius: 10, overflow: 'hidden', gap: 2, marginTop: 7, marginBottom: 8 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, paddingBottom: 7 },
  legendItem: { minHeight: 48, flexDirection: 'row', gap: 5, alignItems: 'center', paddingRight: 12, maxWidth: '100%' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 13, color: color.ink, flexShrink: 1 },
  legendCount: { color: color.muted, fontSize: 13, fontVariant: ['tabular-nums'] },
  storage: { padding: 16, gap: 12, borderRadius: 16, backgroundColor: color.white },
  saving: { color: color.blue, fontSize: 28, fontWeight: '600', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  storageAction: { minHeight: 49, paddingVertical: 5, justifyContent: 'center', gap: 8 },
  track: { height: 6, borderRadius: 8, overflow: 'hidden', backgroundColor: color.rule },
  fill: { height: '100%', borderRadius: 8 },
  details: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: 6 },
  detail: { flexBasis: '47%', flexGrow: 1, gap: 2 },
  exploreToggle: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
