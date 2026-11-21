import type { ConnectCandidate } from './connectTimeline';

const highlightLimit = 10;
const burstWindowMillis = 30_000;
const referenceCategories = new Set(['Screenshots', 'Documents', 'Receipts', 'Notes and whiteboards']);

function quality(score?: number | null) {
  return typeof score === 'number' && score >= 0 && score <= 1 ? score : -1;
}

function byCapture(a: ConnectCandidate, b: ConnectCandidate) {
  return a.captured - b.captured || a.photo.id.localeCompare(b.photo.id);
}

export function pickEventHighlights(candidates: readonly ConnectCandidate[]): ConnectCandidate[] {
  const photos = new Map<string, ConnectCandidate>();
  for (const candidate of candidates) {
    const { photo, captured } = candidate;
    if (!photo.uri || photo.decision === 'dismissed' || !Number.isFinite(captured) || captured <= 0) continue;
    if (photo.kind !== 'photo' && photo.kind !== 'selfie') continue;
    if (photo.category && referenceCategories.has(photo.category)) continue;
    if (!photos.has(photo.id)) photos.set(photo.id, candidate);
  }

  const parents = new Map<string, string>();
  function burst(id: string) {
    let parent = parents.get(id);
    while (parent !== undefined) {
      id = parent;
      parent = parents.get(id);
    }
    return id;
  }

  for (const photo of photos.values()) {
    for (const id of photo.related) {
      const match = photos.get(id);
      if (!match || Math.abs(photo.captured - match.captured) > burstWindowMillis) continue;
      const left = burst(photo.photo.id);
      const right = burst(id);
      if (left !== right) parents.set(right, left);
    }
  }

  const ranked = [...photos.values()].filter((item) => quality(item.aesthetic) >= 0).sort((a, b) =>
    quality(b.aesthetic) - quality(a.aesthetic) || quality(b.keeper) - quality(a.keeper) || byCapture(a, b));
  const picks = new Map<string, ConnectCandidate>();
  for (const item of ranked) {
    const group = burst(item.photo.id);
    if (!picks.has(group)) picks.set(group, item);
    if (picks.size === highlightLimit) break;
  }
  return [...picks.values()].sort(byCapture);
}
