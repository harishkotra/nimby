export type OutcomeRating = 'helpful' | 'not_helpful' | 'not_tried';

export type Outcome = { rating: OutcomeRating; note: string; at: number };
export type EvolveChoiceInput = {
  id: string;
  at: number;
  actionId: string;
  title: string;
  photoIds: string[];
  constraints: string;
};
export type EvolveChoice = EvolveChoiceInput & { outcome?: Outcome };
export type EvolveState = { version: 1; choices: EvolveChoice[] };
export type CorrectionSection = 'patterns' | 'connect';
export type Correction = { id: string; title: string; detail: string; at?: number };

const emptyState: EvolveState = { version: 1, choices: [] };
const validDate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;
const isRating = (value: unknown): value is OutcomeRating =>
  value === 'helpful' || value === 'not_helpful' || value === 'not_tried';

function decode(raw: string | null): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null');
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function readEvolveState(raw: string | null): EvolveState {
  const value = decode(raw);
  if (value?.version !== 1 || !Array.isArray(value.choices)) return emptyState;

  const choices = new Map<string, EvolveChoice>();
  for (const row of value.choices) {
    if (!row || typeof row !== 'object') continue;
    const { id, at, actionId, title, photoIds, constraints, outcome } = row as Partial<EvolveChoice>;
    if (!id || typeof id !== 'string' || !validDate(at) || typeof actionId !== 'string' || !actionId ||
        typeof title !== 'string' || !title.trim() || !Array.isArray(photoIds) || typeof constraints !== 'string') continue;
    const choice: EvolveChoice = {
      id, at, actionId, title, constraints,
      photoIds: [...new Set(photoIds.filter((photoId) => typeof photoId === 'string' && photoId.length > 0))],
    };
    if (outcome && isRating(outcome.rating) && typeof outcome.note === 'string' && validDate(outcome.at)) {
      choice.outcome = { rating: outcome.rating, note: outcome.note, at: outcome.at };
    }
    const previous = choices.get(id);
    if (!previous || at >= previous.at) choices.set(id, choice);
  }
  return { version: 1, choices: [...choices.values()].sort((a, b) => b.at - a.at) };
}

export function appendChoice(state: EvolveState, choice: EvolveChoiceInput): EvolveState {
  if (state.choices.some((entry) => entry.id === choice.id)) return state;
  return { version: 1, choices: [{ ...choice, photoIds: [...new Set(choice.photoIds)] }, ...state.choices] };
}

export function writeOutcome(state: EvolveState, id: string, outcome: Outcome | null): EvolveState {
  return { version: 1, choices: state.choices.map((choice) => {
    if (choice.id !== id) return choice;
    if (outcome) return { ...choice, outcome: { ...outcome, note: outcome.note.trim() } };
    const { outcome: _removed, ...rest } = choice;
    return rest;
  }) };
}

function outcomeWeight(outcome?: Outcome) {
  return outcome?.rating === 'helpful' ? 1 : outcome?.rating === 'not_helpful' ? -1 : 0;
}

export function preferredActions(state: EvolveState): string[] {
  const scores = new Map<string, number>();
  for (const choice of state.choices) {
    scores.set(choice.actionId, (scores.get(choice.actionId) ?? 0) + outcomeWeight(choice.outcome));
  }
  return [...scores].filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}

export function photoFeedbackScores(state: EvolveState): Map<string, number> {
  const scores = new Map<string, number>();
  for (const choice of state.choices) {
    const weight = outcomeWeight(choice.outcome);
    if (weight === 0) continue;
    for (const id of new Set(choice.photoIds)) scores.set(id, (scores.get(id) ?? 0) + weight);
  }
  return new Map([...scores].map(([id, score]) => [id, Math.max(-3, Math.min(3, score))]));
}

export function readCorrections(section: CorrectionSection, raw: string | null): Correction[] {
  const value = decode(raw);
  if (value?.version !== 1) return [];
  if (section === 'patterns' && Array.isArray(value.records)) {
    return value.records.flatMap((row) => {
      const { id, label, action, at } = row ?? {};
      if (typeof id !== 'string' || typeof label !== 'string' || !validDate(at)) return [];
      const detail = action === 'confirmed' ? 'Confirmed' : action === 'corrected' ? 'Corrected' : action === 'hidden' ? 'Hidden' : null;
      return detail ? [{ id, title: label.trim() || 'Pattern', detail, at }] : [];
    }).sort((a, b) => b.at - a.at);
  }
  if (section === 'connect' && Array.isArray(value.groups)) {
    return value.groups.flatMap((row) => {
      const { id, title, members } = row ?? {};
      if (typeof id !== 'string' || typeof title !== 'string' || !Array.isArray(members)) return [];
      const count = new Set(members.filter((member) => typeof member === 'string' && member)).size;
      return count ? [{ id, title: title.trim() || 'Untitled event', detail: `${count} ${count === 1 ? 'photo' : 'photos'}` }] : [];
    });
  }
  return [];
}
