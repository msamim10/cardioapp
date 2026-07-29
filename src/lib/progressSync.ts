export type ClassKey = 'beginner' | 'intermediate' | 'hard';
export type ActionCounts = Record<'Jump' | 'Duck' | 'Left' | 'Right', number>;

const CLASS_KEYS: ClassKey[] = ['beginner', 'intermediate', 'hard'];

export type RunRecord = {
  levelId: string;
  durationMin: number;
  at: number;
  coins: number;
  xp: number;
  calories: number;
  /**
   * Present only for finished-to-end mode-campaign runs. Casual / discovery
   * completions and early exits omit this so they never unlock the next map
   * on a class path.
   */
  classKey?: ClassKey;
  actionCounts: ActionCounts;
  poseScore: number;
  runId: string;
};

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeActionCounts(value: unknown): ActionCounts {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<Record<keyof ActionCounts, unknown>>)
      : {};
  return {
    Jump: Math.floor(finiteNonNegative(source.Jump)),
    Duck: Math.floor(finiteNonNegative(source.Duck)),
    Left: Math.floor(finiteNonNegative(source.Left)),
    Right: Math.floor(finiteNonNegative(source.Right)),
  };
}

/** Migrate old local/cloud records without inventing exercise activity. */
export function normalizeRunRecord(value: unknown, index: number): RunRecord | null {
  if (!value || typeof value !== 'object') return null;
  const run = value as Partial<RunRecord>;
  if (typeof run.levelId !== 'string' || !run.levelId) return null;
  const at = finiteNonNegative(run.at);
  const classKey = CLASS_KEYS.includes(run.classKey as ClassKey)
    ? (run.classKey as ClassKey)
    : undefined;
  return {
    levelId: run.levelId,
    durationMin: finiteNonNegative(run.durationMin),
    at,
    coins: finiteNonNegative(run.coins),
    xp: finiteNonNegative(run.xp),
    calories: finiteNonNegative(run.calories),
    ...(classKey ? { classKey } : {}),
    actionCounts: normalizeActionCounts(run.actionCounts),
    poseScore: finiteNonNegative(run.poseScore),
    runId:
      typeof run.runId === 'string' && run.runId
        ? run.runId
        : `legacy:${at}:${index}:${run.levelId}`,
  };
}

/** Union runs by stable ID. If an ID conflicts, retain the record with newer completion time. */
export function mergeRuns(local: RunRecord[], cloud: RunRecord[]): RunRecord[] {
  const byId = new Map<string, RunRecord>();
  for (const run of [...cloud, ...local]) {
    const current = byId.get(run.runId);
    if (!current || run.at >= current.at) byId.set(run.runId, run);
  }
  return [...byId.values()].sort((a, b) => a.at - b.at || a.runId.localeCompare(b.runId));
}

export function newerState<T extends { stateUpdatedAt: number }>(local: T, cloud: T | null): T {
  if (!cloud) return local;
  return cloud.stateUpdatedAt > local.stateUpdatedAt ? cloud : local;
}
