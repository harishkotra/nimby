import type { Overview } from './gallery';

export function homeLeadAction(overview: Pick<Overview, 'localAnalyzed' | 'analyzed' | 'accessible' | 'awaiting'> | null) {
  if (overview && (overview.localAnalyzed > 0 || (overview.analyzed ?? 0) > 0)) return 'search';
  if (overview?.accessible === 0 && overview.awaiting === 0) return 'pick';
  return 'scan';
}
