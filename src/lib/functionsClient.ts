import { getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { isFirebaseConfigured } from './config';
import { getFirebaseApp } from './firebase';

/** Must match `setGlobalOptions({ region })` in functions/src/index.ts. */
export const FUNCTIONS_REGION = 'us-central1';

let functions: Functions | null = null;

export function getFirebaseFunctions(): Functions {
  if (functions) return functions;
  functions = getFunctions(getFirebaseApp(), FUNCTIONS_REGION);
  return functions;
}

export type CallableErrorCode =
  | 'unauthenticated'
  | 'invalid-argument'
  | 'failed-precondition'
  | 'permission-denied'
  | 'resource-exhausted'
  | 'unavailable'
  | 'internal'
  | 'not-configured'
  | 'unknown';

export class CallableError extends Error {
  readonly code: CallableErrorCode;
  constructor(code: CallableErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function toCallableError(error: unknown): CallableError {
  const raw = (error as { code?: string; message?: string }) ?? {};
  const code = (raw.code ?? '').replace(/^functions\//, '') as CallableErrorCode;
  const known: CallableErrorCode[] = [
    'unauthenticated',
    'invalid-argument',
    'failed-precondition',
    'permission-denied',
    'resource-exhausted',
    'unavailable',
    'internal',
  ];
  return new CallableError(known.includes(code) ? code : 'unknown', raw.message ?? 'Request failed');
}

/**
 * Invoke a callable Cloud Function. Throws `CallableError` with a normalized
 * code so callers can branch on `failed-precondition` (e.g. `no-beatmap`)
 * without depending on Firebase's error shape.
 */
export async function callFunction<TRequest, TResponse>(
  name: string,
  data: TRequest,
): Promise<TResponse> {
  if (!isFirebaseConfigured) throw new CallableError('not-configured', 'Firebase is not configured.');
  try {
    const callable = httpsCallable<TRequest, TResponse>(getFirebaseFunctions(), name);
    const result = await callable(data);
    return result.data;
  } catch (error) {
    throw toCallableError(error);
  }
}

// ---------------------------------------------------------------------------
// reconcileGhostsNow (admin)
// ---------------------------------------------------------------------------

/** Mirrors `ReconcileNowInput` in functions/src/seed.ts. */
export type SeedBoardsInput = {
  /** Report only; nothing is written. */
  dryRun?: boolean;
  /** Override the per-level board target for this run (0 purges). */
  targetTotal?: number;
  /** Override the daily board target for this run (0 purges). */
  dailyTarget?: number;
};

/** One board's line in the reconcile report (`BoardSummary` in seed.ts). */
export type SeedBoardSummary = {
  board: string;
  total: number;
  real: number;
  ghostsBefore: number;
  target: number;
  added: number;
  refreshed: number;
  removed: number;
  skipped: number;
};

/** `ReconcileResult` in functions/src/seed.ts. */
export type SeedBoardsResult = {
  dryRun: boolean;
  targetTotal: number;
  dailyTarget: number;
  boards: SeedBoardSummary[];
  sweptDaily: { dateKey: string; removed: number }[];
  writes: number;
  deletes: number;
  ms: number;
};

/**
 * Admin-only callable: bring every level board and the active daily boards
 * to their seeded target now (the hourly `reconcileGhosts` job, on demand).
 * Throws `CallableError` (`permission-denied` for non-admins).
 */
export async function seedBoardsNow(input: SeedBoardsInput = {}): Promise<SeedBoardsResult> {
  const result = await callFunction<SeedBoardsInput, Partial<SeedBoardsResult> | null>('reconcileGhostsNow', input);
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  return {
    dryRun: result?.dryRun === true,
    targetTotal: num(result?.targetTotal),
    dailyTarget: num(result?.dailyTarget),
    boards: Array.isArray(result?.boards) ? result.boards : [],
    sweptDaily: Array.isArray(result?.sweptDaily) ? result.sweptDaily : [],
    writes: num(result?.writes),
    deletes: num(result?.deletes),
    ms: num(result?.ms),
  };
}

/** Multi-line summary for the admin alert after `seedBoardsNow`. */
export function describeSeedBoards(result: SeedBoardsResult): string {
  const seconds = (result.ms / 1000).toFixed(1);
  const head = `${result.dryRun ? 'Dry run · ' : ''}${result.writes} writes · ${result.deletes} deletes · ${seconds}s`;
  const targets = `Targets: ${result.targetTotal} per level · ${result.dailyTarget} daily`;
  const changed = result.boards.filter((b) => b.added || b.refreshed || b.removed || b.skipped);
  const boards =
    changed.length === 0
      ? `${result.boards.length} boards checked, all at target.`
      : changed
          .map(
            (b) =>
              `${b.board}: ${b.total} total (${b.real} real) → ${b.target} seeded · +${b.added} ~${b.refreshed} -${b.removed}${
                b.skipped ? ` skipped ${b.skipped}` : ''
              }`,
          )
          .join('\n');
  const swept = result.sweptDaily.filter((s) => s.removed > 0);
  const sweptLine = swept.length ? `\nSwept: ${swept.map((s) => `${s.dateKey} (${s.removed})`).join(', ')}` : '';
  return `${head}\n${targets}\n${boards}${sweptLine}`;
}
