import { requireOptionalNativeModule } from 'expo';
import { requestPermissionsAsync } from 'expo-media-library/legacy';
import { Linking, PermissionsAndroid, Platform } from 'react-native';

export type Access = 'full' | 'limited' | 'none';
export type PermissionStatus = 'full' | 'limited' | 'denied' | 'revoked' | 'unrequested';
export type Photo = { uri: string; name: string; album: string };
export type Album = { id: string; uri: string; name: string; count: number };
export type Decision = 'new' | 'kept' | 'dismissed';
export type Feed = 'recent' | 'suggestions' | 'kept' | 'dismissed' | 'quality' | 'screenshots';

export type Result = {
  id: string;
  sourceKey?: string;
  uri: string | null;
  name: string;
  album: string | null;
  kind: string | null;
  confidence: number | null;
  category: string | null;
  tags: { label: string; confidence: number }[];
  decision: Decision;
  collection: string | null;
  similarity?: number;
  nearDuplicate?: boolean;
};

export type Scan = {
  runId: number;
  phase: 'idle' | 'preparing' | 'running' | 'paused' | 'matching' | 'complete' | 'cancelled' | 'blocked';
  total: number;
  processed: number;
  analyzed: number;
  cached: number;
  failed: number;
  errors: string[];
  problem: string | null;
  resultId: string | null;
};

export type ReviewCategory = { name: string; count: number; previews: string[] };

export type EyeStatus = {
  sdkVersion: string;
  packagedBytes: number | null;
  stagedBytes: number;
  filesReady: boolean;
  loaded: boolean;
  checkPhase: 'idle' | 'running' | 'passed' | 'failed';
  checkDurationMs: number | null;
  checkError: string | null;
  modelVersion: string | null;
  lastSuccess: number | null;
  lastInferenceMs: number | null;
  runtime: 'loading' | 'initialized' | 'unloaded' | 'error';
  runtimeError: string | null;
};

export type ScanRecord = { id: string; started: number; finished: number | null; phase: string;
  total: number; analyzed: number; cached: number; failed: number; resumable: boolean; hasResults: boolean };
export type Processing = { indexed: number; cacheBytes: number; lastScan: number | null;
  history: ScanRecord[]; excluded: { id: string; name: string }[] };
export type ArchivedPhoto = { id: string; uri: string | null; name: string; album: string; bytes: number;
  archived: number; eligible: number; canDelete: boolean };
export type Overview = {
  localAnalyzed: number; worth: number; archived: number; archivedOriginalBytes: number; archiveBytes: number; archiveMetadataBytes: number;
  reclaimed: number; reviewedBytes: number; duplicateGroups: number; duplicateBytes: number | null;
  accessible: number | null; analyzed: number | null; awaiting: number | null; screenshots: number | null;
  lowQuality: number | null; galleryBytes: number | null; unknownSizes: number | null;
  lowQualityBytes: number | null; potentialBytes: number | null;
  categories: { name: string; count: number }[]; history: ScanRecord[];
};
export type DuplicatePhoto = { uri: string; imageId: string; name: string; album: string; bytes: number;
  keeper: number | null; aesthetic: number | null };
export type DuplicateGroup = { id: string; photos: DuplicatePhoto[]; similarity: number | null };

type GalleryModule = {
  access(): Access;
  permissionStatus(requested: boolean): PermissionStatus;
  albums(): Promise<Album[]>;
  photos(album: string | null, cursor: string | null): Promise<{ items: Photo[]; next: string | null }>;
  pickPhotos(): Promise<string[]>;
  startScan(albums: string[], uris: string[]): void;
  scanStatus(): Scan;
  controlScan(action: 'pause' | 'resume' | 'cancel'): void;
  eyeStatus(): Promise<EyeStatus>;
  runEyeCheck(): Promise<void>;
  processing(): Promise<Processing>;
  resumeInterrupted(): Promise<void>;
  excludeAlbum(id: string, name: string, excluded: boolean): Promise<void>;
  clearAnalysis(all: boolean): Promise<void>;
  archivePage(offset: number): Promise<ArchivedPhoto[]>;
  archive(uris: string[]): Promise<number>;
  restore(uris: string[]): Promise<number>;
  deleteArchived(uris: string[]): Promise<{ approved: boolean; removed: number; requested: number }>;
  overview(): Promise<Overview>;
  duplicatePage(offset: number): Promise<DuplicateGroup[]>;
  markReviewed(uris: string[]): Promise<void>;
  feed(mode: Feed, group: string | null, offset: number, limit: number): Promise<Result[]>;
  reviewCategories(scanId: string | null): Promise<ReviewCategory[]>;
  revisitPicks(seen: string[]): Promise<Result[]>;
  scanFeed(scanId: string, category: string | null, offset: number, limit: number): Promise<Result[]>;
  groups(kept: boolean): Promise<string[]>;
  decide(id: string, decision: Decision, collection: string | null): Promise<void>;
  similar(id: string): Promise<Result[]>;
  openOriginal(id: string, source: string | null): Promise<void>;
};

export const native = requireOptionalNativeModule<GalleryModule>('NimbyGallery');

export function scanActive(scan?: Scan) {
  return scan?.phase === 'preparing' || scan?.phase === 'running' || scan?.phase === 'paused' || scan?.phase === 'matching';
}

export async function requestGalleryAccess(): Promise<{ access: Access; settings: boolean }> {
  if (!native) return { access: 'none', settings: false };
  if (Number(Platform.Version) >= 34) {
    const photos = PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES;
    const selected = 'android.permission.READ_MEDIA_VISUAL_USER_SELECTED' as typeof photos;
    const result = await PermissionsAndroid.requestMultiple([photos, selected]);
    native.permissionStatus(true);
    return { access: native.access(), settings: result[photos] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN };
  }
  const result = await requestPermissionsAsync(false, ['photo']);
  native.permissionStatus(true);
  return { access: native.access(), settings: !result.canAskAgain };
}

export const openSettings = () => Linking.openSettings();
