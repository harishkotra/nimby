import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, Icon, type IconName } from './ui';

type Tab<Destination extends string> = { name: Destination; label: string; icon: IconName };

const gutter = 12;
const maxWidth = 576;

export function BottomTabs<Destination extends string>({ tabs, selected, navigate }: {
  tabs: readonly Tab<Destination>[];
  selected: Destination;
  navigate: (name: Destination) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const available = Math.min(maxWidth, width - insets.left - insets.right - gutter * 2);
  const inline = available >= 496 * Math.max(1, fontScale);

  return <View style={layout.footer}>
    <View style={layout.bar} accessibilityRole="tablist">
      {tabs.map(({ name, icon, label }) => {
        const active = name === selected;
        return <Pressable key={name} accessibilityRole="tab" accessibilityLabel={label}
          accessibilityState={{ selected: active }} onPress={() => navigate(name)}
          android_ripple={{ color: active ? '#B6E4C925' : '#F2F4F11A' }}
          style={({ pressed }) => [layout.tab, inline && layout.inline, active && layout.active, pressed && layout.pressed]}>
          <Icon name={icon} size={22} tint={active ? color.blue : color.muted} />
          <Text style={[layout.label, active && layout.activeLabel]}>{label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

const layout = StyleSheet.create({
  footer: { paddingHorizontal: gutter, paddingTop: 4, paddingBottom: 8, alignItems: 'center', backgroundColor: color.paper },
  bar: { width: '100%', maxWidth, flexDirection: 'row', gap: 4, padding: 4, borderRadius: 24,
    backgroundColor: color.white, borderWidth: StyleSheet.hairlineWidth, borderColor: color.rule },
  tab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4,
    paddingVertical: 6, borderRadius: 19, overflow: 'hidden' },
  inline: { flexDirection: 'row', gap: 8 },
  active: { backgroundColor: '#35473C' },
  pressed: { opacity: 0.86 },
  label: { color: color.muted, fontSize: 12, fontWeight: '500', textAlign: 'center', flexShrink: 1 },
  activeLabel: { color: color.blue, fontWeight: '600' },
});
