/**
 * Username identity helpers for the "Claim your username" onboarding step and
 * the profile editor.
 *
 * Format + reserved-handle rules live in the shared package
 * (`shared/scoring/username.ts`) so the `reserveUsername` Cloud Function
 * enforces exactly what the client previews. Uniqueness is only known to the
 * server: the onboarding step runs before an account exists, so it validates
 * locally and the handle is reserved lazily on the first authenticated sync
 * (`ensureUsernameReserved` in `profileSync.ts`); the profile editor reserves
 * synchronously and surfaces "taken".
 */

import { isReservedUsername, USERNAME_MAX } from '@shared/scoring/username';

export {
  USERNAME_MAX,
  USERNAME_MIN,
  isReservedUsername,
  normalizeUsername,
  validateUsername,
  type UsernameCheck,
} from '@shared/scoring/username';

const ADJECTIVES = [
  'swift', 'turbo', 'neon', 'cosmic', 'lunar', 'solar', 'rapid', 'blaze',
  'volt', 'nova', 'pixel', 'hyper', 'astro', 'ember', 'frost', 'jade',
  'ruby', 'onyx', 'echo', 'drift', 'quartz', 'zippy', 'mint', 'shadow',
];

const ANIMALS = [
  'fox', 'orca', 'wolf', 'hawk', 'puma', 'lynx', 'shark', 'falcon',
  'otter', 'cobra', 'panda', 'tiger', 'raven', 'gecko', 'bison', 'moth',
  'crane', 'ibex', 'stag', 'seal', 'wren', 'newt', 'mako', 'kite',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Generate a friendly handle like `ruby_orca67`, always within length limits. */
export function generateUsername(): string {
  const adjective = pick(ADJECTIVES);
  const animal = pick(ANIMALS);
  const suffix = Math.floor(Math.random() * 90) + 10; // 10-99
  return `${adjective}_${animal}${suffix}`.slice(0, USERNAME_MAX);
}

/**
 * `handle` with a short numeric suffix appended (trimmed to fit) — the retry
 * shape used when a lazily reserved onboarding handle turns out to be taken.
 */
export function suffixedUsername(handle: string, attempt: number): string {
  const suffix = `${Math.floor(Math.random() * 900) + 100 + attempt}`;
  return `${handle.slice(0, USERNAME_MAX - suffix.length)}${suffix}`;
}

/**
 * Local pre-check used before an account exists: reserved handles are the only
 * thing knowable offline. Resolves after a short delay so the UI can show a
 * "checking" state; real uniqueness is decided by `reserveUsername`.
 */
export function checkUsernameAvailable(username: string, delayMs = 450): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(!isReservedUsername(username)), delayMs);
  });
}

// Placeholder rival handles for the onboarding leaderboard-climb finale. Clearly
// fictional and only used for the celebratory animation, never presented as real
// users.
const RIVAL_HANDLES = [
  'camhanes', 'marcus_w', 'alex_t', 'sarahk', 'chris_h', 'emmar',
  'jaydxn', 'priya_runs', 'coach_leo', 'mia_sprints', 'devon_x', 'noah_k',
];

/** Pick `n` stable-feeling placeholder rival handles for the climb screen. */
export function sampleRivalHandles(n: number): string[] {
  const pool = [...RIVAL_HANDLES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}
