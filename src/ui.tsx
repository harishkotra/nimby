import { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, Image, Pressable, StyleSheet, Text, View,
  type ImageSourcePropType, type StyleProp, type ViewStyle,
} from 'react-native';

export const color = {
  paper: '#101514', white: '#19211F', ink: '#EFF5F1', muted: '#A0B2A9', rule: '#2F3C36',
  blue: '#A4E3C3', tint: '#24392F', lightText: '#CFDFD5', deep: '#C5EBD8', danger: '#FFADAA',
  black: '#0A0E0D', amber: '#E2C291',
};

const icons = {
  home: require('./assets/icons/home.png'),
  gallery: require('./assets/icons/gallery.png'),
  insights: require('./assets/icons/insights.png'),
  archive: require('./assets/icons/archive.png'),
  settings: require('./assets/icons/settings.png'),
  scan: require('./assets/icons/scan.png'),
  chevron: require('./assets/icons/chevron.png'),
  down: require('./assets/icons/down.png'),
  up: require('./assets/icons/up.png'),
  close: require('./assets/icons/close.png'),
  check: require('./assets/icons/check.png'),
  back: require('./assets/icons/back.png'),
  spark: require('./assets/icons/spark.png'),
  external: require('./assets/icons/external.png'),
  info: require('./assets/icons/info.png'),
  clock: require('./assets/icons/clock.png'),
  layers: require('./assets/icons/layers.png'),
  image: require('./assets/icons/image.png'),
  bookmark: require('./assets/icons/bookmark.png'),
} satisfies Record<string, ImageSourcePropType>;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 21, tint = color.ink }: { name: IconName; size?: number; tint?: string }) {
  return <Image source={icons[name]} accessible={false} fadeDuration={0}
    style={{ width: size, height: size, tintColor: tint }} />;
}

export function IconButton({ icon, label, run, style }: {
  icon: IconName; label: string; run: () => void; style?: StyleProp<ViewStyle>;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={run}
    style={({ pressed }) => [styles.iconButton, pressed && styles.faded, style]}>
    <Icon name={icon} />
  </Pressable>;
}

export function Button({ label, run, subtle, disabled, style, icon }: {
  label: string; run: () => void; subtle?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; icon?: IconName;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={run}
    style={({ pressed }) => [styles.button, subtle && styles.subtle, (pressed || disabled) && styles.faded, style]}>
    {icon && <Icon name={icon} size={19} tint={subtle ? color.deep : color.paper} />}
    <Text style={[styles.buttonText, subtle && styles.subtleText]}>{label}</Text>
  </Pressable>;
}

export function Chip({ label, run, selected }: { label: string; run: () => void; selected?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={run}
    style={({ pressed }) => [styles.chip, selected && styles.selected, pressed && styles.faded]}>
    <Text style={[styles.chipText, selected && styles.selectedText]}>{label}</Text>
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

export function EmptyState({ icon, title, text, action }: {
  icon: IconName; title: string; text: string; action?: ReactNode;
}) {
  return <View style={styles.empty}>
    <View style={styles.emptyIcon}><Icon name={icon} size={23} tint={color.blue} /></View>
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
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 32, gap: 22 },
  button: { backgroundColor: color.blue, borderRadius: 16, minHeight: 48, paddingHorizontal: 15,
    paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { flexShrink: 1, fontWeight: '700', fontSize: 14, textAlign: 'center', color: color.paper },
  subtle: { backgroundColor: color.tint },
  subtleText: { color: color.deep },
  faded: { opacity: 0.66 },
  iconButton: { height: 48, width: 48, borderRadius: 24, backgroundColor: color.white, alignItems: 'center', justifyContent: 'center' },
  chip: { backgroundColor: color.white, borderRadius: 24, minHeight: 48, justifyContent: 'center', paddingHorizontal: 15 },
  selected: { backgroundColor: color.blue },
  selectedText: { color: color.paper },
  chipText: { color: color.ink, fontWeight: '600', fontSize: 13 },
  heading: { fontFamily: 'sans-serif-medium', color: color.ink, fontSize: 23, letterSpacing: -0.5 },
  largeHeading: { fontSize: 36, lineHeight: 40, letterSpacing: -1.3 },
  body: { color: color.muted, fontSize: 14, lineHeight: 21 },
  error: { color: color.danger, fontSize: 14, lineHeight: 20 },
  link: { color: color.blue, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  textAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  imageContainer: { backgroundColor: color.white, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  unavailable: { alignItems: 'center', justifyContent: 'center', gap: 6, padding: 4 },
  empty: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 18, gap: 9 },
  emptyIcon: { height: 52, width: 52, borderRadius: 17, backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: color.ink, fontWeight: '700', fontSize: 16, textAlign: 'center' },
  centered: { textAlign: 'center' },
});
