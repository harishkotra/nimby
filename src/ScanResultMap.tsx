import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { native, type MapClusters } from './gallery';
import { PhotoMapView } from './PhotoMapView';
import { Body } from './ui';

export type ScanMapSelection = { id: string; zoom: number };
const overviewZoom = 4;

export function ScanResultMap({ scanId, revision, select, clear }: {
  scanId: string; revision: number; select: (scope: ScanMapSelection) => void; clear: () => void;
}) {
  const [map, setMap] = useState<MapClusters | null>(null);

  useEffect(() => {
    let live = true;
    setMap(null);
    native?.scanMapClusters?.(scanId, overviewZoom).then((result) => {
      if (live) {
        setMap(result);
        if (!result?.total) clear();
      }
    }).catch(() => { if (live) clear(); });
    return () => { live = false; };
  }, [scanId, revision, clear]);

  if (!map?.bounds || !map.total) return null;
  return <View style={layout.section}>
    <PhotoMapView style={layout.map} clusters={map.clusters} fit={JSON.stringify(map.bounds)} lockViewport
      onCluster={(id) => { if (map.clusters.some((cluster) => cluster.id === id)) select({ id, zoom: overviewZoom }); }}
      onError={() => { setMap(null); clear(); }} />
    <Body>{map.total.toLocaleString()} {map.total === 1 ? 'photo' : 'photos'} with locations</Body>
  </View>;
}

const layout = StyleSheet.create({
  section: { gap: 8 },
  map: { height: 244, borderRadius: 16, overflow: 'hidden' },
});
