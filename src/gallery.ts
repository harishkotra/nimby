import { requireOptionalNativeModule } from 'expo';
import { requestPermissionsAsync } from 'expo-media-library/legacy';
import { Linking, PermissionsAndroid, Platform } from 'react-native';
import type { LegacyRecallSearch, RecallPage, RecallSearchOptions, RecallStatus, VisualSearchOptions } from './recallQuery';
import type { NextStepPhoto } from './nextStepFacts';

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
  discoveryReason?: string;
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
  automatic?: boolean;
};

export type AutoScanInterval = 'off' | 'daily' | 'weekly';
export type AutoScanStatus = {
  interval: AutoScanInterval;
  preferredInterval: Exclude<AutoScanInterval, 'off'>;
  chargingOnly: boolean;
  firstScanComplete: boolean;
  lastCheck: number | null;
  lastOutcome: 'complete' | 'access' | 'partial' | 'error' | null;
  analyzed: number;
  failed: number;
  more: boolean;
};

export type ReviewCategory = { name: string; count: number; previews: string[] };
export type PhotoLocationStatus = { enabled: boolean; permission: boolean; pending: number; mapped: number; running: boolean };
export type MapBounds = { south: number; west: number; north: number; east: number };
export type MapClusters = { clusters: { id: string; count: number; lat: number; lon: number }[]; total: number; bounds: MapBounds | null };
export type MapPage = { photos: (Result & { captured: number | null })[]; nextOffset: number | null };
export type PersonalCandidate = {
  photo: Result; captured: number; place: string | null; lat: number | null; lon: number | null; related: string[];
  sceneRelated?: string[];
};
export type PersonalSection = 'connect' | 'patterns' | 'evolve';

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
export type ProductVisionStatus = { supported: boolean; installed: boolean; phase: 'idle' | 'downloading' | 'reading';
  received: number; total: number };
export type FollowUpAction = 'schedule' | 'cancel' | 'done' | 'dismissed' | 'file';

type GalleryModule = {
  readLicense?(): Promise<string | null>;
  writeLicense?(record: string | null): Promise<void>;
  nextSteps?(photoId: string | null): Promise<NextStepPhoto[]>;
  nextStepNotificationStatus?(): { shopping: boolean; shoppingAvailable: boolean; remindersAvailable: boolean };
  setShoppingNotifications?(enabled: boolean): Promise<void>;
  savePhotoFollowUp?(id: string, action: FollowUpAction, due: number): Promise<void>;
  readShoppingText?(id: string): Promise<string | null>;
  productVisionStatus?(): ProductVisionStatus;
  installProductVision?(): Promise<void>;
  cancelProductVisionDownload?(): void;
  removeProductVision?(): Promise<void>;
  identifyProductImage?(id: string): Promise<string>;
  reviewReceiptImage?(id: string): Promise<string>;
  access(): Access;
  permissionStatus(requested: boolean): PermissionStatus;
  albums(): Promise<Album[]>;
  photos(album: string | null, cursor: string | null): Promise<{ items: Photo[]; next: string | null }>;
  pickPhotos(): Promise<string[]>;
  pickReferencePhoto?(): Promise<string | null>;
  searchReferencePhoto?(uri: string): Promise<Result[]>;
  searchReferencePhotoScoped?(uri: string, options: VisualSearchOptions): Promise<Result[]>;
  describeReferenceScene?(uri: string): Promise<string>;
  readQwenTags?(id: string): Promise<string[]>;
  suggestQwenTags?(id: string, source: string | null): Promise<string[]>;
  saveQwenTags?(id: string, source: string | null, tags: string[]): Promise<string[]>;
  searchablePlaces?(): Promise<string[]>;
  startScan(albums: string[], uris: string[]): Promise<void>;
  scanStatus(): Scan;
  controlScan(action: 'pause' | 'resume' | 'cancel'): void;
  autoScanStatus?(): Promise<AutoScanStatus>;
  configureAutoScan?(interval: AutoScanInterval, chargingOnly: boolean): Promise<AutoScanStatus>;
  requestMemoryBackfill(): Promise<void>;
  memoryStatus(): Promise<RecallStatus>;
  searchMemory: LegacyRecallSearch;
  searchRecall?(options: RecallSearchOptions, offset: number): Promise<RecallPage>;
  setMemoryPlace(imageId: string, place: string | null): Promise<void>;
  memoryPlace(imageId: string): Promise<string | null>;
  photoLocationStatus(): Promise<PhotoLocationStatus>;
  setPhotoLocationsEnabled(enabled: boolean): Promise<void>;
  clearPhotoLocations(): Promise<void>;
  mapPhotoClusters(south: number, west: number, north: number, east: number, zoom: number,
    start: number | null, end: number | null): Promise<MapClusters>;
  mapPhotoPage(bounds: [number, number, number, number], zoom: number,
    start: number | null, end: number | null, clusterId: string | null, offset: number): Promise<MapPage>;
  scanMapClusters?(scanId: string, zoom: number): Promise<MapClusters | null>;
  scanMapPhotoPage?(scanId: string, zoom: number, clusterId: string, offset: number): Promise<MapPage>;
  personalCandidates(start: number, end: number): Promise<{ items: PersonalCandidate[]; truncated: boolean }>;
  timelineCandidates?(start: number, end: number): Promise<{ items: PersonalCandidate[]; truncated: boolean }>;
  readPersonal(section: PersonalSection): Promise<string | null>;
  savePersonal(section: PersonalSection, data: string | null): Promise<void>;
  voiceStatus(): Promise<{ ready: boolean; bytes: number }>;
  installVoice(): Promise<void>;
  startVoice(): void;
  finishVoice(): Promise<string>;
  cancelVoice(): void;
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
  dailyDiscoveries?(): Promise<Result[]>;
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
