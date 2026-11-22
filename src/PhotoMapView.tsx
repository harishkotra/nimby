import { requireNativeView } from 'expo';
import { useMemo } from 'react';
import { Linking, Pressable, StyleSheet, Text, View, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import type { MapBounds, MapClusters } from './gallery';
import { color } from './ui';

export type MapViewport = MapBounds & { zoom: number };
type NativeProps = ViewProps & {
  points: string;
  fit?: string;
  lockViewport?: boolean;
  onViewport: (event: NativeSyntheticEvent<MapViewport>) => void;
  onCluster: (event: NativeSyntheticEvent<{ id: string }>) => void;
  onMapError: (event: NativeSyntheticEvent<{ message: string }>) => void;
};

export function PhotoMapView({ clusters, fit, lockViewport, onViewport, onCluster, onError, style }: {
  clusters: MapClusters['clusters']; fit?: string; lockViewport?: boolean;
  onViewport?: (viewport: MapViewport) => void; onCluster: (id: string) => void; onError: (message: string) => void;
  style?: ViewProps['style'];
}) {
  const MapView = useMemo(() => requireNativeView<NativeProps>('NimbyPhotoMap'), []);
  const points = useMemo(() => JSON.stringify({ type: 'FeatureCollection', features: clusters.map((point) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [point.lon, Math.max(-85.05112878, Math.min(85.05112878, point.lat))] },
    properties: { clusterId: point.id, count: point.count },
  })) }), [clusters]);

  return <View style={[layout.map, style]}>
    <MapView style={layout.surface} points={points} fit={fit} {...(lockViewport ? { lockViewport } : {})}
      importantForAccessibility="no-hide-descendants"
      onViewport={({ nativeEvent }) => { if (nativeEvent) onViewport?.(nativeEvent); }}
      onCluster={({ nativeEvent }) => { if (nativeEvent) onCluster(nativeEvent.id); }}
      onMapError={({ nativeEvent }) => onError(nativeEvent.message)} />
    <Pressable accessibilityRole="link" accessibilityLabel="OpenStreetMap contributors and license" style={layout.attribution}
      onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright').catch(() => {})}>
      <Text style={layout.attributionText}>© OpenStreetMap contributors</Text>
    </Pressable>
  </View>;
}

const layout = StyleSheet.create({
  map: { backgroundColor: '#142128' },
  surface: { flex: 1 },
  attribution: { position: 'absolute', bottom: 4, right: 8, minHeight: 48, justifyContent: 'flex-end' },
  attributionText: { padding: 4, color: color.lightText, backgroundColor: color.paper, fontSize: 11 },
});
