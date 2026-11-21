import type { Result } from './gallery';

export type ConnectCandidate = {
  photo: Result;
  captured: number;
  place: string | null;
  lat: number | null;
  lon: number | null;
  related: string[];
};

export type ConnectPage = { items: ConnectCandidate[]; truncated: boolean };

type Match = 'time' | 'gps' | 'place' | 'visual';
type CorrectedEvent = { id: string; title: string; members: string[] };

export type ConnectCorrections = { version: 1; nextId: number; groups: CorrectedEvent[] };
export type ConnectEvent = {
  id: string;
  title: string;
  items: ConnectCandidate[];
  first: number;
  last: number;
  reasons: string[];
  confirmed: boolean;
};

const HOUR = 60 * 60 * 1000;
const linkWindow = 12 * HOUR;
const eventWindow = 24 * HOUR;
const reasons: Record<Match, string> = {
  time: 'Taken close together',
  gps: 'Taken at nearby locations',
  place: 'Share a saved place',
  visual: 'Eye found similar photos',
};

export const emptyCorrections: ConnectCorrections = { version: 1, nextId: 1, groups: [] };

export function parseCorrections(raw: string | null): ConnectCorrections {
  if (!raw) return emptyCorrections;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return emptyCorrections;
    const { version, nextId, groups } = value as Partial<ConnectCorrections>;
    if (version !== 1 || typeof nextId !== 'number' || !Number.isSafeInteger(nextId)
        || nextId < 1 || !Array.isArray(groups)) return emptyCorrections;
    const claimed = new Set<string>();
    const seen = new Set<string>();
    let maxId = 0;
    const corrected: CorrectedEvent[] = [];
    for (const item of groups) {
      if (!item || typeof item.id !== 'string' || !/^user:[1-9]\d*$/.test(item.id)
          || seen.has(item.id) || typeof item.title !== 'string' || !Array.isArray(item.members)) continue;
      const serial = Number(item.id.slice(5));
      if (!Number.isSafeInteger(serial) || serial >= Number.MAX_SAFE_INTEGER) continue;
      const members = item.members.filter((member: unknown): member is string => {
        if (typeof member !== 'string' || !member || claimed.has(member)) return false;
        claimed.add(member);
        return true;
      });
      if (!members.length) continue;
      seen.add(item.id);
      maxId = Math.max(maxId, serial);
      corrected.push({ id: item.id, title: item.title.trim().slice(0, 80), members });
    }
    return { version: 1, nextId: Math.max(nextId, maxId + 1), groups: corrected };
  } catch {
    return emptyCorrections;
  }
}

function distanceKm(a: ConnectCandidate, b: ConnectCandidate): number | null {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  if (![a.lat, b.lat].every((value) => Number.isFinite(value) && Math.abs(value) <= 90)
      || ![a.lon, b.lon].every((value) => Number.isFinite(value) && Math.abs(value) <= 180)) return null;
  const rad = Math.PI / 180;
  const lat = Math.sin((a.lat - b.lat) * rad / 2);
  const lon = Math.sin((a.lon - b.lon) * rad / 2);
  const distance = lat * lat + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * lon * lon;
  return 12_742 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, distance))));
}

function event(
  id: string, items: ConnectCandidate[], explanation: string[], confirmation: CorrectedEvent | null = null,
): ConnectEvent {
  const places = new Set(items.flatMap((item) => item.place ? [item.place] : []));
  const place = places.size === 1 ? places.values().next().value : null;
  const category = items.every((item) => item.photo.category === items[0].photo.category) ? items[0].photo.category : null;
  const title = confirmation?.title || place || category || (items.length === 1 ? 'One photo' : 'A moment together');
  return {
    id, items, title, first: items[0].captured, last: items[items.length - 1].captured, reasons: explanation,
    confirmed: confirmation !== null,
  };
}

export function buildEvents(input: ConnectCandidate[], corrections = emptyCorrections): ConnectEvent[] {
  const byId = new Map<string, ConnectCandidate>();
  const ordered = input.filter((item) => item.photo.uri && item.photo.decision !== 'dismissed'
    && Number.isFinite(item.captured) && item.captured > 0)
    .sort((a, b) => a.captured - b.captured || a.photo.id.localeCompare(b.photo.id));
  for (const item of ordered) if (!byId.has(item.photo.id)) byId.set(item.photo.id, item);

  const correctedEvents: ConnectEvent[] = [];
  for (const group of corrections.groups) {
    const items = group.members.flatMap((id) => {
      const item = byId.get(id);
      if (!item) return [];
      byId.delete(id);
      return [item];
    }).sort((a, b) => a.captured - b.captured);
    if (items.length) correctedEvents.push(event(group.id, items, ['Confirmed by you'], group));
  }

  const items = [...byId.values()];
  const leaders = items.map((_, index) => index);
  const starts = items.map((item) => item.captured);
  const ends = [...starts];
  const signals = items.map(() => new Set<Match>());
  const related = items.map((item) => new Set(item.related));

  function root(index: number): number {
    while (leaders[index] !== index) {
      leaders[index] = leaders[leaders[index]];
      index = leaders[index];
    }
    return index;
  }

  for (let right = 0; right < items.length; right++) {
    const b = items[right];
    for (let left = right - 1; left >= 0; left--) {
      const a = items[left];
      const gap = b.captured - a.captured;
      if (gap > linkWindow) break;
      const aRoot = root(left);
      const bRoot = root(right);
      if (aRoot === bRoot) continue;
      const start = Math.min(starts[aRoot], starts[bRoot]);
      const end = Math.max(ends[aRoot], ends[bRoot]);
      if (end - start > eventWindow) continue;
      const distance = distanceKm(a, b);
      const aPlace = a.place?.trim().toLowerCase();
      const bPlace = b.place?.trim().toLowerCase();
      if (distance != null && distance > 30) continue;
      const nearby = distance != null && distance <= 8;
      const samePlace = Boolean(aPlace && aPlace === bPlace);
      const visual = related[left].has(b.photo.id) || related[right].has(a.photo.id);
      const close = gap <= 45 * 60 * 1000 && !(aPlace && bPlace && aPlace !== bPlace && !nearby);
      if (!close && !nearby && !samePlace && !visual) continue;
      leaders[bRoot] = aRoot;
      starts[aRoot] = start;
      ends[aRoot] = end;
      for (const label of signals[bRoot]) signals[aRoot].add(label);
      if (close) signals[aRoot].add('time');
      if (nearby) signals[aRoot].add('gps');
      if (samePlace) signals[aRoot].add('place');
      if (visual) signals[aRoot].add('visual');
    }
  }

  const clustered = new Map<number, ConnectCandidate[]>();
  items.forEach((item, index) => {
    const key = root(index);
    const group = clustered.get(key);
    if (group) group.push(item);
    else clustered.set(key, [item]);
  });
  return [...correctedEvents, ...[...clustered].map(([key, members]) => event(
    `auto:${members[0].photo.id}`,
    members,
    [...signals[key]].map((signal) => reasons[signal]),
  ))].sort((a, b) => b.last - a.last || a.id.localeCompare(b.id));
}

function members(corrections: ConnectCorrections, value: ConnectEvent): string[] {
  return corrections.groups.find((group) => group.id === value.id)?.members ?? value.items.map((item) => item.photo.id);
}

function assign(corrections: ConnectCorrections, removed: string[], replacements: { title: string; members: string[] }[]) {
  const claimed = new Set(removed);
  const groups = corrections.groups.map((group) => ({
    ...group, members: group.members.filter((id) => !claimed.has(id)),
  })).filter((group) => group.members.length > 0);
  let nextId = corrections.nextId;
  for (const replacement of replacements) groups.push({ ...replacement, id: `user:${nextId++}` });
  return { version: 1 as const, nextId, groups };
}

export function renameEvent(corrections: ConnectCorrections, value: ConnectEvent, title: string): ConnectCorrections {
  const name = title.trim().slice(0, 80);
  if (!name) return corrections;
  if (value.confirmed) {
    return { ...corrections, groups: corrections.groups.map((group) => group.id === value.id ? { ...group, title: name } : group) };
  }
  const original = members(corrections, value);
  return assign(corrections, original, [{ title: name, members: original }]);
}

export function splitEvent(corrections: ConnectCorrections, value: ConnectEvent, selected: Set<string>): ConnectCorrections {
  const original = members(corrections, value);
  const visible = new Set(value.items.map((item) => item.photo.id));
  const separated = original.filter((id) => selected.has(id) && visible.has(id));
  const remaining = original.filter((id) => !separated.includes(id));
  if (!separated.length || separated.length === visible.size) return corrections;
  return assign(corrections, original, [
    { title: value.title, members: remaining },
    { title: '', members: separated },
  ]);
}

export function mergeEvents(corrections: ConnectCorrections, first: ConnectEvent, second: ConnectEvent): ConnectCorrections {
  if (first.id === second.id) return corrections;
  const combined = [...new Set([...members(corrections, first), ...members(corrections, second)])];
  return assign(corrections, combined, [{ title: first.title, members: combined }]);
}
