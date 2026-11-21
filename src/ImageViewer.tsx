import { useState, type ReactNode } from 'react';
import { Keyboard, LayoutAnimation, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { color, Icon, IconButton, styles, Thumbnail, useReducedMotion } from './ui';

export function ImageViewer({ uri, label, album, subtitle, close, children, footer, summary = 'Photo details' }: {
  uri: string | null; label: string; album?: string | null; subtitle?: string | null;
  close: () => void; children?: ReactNode; summary?: string;
  footer?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();

  function changeExpanded(next: boolean) {
    if (next === expanded) return;
    if (!next) Keyboard.dismiss();
    if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.create(180, LayoutAnimation.Types.easeOut, LayoutAnimation.Properties.opacity));
    setExpanded(next);
  }
  const toggle = () => changeExpanded(!expanded);

  return <Modal visible hardwareAccelerated statusBarTranslucent navigationBarTranslucent
    animationType={reduced ? 'none' : 'fade'} onRequestClose={expanded ? toggle : close}>
    <SafeAreaView style={layout.shell}>
      <View style={layout.toolbar}>
        <IconButton icon="close" label="Close photo" run={close} style={layout.close} />
        <View style={layout.titleBlock}>
          <Text style={layout.album} numberOfLines={1}>{album || 'Photo'}</Text>
          {!!subtitle && <Text style={layout.subtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>
        <View style={layout.toolbarSpacer} />
      </View>
      <View style={layout.media} importantForAccessibility={expanded ? 'no-hide-descendants' : 'auto'}>
        <Thumbnail uri={uri} label={label} contain style={layout.image} />
      </View>
      {expanded && <Pressable accessibilityRole="button" accessibilityLabel="Collapse photo details" onPress={toggle} style={layout.scrim} />}
      <View style={[layout.sheet, expanded && layout.expanded]}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={toggle}
          style={({ pressed }) => [layout.handle, pressed && styles.faded]}>
          <View style={layout.grabber} />
          <View style={layout.handleRow}>
            <Text style={layout.handleLabel}>{summary}</Text>
            <Icon name={expanded ? 'down' : 'up'} size={18} tint={color.muted} />
          </View>
        </Pressable>
        {expanded && <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled bounces={false}
          contentContainerStyle={layout.contents}>{children}</ScrollView>}
        {footer && <View style={layout.footer}>{footer}</View>}
      </View>
    </SafeAreaView>
  </Modal>;
}

const layout = StyleSheet.create({
  shell: { flex: 1, backgroundColor: color.black },
  toolbar: { paddingHorizontal: 12, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8 },
  close: { backgroundColor: color.white },
  titleBlock: { flex: 1, alignItems: 'center', gap: 1 },
  album: { color: color.ink, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  subtitle: { color: color.muted, fontSize: 12, textAlign: 'center' },
  toolbarSpacer: { width: 48 },
  media: { flex: 1, justifyContent: 'center' },
  image: { flex: 1, backgroundColor: color.black },
  scrim: { ...StyleSheet.absoluteFill, top: 56, backgroundColor: '#00000050' },
  sheet: { backgroundColor: color.white, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  expanded: { maxHeight: '79%' },
  handle: { flexShrink: 0, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8, gap: 4 },
  grabber: { alignSelf: 'center', backgroundColor: color.rule, width: 28, height: 4, borderRadius: 3 },
  handleRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8 },
  handleLabel: { flex: 1, color: color.ink, fontSize: 16, fontWeight: '600' },
  contents: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20, gap: 16 },
  footer: { flexShrink: 0, paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.rule },
});
