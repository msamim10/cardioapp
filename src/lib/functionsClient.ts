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
