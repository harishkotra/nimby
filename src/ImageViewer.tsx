import { useState, type ReactNode } from 'react';
import { Keyboard, LayoutAnimation, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { color, Icon, IconButton, styles, Thumbnail, useReducedMotion } from './ui';

export function ImageViewer({ uri, label, album, close, children, summary = 'Photo details' }: {
  uri: string | null; label: string; album?: string | null; close: () => void; children?: ReactNode; summary?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();

  function toggle() {
    if (expanded) Keyboard.dismiss();
    if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.create(180, LayoutAnimation.Types.easeOut, LayoutAnimation.Properties.opacity));
    setExpanded(!expanded);
  }

  return <Modal visible hardwareAccelerated statusBarTranslucent navigationBarTranslucent
    animationType={reduced ? 'none' : 'fade'} onRequestClose={expanded ? toggle : close}>
    <SafeAreaView style={layout.shell}>
      <View style={layout.toolbar}>
        <IconButton icon="close" label="Close photo" run={close} style={layout.close} />
        <Text style={layout.album} numberOfLines={1}>{album || 'Photo'}</Text>
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
            <View style={layout.handleIcon}><Icon name="info" size={20} tint={color.deep} /></View>
            <Text style={layout.handleLabel}>{summary}</Text>
            <Icon name={expanded ? 'down' : 'up'} size={17} tint={color.muted} />
          </View>
        </Pressable>
        {expanded && <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled bounces={false}
          contentContainerStyle={layout.contents}>{children}</ScrollView>}
      </View>
    </SafeAreaView>
  </Modal>;
}

const layout = StyleSheet.create({
  shell: { flex: 1, backgroundColor: color.black },
  toolbar: { paddingHorizontal: 12, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 7 },
  close: { backgroundColor: color.white },
  album: { flex: 1, color: color.muted, fontSize: 13, textAlign: 'center' },
  toolbarSpacer: { width: 48 },
  media: { flex: 1, justifyContent: 'center' },
  image: { flex: 1, backgroundColor: color.black },
  scrim: { ...StyleSheet.absoluteFill, top: 56, backgroundColor: '#00000050' },
  sheet: { backgroundColor: color.white, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  expanded: { maxHeight: '79%' },
  handle: { flexShrink: 0, paddingHorizontal: 18, paddingTop: 9, paddingBottom: 9, gap: 7 },
  grabber: { alignSelf: 'center', backgroundColor: color.rule, width: 28, height: 4, borderRadius: 3 },
  handleRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10 },
  handleIcon: { backgroundColor: color.tint, alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 12 },
  handleLabel: { flex: 1, color: color.ink, fontSize: 16, fontWeight: '700' },
  contents: { paddingHorizontal: 18, paddingTop: 5, paddingBottom: 26, gap: 15 },
});
