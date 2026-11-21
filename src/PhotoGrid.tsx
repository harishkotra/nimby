import type { ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions, type FlatListProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Thumbnail, color, styles } from './ui';

export function PhotoGrid<T>({ desired = 3, renderTile, ...props }: Omit<FlatListProps<T>, 'renderItem' | 'numColumns'> & {
  desired?: 2 | 3; renderTile: (item: T, width: number) => ReactNode;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const available = Math.max(120, width - insets.left - insets.right - 40);
  const columns = available >= 680 ? desired + 2 : available >= 500 ? desired + 1 : desired;
  const tile = Math.floor((available - (columns - 1) * 6) / columns);
  return <FlatList {...props} key={columns} numColumns={columns} columnWrapperStyle={grid.columns}
    initialNumToRender={12} windowSize={7} contentContainerStyle={[styles.content, grid.content, props.contentContainerStyle]}
    renderItem={({ item }) => <View style={{ width: tile }}>{renderTile(item, tile)}</View>} />;
}

export function PhotoTile({ uri, label, press, longPress, selected, fade, children, ratio = 1 }: {
  uri: string | null; label: string; press: () => void; longPress?: () => void; selected?: boolean;
  fade?: number; children?: ReactNode; ratio?: number;
}) {
  return <Pressable accessibilityRole={selected === undefined ? 'button' : 'checkbox'}
    accessibilityLabel={label} accessibilityState={selected === undefined ? undefined : { checked: selected }}
    onPress={press} onLongPress={longPress} style={({ pressed }) => [grid.tile, { aspectRatio: ratio }, pressed && { opacity: 0.82 }]}>
    <Thumbnail uri={uri} fade={fade} style={StyleSheet.absoluteFill} />
    {children}
    {selected !== undefined && <View style={[grid.marker, selected && grid.markerActive]}>
      {!!selected && <Icon name="check" size={15} tint={color.paper} />}
    </View>}
  </Pressable>;
}

const grid = StyleSheet.create({
  columns: { gap: 6 },
  content: { gap: 8 },
  tile: { backgroundColor: color.white, borderRadius: 10, overflow: 'hidden' },
  marker: { position: 'absolute', right: 7, top: 7, width: 25, height: 25, borderRadius: 13,
    borderWidth: 1.5, borderColor: color.ink, backgroundColor: '#151C19BB', alignItems: 'center', justifyContent: 'center' },
  markerActive: { backgroundColor: color.blue, borderColor: color.blue },
});
