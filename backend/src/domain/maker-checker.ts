export class MakerCheckerError extends Error {}

export interface ReleaseContext {
  /** Institution user who asked for the release. */
  requesterId: string;
  /** User who created the FDR record. */
  fdrCreatorId: string;
  /** Scrutiny officer who recommended (the MAKER); null until recommended. */
  makerId: string | null;
}

/** The maker may not be the person who requested the release or who created the FDR record. */
export function assertCanRecommend(actorId: string, ctx: ReleaseContext): void {
  if (actorId === ctx.requesterId) {
    throw new MakerCheckerError('You raised this release request, so you cannot also recommend it.');
  }
  if (actorId === ctx.fdrCreatorId) {
    throw new MakerCheckerError('You created this FDR record, so you cannot recommend its release.');
  }
}

/**
 * The checker must be a different person from the maker, the requester and the record's creator.
 * Enforced on the server regardless of the roles the user holds.
 */
export function assertCanDecide(actorId: string, ctx: ReleaseContext): void {
  if (!ctx.makerId) {
    throw new MakerCheckerError('This request has not been recommended by a scrutiny officer yet.');
  }
  if (actorId === ctx.makerId) {
    throw new MakerCheckerError('Maker and checker must be different people: you recommended this release, so you cannot also approve or reject it.');
  }
  if (actorId === ctx.requesterId) {
    throw new MakerCheckerError('You raised this release request, so you cannot approve or reject it.');
  }
  if (actorId === ctx.fdrCreatorId) {
    throw new MakerCheckerError('You created this FDR record, so you cannot approve its release.');
  }
}

export const CHECKLIST_KEYS = [
  'NO_PENDING_DUES',
  'CLOSURE_CONDITION_MET',
  'ORIGINAL_HANDED_OVER',
  'NO_OPEN_DISCREPANCIES',
] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];

export const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
  NO_PENDING_DUES: 'No pending dues against the institution',
  CLOSURE_CONDITION_MET: 'Closure or approval condition has been met',
  ORIGINAL_HANDED_OVER: 'Original FDR handed over / lien can be removed',
  NO_OPEN_DISCREPANCIES: 'No open discrepancies on this FDR',
};

export interface ChecklistItem {
  key: ChecklistKey;
  ticked: boolean;
  note: string;
}

export function emptyChecklist(): ChecklistItem[] {
  return CHECKLIST_KEYS.map((key) => ({ key, ticked: false, note: '' }));
}

/** Returns a list of problems; empty means the checklist is complete. */
export function checklistProblems(items: ChecklistItem[]): string[] {
  const problems: string[] = [];
  for (const key of CHECKLIST_KEYS) {
    const it = items.find((i) => i.key === key);
    if (!it || !it.ticked) problems.push(`"${CHECKLIST_LABELS[key]}" is not ticked.`);
    else if (!it.note || it.note.trim().length < 3) problems.push(`"${CHECKLIST_LABELS[key]}" needs a note.`);
  }
  return problems;
}
