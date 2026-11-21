import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionLink, color, Heading, IconButton, styles } from './ui';

export function ActionSheet({ title, close, children, footer }: {
  title: string; close: () => void; children: ReactNode; footer?: ReactNode;
}) {
  return <Modal transparent visible hardwareAccelerated statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
    <SafeAreaView style={layout.backdrop}>
      <Pressable accessible={false} importantForAccessibility="no" onPress={close} style={StyleSheet.absoluteFill} />
      <View accessibilityViewIsModal style={layout.panel}>
        <View style={layout.header}><View style={layout.title}><Heading>{title}</Heading></View>
          <IconButton icon="close" label="Close sheet" run={close} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" style={layout.scroll} contentContainerStyle={layout.body}>
          {children}
        </ScrollView>
        {footer && <View style={layout.footer}>{footer}</View>}
      </View>
    </SafeAreaView>
  </Modal>;
}

type Option = { label: string; run: () => void; selected?: boolean; danger?: boolean };
export function ActionMenu({ title, label, overflow, options, disabled }: {
  title: string; label: string; overflow?: boolean; options: Option[]; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <ActionLink label={label} display={overflow ? '⋯' : undefined} disabled={disabled} run={() => setOpen(true)} />
    {open && <ActionSheet title={title} close={() => setOpen(false)}>
      {options.map((option) => <Pressable key={option.label} accessibilityRole="button"
        accessibilityState={{ selected: option.selected }} onPress={() => {
          setOpen(false);
          option.run();
        }} style={({ pressed }) => [layout.option, pressed && styles.faded]}>
        <Text style={[layout.optionText, option.danger && { color: color.danger }]}>{option.label}</Text>
        {option.selected && <Text style={styles.link}>✓</Text>}
      </Pressable>)}
    </ActionSheet>}
  </>;
}

const layout = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000A8' },
  panel: { alignSelf: 'center', width: '100%', maxWidth: 560, maxHeight: '90%', backgroundColor: color.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12 },
  title: { flex: 1 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 20, gap: 4 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.rule },
  option: { minHeight: 48, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.rule },
  optionText: { flex: 1, color: color.ink, fontSize: 16 },
});
