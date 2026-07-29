/**
 * Username identity helpers for the "Claim your username" onboarding step.
 *
 * There is no backend yet, so availability is checked against a local blocklist
 * (see AVAILABILITY_BLOCKLIST) — swap `checkUsernameAvailable` for a real network
 * call later without touching the screen. The claimed handle is persisted in
 * ProgressContext and used as the user's leaderboard identity.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

const FORMAT = /^[a-z0-9_]+$/;

export type UsernameCheck = { valid: boolean; reason?: string };

/** Strip anything that isn't a lowercase letter, number or underscore. */
export function normalizeUsername(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, USERNAME_MAX);
}

export function validateUsername(raw: string): UsernameCheck {
  const u = raw.trim();
  if (u.length === 0) return { valid: false, reason: 'empty' };
  if (u.length < USERNAME_MIN) return { valid: false, reason: `Use at least ${USERNAME_MIN} characters` };
  if (u.length > USERNAME_MAX) return { valid: false, reason: `Keep it under ${USERNAME_MAX} characters` };
  if (!FORMAT.test(u)) return { valid: false, reason: 'Lowercase letters, numbers & _ only' };
  return { valid: true };
}

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

// Reserved / obviously-taken handles used to simulate an availability check.
const AVAILABILITY_BLOCKLIST = new Set([
  'admin', 'root', 'support', 'cardiosurf', 'test', 'user', 'runner',
  'moderator', 'null', 'undefined', 'me', 'you',
]);

/**
 * Simulated availability check. Resolves after a short delay so the UI can show
 * a "checking" state, then reports availability from the local blocklist.
 */
export function checkUsernameAvailable(username: string, delayMs = 450): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(!AVAILABILITY_BLOCKLIST.has(username.toLowerCase())), delayMs);
  });
}

// Placeholder rival handles for the onboarding leaderboard-climb finale. Clearly
// fictional and only used for the celebratory animation, never presented as real
// users. // simulated until backend
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
