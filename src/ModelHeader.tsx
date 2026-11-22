import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Body, color, Heading, Icon, styles } from './ui';

export function ModelHeader({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);

  return <View style={layout.group}>
    <View style={layout.header}>
      <View style={layout.title}><Heading>{title}</Heading>{children}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Why ${title}?`}
        accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.iconButton, expanded && layout.expanded, pressed && styles.pressed]}>
        <Icon name="info" tint={expanded ? color.blue : color.muted} />
      </Pressable>
    </View>
    {expanded && <View style={layout.help}><Body>{help}</Body></View>}
  </View>;
}

const layout = StyleSheet.create({
  group: { gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, gap: 2 },
  expanded: { backgroundColor: color.tint },
  help: { backgroundColor: color.tint, borderRadius: 12, padding: 12 },
});
