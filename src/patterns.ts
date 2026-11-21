import type { Result } from './gallery';

export type PatternCandidate = {
  photo: Result;
  captured: number;
  place: string | null;
  lat: number | null;
  lon: number | null;
  related: string[];
};

export type ConfirmedPatternGroup = { title: string; photoIds: string[] };
export type PatternFeedback = {
  id: string;
  label: string;
  action: 'confirmed' | 'corrected' | 'hidden';
  at: number;
};

type Theme = {
  id: string;
  title: string;
  evidence: string;
  matches: (photo: Result) => boolean;
};

export type PhotoPattern = {
  id: string;
  title: string;
  evidence: string;
  dates: number;
  members: PatternCandidate[];
  groupNames: string[];
  feedback?: PatternFeedback;
};

const labelKey = (label: string) => label.trim().toLowerCase().replace(/[\s-]+/g, '_');
const referenceTheme = (category: string, title = category): Theme => ({
  id: `category:${labelKey(category)}`,
  title,
  evidence: `Eye categorized these as ${category.toLowerCase()}`,
  matches: (photo) => photo.category === category,
});
const visualTheme = (id: string, title: string, evidence: string, labels: string[]): Theme => ({
  id: `theme:${id}`, title, evidence: `Eye identified ${evidence} in these photos`,
  matches: (photo) => photo.tags.some(({ label, confidence }) =>
    confidence >= 0.7 && labels.includes(labelKey(label))),
});

const themes = [
  referenceTheme('Shopping references'),
  referenceTheme('Notes and whiteboards'),
  referenceTheme('Screenshots', 'Screenshots to revisit'),
  visualTheme('outdoors', 'Outdoors', 'outdoor places', ['beach', 'mountain', 'forest', 'hiking', 'trail', 'camping', 'waterfall']),
  visualTheme('food', 'Food and cooking', 'food or cooking', ['food', 'cooking', 'meal', 'dessert', 'baking', 'dish', 'recipe']),
  visualTheme('pets', 'Pets and animals', 'animals', ['pet', 'dog', 'cat', 'bird', 'animal', 'wildlife']),
  visualTheme('making', 'Projects and ideas', 'plans or repair references', ['repair_reference', 'diagram', 'sketch', 'craft', 'diy']),
  visualTheme('places', 'Places and architecture', 'buildings or street scenes', ['architecture', 'building', 'cityscape', 'landmark', 'street']),
];

function usable(candidate: PatternCandidate) {
  const { photo, captured } = candidate;
  // Discover applies a narrow set of themes and withholds known sensitive reference types.
  return !!photo.uri && photo.decision !== 'dismissed' && Number.isFinite(captured) && captured > 0 &&
    !['document', 'receipt', 'medical_reference'].includes(labelKey(photo.kind ?? '')) &&
    !['documents', 'receipts'].includes(labelKey(photo.category ?? '')) &&
    !photo.tags.some(({ label }) =>
      /(^|_)(?:medical|health|identity|passport|bank|financial|private|sensitive|nsfw|nudity|sexual|religion|politics)(_|$)/.test(labelKey(label)));
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function readPatternFeedback(value: string | null): PatternFeedback[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (parsed?.version !== 1 || !Array.isArray(parsed.records)) return [];
    return parsed.records.filter((entry: Partial<PatternFeedback> | null): entry is PatternFeedback =>
      entry != null && typeof entry.id === 'string' && typeof entry.label === 'string' &&
      typeof entry.at === 'number' && Number.isFinite(entry.at) &&
      ['confirmed', 'corrected', 'hidden'].includes(entry.action ?? ''));
  } catch {
    return [];
  }
}

export function writePatternFeedback(records: PatternFeedback[]): string {
  return JSON.stringify({ version: 1, records });
}

export function buildPhotoPatterns(
  candidates: PatternCandidate[],
  feedback: PatternFeedback[],
  confirmedGroups: ConfirmedPatternGroup[] = [],
): PhotoPattern[] {
  const distinct = new Map<string, PatternCandidate>();
  for (const candidate of candidates) {
    if (!usable(candidate)) continue;
    const previous = distinct.get(candidate.photo.id);
    if (!previous) {
      distinct.set(candidate.photo.id, candidate);
      continue;
    }
    const latest = candidate.captured > previous.captured ? candidate : previous;
    distinct.set(candidate.photo.id, { ...latest, related: [...new Set([...previous.related, ...candidate.related])] });
  }

  const parent = new Map([...distinct.keys()].map((id) => [id, id]));
  const root = (id: string): string => {
    let ancestor = id;
    while (parent.get(ancestor) !== ancestor) ancestor = parent.get(ancestor)!;
    while (id !== ancestor) {
      const next = parent.get(id)!;
      parent.set(id, ancestor);
      id = next;
    }
    return ancestor;
  };
  for (const [id, candidate] of distinct) {
    for (const other of candidate.related) {
      if (distinct.has(other)) parent.set(root(other), root(id));
    }
  }

  const ranked = [...distinct.values()].sort((a, b) => b.captured - a.captured || a.photo.id.localeCompare(b.photo.id));
  const decisions = new Map(feedback.map((record) => [record.id, record]));
  const patterns: PhotoPattern[] = [];

  for (const theme of themes) {
    const families = new Set<string>();
    const days = new Set<string>();
    const members: PatternCandidate[] = [];
    for (const item of ranked) {
      if (!theme.matches(item.photo)) continue;
      const family = root(item.photo.id);
      const day = dayKey(item.captured);
      if (families.has(family) || days.has(day)) continue;
      families.add(family);
      days.add(day);
      members.push(item);
    }
    if (days.size < 3) continue;
    const decision = decisions.get(theme.id);
    if (decision?.action === 'hidden') continue;
    const memberIds = new Set(members.map(({ photo }) => photo.id));
    const groupNames = [...new Set(confirmedGroups.filter(({ photoIds }) =>
      photoIds.some((id) => memberIds.has(id))).map(({ title }) => title.trim()).filter(Boolean))].slice(0, 2);
    patterns.push({
      id: theme.id,
      title: decision?.action === 'corrected' && decision.label.trim() ? decision.label : theme.title,
      dates: days.size,
      members,
      evidence: theme.evidence,
      groupNames,
      feedback: decision,
    });
  }

  return patterns.sort((a, b) =>
    Number(Boolean(b.feedback)) - Number(Boolean(a.feedback)) ||
    b.dates - a.dates ||
    Number(b.id.startsWith('category:')) - Number(a.id.startsWith('category:')) ||
    b.members[0].captured - a.members[0].captured ||
    a.title.localeCompare(b.title)).slice(0, 4);
}
