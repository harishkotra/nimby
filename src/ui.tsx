import { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, Image, Pressable, StyleSheet, Text, View,
  type ImageSourcePropType, type StyleProp, type ViewStyle,
} from 'react-native';
import { NimbyMascot, type MascotState } from './NimbyMascot';

export const color = {
  paper: '#151716', white: '#202321', ink: '#F2F4F1', muted: '#A6ADA8', rule: '#393E3A',
  blue: '#B6E4C9', tint: '#2B3730', lightText: '#D5DBD6', deep: '#D5DBD6', danger: '#FFB4AB',
  black: '#101211', amber: '#E2C291',
};

const icons = {
  home: require('./assets/icons/home.png'),
  gallery: require('./assets/icons/gallery.png'),
  insights: require('./assets/icons/insights.png'),
  archive: require('./assets/icons/archive.png'),
  settings: require('./assets/icons/settings.png'),
  scan: require('./assets/icons/scan.png'),
  search: require('./assets/icons/search.png'),
  mic: require('./assets/icons/mic.png'),
  map: require('./assets/icons/map.png'),
  chevron: require('./assets/icons/chevron.png'),
  down: require('./assets/icons/down.png'),
  up: require('./assets/icons/up.png'),
  close: require('./assets/icons/close.png'),
  check: require('./assets/icons/check.png'),
  back: require('./assets/icons/back.png'),
  external: require('./assets/icons/external.png'),
  info: require('./assets/icons/info.png'),
  clock: require('./assets/icons/clock.png'),
  layers: require('./assets/icons/layers.png'),
  image: require('./assets/icons/image.png'),
  bookmark: require('./assets/icons/bookmark.png'),
} satisfies Record<string, ImageSourcePropType>;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 20, tint = color.ink }: { name: IconName; size?: number; tint?: string }) {
  return <Image source={icons[name]} accessible={false} fadeDuration={0}
    style={{ width: size, height: size, tintColor: tint }} />;
}

export function IconButton({ icon, label, run, style, disabled }: {
  icon: IconName; label: string; run: () => void; style?: StyleProp<ViewStyle>; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={run}
    style={({ pressed }) => [styles.iconButton, disabled && styles.faded, pressed && styles.pressed, style]}>
    <Icon name={icon} />
  </Pressable>;
}

export function ActionLink({ label, display, run, disabled, danger }: {
  label: string; display?: string; run: () => void; disabled?: boolean; danger?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={run} style={({ pressed }) => [styles.textAction, { minWidth: 48 },
      display && { justifyContent: 'center' }, (pressed || disabled) && styles.faded]}>
    <Text style={[styles.link, danger && { color: color.danger }, display && { fontSize: 24 }]}>{display ?? label}</Text>
  </Pressable>;
}

export function Segments<T extends string>({ options, value, select }: {
  options: readonly { value: T; label: string }[]; value: T; select: (value: T) => void;
}) {
  return <View accessibilityRole="radiogroup" style={styles.segments}>{options.map((option) => <Pressable key={option.value} accessibilityRole="radio"
    accessibilityState={{ checked: option.value === value }} onPress={() => { if (option.value !== value) select(option.value); }}
    style={({ pressed }) => [styles.segment, option.value === value && styles.activeSegment, pressed && styles.faded]}>
    <Text style={[styles.segmentText, option.value === value && { color: color.ink }]}>{option.label}</Text>
  </Pressable>)}</View>;
}

export function Button({ label, run, subtle, disabled, style, icon, destructive }: {
  label: string; run: () => void; subtle?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; icon?: IconName; destructive?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={run}
    style={({ pressed }) => [
      styles.button, subtle && styles.subtle, destructive && styles.destructive,
      pressed && !disabled && styles.pressed, disabled && styles.faded, style,
    ]}>
    {icon && <Icon name={icon} size={20} tint={subtle ? color.deep : color.paper} />}
    <Text style={[styles.buttonText, subtle && styles.subtleText]}>{label}</Text>
  </Pressable>;
}

export function Chip({ label, run, selected, remove }: { label: string; run: () => void; selected?: boolean; remove?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={remove ? `Remove ${label} filter` : label}
    accessibilityState={{ selected }} onPress={run}
    style={({ pressed }) => [styles.chip, selected && styles.selected, pressed && styles.pressed]}>
    <Text style={[styles.chipText, selected && styles.selectedText]}>{label}</Text>
    {remove && <Icon name="close" size={16} tint={selected ? color.paper : color.ink} />}
  </Pressable>;
}

export function Thumbnail({ uri, contain = false, label, style, fade = 0 }: {
  uri: string | null; contain?: boolean; label?: string; style?: StyleProp<ViewStyle>; fade?: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return <View style={[styles.imageContainer, style]}>
    {uri && failed !== uri
      ? <Image key={uri} source={{ uri }} accessible={Boolean(label)} accessibilityLabel={label} fadeDuration={fade}
          resizeMethod="resize" resizeMode={contain ? 'contain' : 'cover'} style={StyleSheet.absoluteFill}
          onError={() => setFailed(uri)} />
      : <View style={styles.unavailable} accessible accessibilityLabel="Photo unavailable">
          <Icon name="image" size={18} tint={color.muted} />
          {contain && <Text style={styles.body}>Photo unavailable</Text>}
        </View>}
  </View>;
}

export function Body({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export function Heading({ children, large }: { children: ReactNode; large?: boolean }) {
  return <Text accessibilityRole="header" style={[styles.heading, large && styles.largeHeading]}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{children}</Text>;
}

export function SectionTitle({ title, action, run }: { title: string; action?: string; run?: () => void }) {
  return <View style={styles.between}>
    <Heading>{title}</Heading>
    {action && run && <Pressable accessibilityRole="button" onPress={run}
      style={({ pressed }) => [styles.textAction, pressed && styles.faded]}>
      <Text style={styles.link}>{action}</Text><Icon name="chevron" size={16} tint={color.blue} />
    </Pressable>}
  </View>;
}

export type MascotMood = MascotState;

export function EmptyState({ icon, title, text, action, mascot }: {
  icon: IconName; title: string; text: string; action?: ReactNode; mascot?: MascotMood;
}) {
  return <View style={styles.empty}>
    {mascot
      ? <NimbyMascot state={mascot} size={96} />
      : <View style={styles.emptyIcon}><Icon name={icon} size={20} tint={color.blue} /></View>}
    <Text style={styles.emptyTitle}>{title}</Text>
    <Text style={[styles.body, styles.centered]}>{text}</Text>
    {action}
  </View>;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduced(value); }).catch(() => {});
    return () => { active = false; listener.remove(); };
  }, []);
  return reduced;
}

export const titleCase = (value: string) => value.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
export const percent = (value: number) => `${Math.round(value * 100)}%`;
export const formatBytes = (bytes: number | null) => bytes === null ? 'Unavailable' :
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` :
  bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` :
  bytes >= 1e3 ? `${(bytes / 1e3).toFixed(1)} KB` : `${bytes} B`;

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  between: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  column: { gap: 12 },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 24 },
  button: { backgroundColor: color.ink, borderRadius: 12, minHeight: 48, paddingHorizontal: 16,
    paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { flexShrink: 1, fontWeight: '600', fontSize: 14, textAlign: 'center', color: color.paper },
  subtle: { backgroundColor: color.white, borderWidth: StyleSheet.hairlineWidth, borderColor: color.rule },
  destructive: { backgroundColor: color.danger },
  subtleText: { color: color.deep },
  faded: { opacity: 0.66 },
  pressed: { opacity: 0.92, transform: [{ scale: 0.97 }] },
  iconButton: { height: 48, width: 48, borderRadius: 12, backgroundColor: color.white, alignItems: 'center', justifyContent: 'center' },
  chip: { backgroundColor: color.white, borderRadius: 12, minHeight: 48, minWidth: 48, maxWidth: '100%',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  segments: { flexDirection: 'row', borderRadius: 12, padding: 3, gap: 3, backgroundColor: color.black },
  segment: { flex: 1, minHeight: 48, borderRadius: 9, justifyContent: 'center', alignItems: 'center', padding: 6 },
  activeSegment: { backgroundColor: color.tint },
  segmentText: { color: color.muted, fontWeight: '600', fontSize: 14, textAlign: 'center' },
  selected: { backgroundColor: color.blue },
  selectedText: { color: color.paper },
  chipText: { color: color.ink, fontWeight: '600', fontSize: 13, flexShrink: 1 },
  heading: { fontFamily: 'sans-serif-medium', color: color.ink, fontSize: 22, letterSpacing: -0.3 },
  largeHeading: { fontSize: 34, lineHeight: 40, letterSpacing: -1 },
  body: { color: color.muted, fontSize: 14, lineHeight: 21 },
  error: { color: color.danger, fontSize: 14, lineHeight: 20 },
  link: { color: color.blue, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  textAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  imageContainer: { backgroundColor: color.white, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  unavailable: { alignItems: 'center', justifyContent: 'center', gap: 6, padding: 4 },
  empty: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 18, gap: 9 },
  emptyIcon: { height: 52, width: 52, borderRadius: 17, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' },
  emptyMascot: { width: 88, height: 88 },
  emptyTitle: { color: color.ink, fontWeight: '700', fontSize: 16, textAlign: 'center' },
  centered: { textAlign: 'center' },
});
