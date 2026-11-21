import type { Result } from './gallery';

export type ParallelCandidate = {
  photo: Result;
  captured: number;
  place: string | null;
  lat: number | null;
  lon: number | null;
  related: string[];
};

export type ParallelCandidatePage = { items: ParallelCandidate[]; truncated: boolean };

export type ParallelChoice = {
  id: string;
  at: number;
  actionId: string;
  title: string;
  photoIds: string[];
  constraints: string;
};

const budgetOptions = [5, 15, 30] as const;
type Budget = (typeof budgetOptions)[number];
type Preference = 'Any approach' | 'Take action' | 'Get organized';
export type ParallelConstraints = { minutes: Budget; preference: Preference };
export const parallelBudgets = budgetOptions;
export const parallelPreferences: readonly Preference[] = ['Any approach', 'Take action', 'Get organized'];

type Plan = {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  preference: Exclude<Preference, 'Any approach'>;
  steps: readonly string[];
  evidence: Result[];
};

export const MAX_PARALLEL_PHOTOS = 4;

export function availableParallelPhotos(items: readonly ParallelCandidate[]): ParallelCandidate[] {
  const accessible = new Map<string, ParallelCandidate>();
  for (const item of items) {
    if (item.photo.uri && item.photo.decision !== 'dismissed' && !accessible.has(item.photo.id)) {
      accessible.set(item.photo.id, item);
    }
  }
  return [...accessible.values()];
}

const focusedPlans = [
  {
    category: 'Receipts', id: 'receipt-checklist', title: 'Make an expense checklist',
    summary: 'Pull the dates, totals, and any follow-up you need from these receipts.',
    steps: ['Open the receipts and confirm the dates and amounts.', 'List any expenses you still need to file or check.'],
  },
  {
    category: 'Notes and whiteboards', id: 'notes-checklist', title: 'Turn notes into next steps',
    summary: 'Pull one task you can act on from each note.',
    steps: ['Read the notes or whiteboard photos.', 'Write down a task and decide which one to do first.'],
  },
  {
    category: 'Shopping references', id: 'compare-references', title: 'Compare saved options',
    summary: 'Use the references to clarify which details matter before deciding.',
    steps: ['List one detail that matters to you.', 'Review the references side by side and write down what you still need to check.'],
  },
  {
    category: 'Documents', id: 'document-outline', title: 'Make a short document outline',
    summary: 'Collect the key points and open questions from these documents.',
    steps: ['Skim each document for its main point.', 'Keep those points together with any questions to follow up on.'],
  },
] as const;

export function buildParallelPlans(
  items: readonly ParallelCandidate[],
  constraints: ParallelConstraints,
  preferredActions: readonly string[] = [],
): Plan[] {
  const photos = availableParallelPhotos(items).slice(0, MAX_PARALLEL_PHOTOS).map(({ photo }) => photo);
  if (!photos.length) return [];
  const options: Plan[] = [
    {
      id: 'quick-review', title: 'Pick one next step', minutes: 3, preference: 'Take action',
      summary: 'Review your selection and decide on one action to take.',
      steps: ['Open the selected photos.', 'Pick one photo and write down what you want to do with it.'],
      evidence: photos,
    },
    {
      id: 'keep-collection', title: 'Make a reference collection', minutes: 5, preference: 'Get organized',
      summary: 'Keep related photos together so you can find them again.',
      steps: ['Decide which of the selected photos you want to keep together.', 'Use Organize into a collection in the photo viewer.'],
      evidence: photos,
    },
  ];

  const focused = focusedPlans.map((plan) => ({
    ...plan, evidence: photos.filter((photo) => photo.category === plan.category),
  })).sort((a, b) => b.evidence.length - a.evidence.length)[0];

  if (focused.evidence.length) {
    options.push({
      id: focused.id, title: focused.title, summary: focused.summary, minutes: 10, preference: 'Take action',
      steps: focused.steps, evidence: focused.evidence,
    });
  } else {
    options.push({
      id: 'reference-outline', title: 'Make a follow-up list', minutes: 10, preference: 'Take action',
      summary: 'Write down a useful detail from each photo and what you want to do with it.',
      steps: ['Review the selected photos and note useful details.', 'Turn the details into a short list of follow-ups.'],
      evidence: photos,
    });
  }

  return options.filter((option) => option.minutes <= constraints.minutes).sort((a, b) => {
    const preference = Number(b.preference === constraints.preference) - Number(a.preference === constraints.preference);
    const feedback = Number(preferredActions.includes(b.id)) - Number(preferredActions.includes(a.id));
    return preference || feedback || a.minutes - b.minutes;
  });
}

let choiceSequence = 0;

export function parallelChoice(plan: Plan, constraints: ParallelConstraints, at = Date.now()): ParallelChoice {
  return {
    id: `${at}-${plan.id}-${choiceSequence++}`,
    at,
    actionId: plan.id,
    title: plan.title,
    photoIds: plan.evidence.map((photo) => photo.id),
    constraints: `${constraints.minutes} minutes available, ${constraints.preference.toLowerCase()}`,
  };
}
