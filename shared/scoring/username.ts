/**
 * Username format + reserved-handle rules, shared by the onboarding screen,
 * the profile editor and the `reserveUsername` Cloud Function so the server
 * enforces exactly what the client previews.
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

/** Handles nobody may claim (brand, roles, confusing literals). */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin', 'root', 'support', 'cardiosurf', 'test', 'user', 'runner',
  'moderator', 'null', 'undefined', 'me', 'you',
]);

export function isReservedUsername(handle: string): boolean {
  return RESERVED_USERNAMES.has(handle.trim().toLowerCase());
}

/**
 * Full server-side check: format + reserved list. Returns the normalized
 * handle to store or a reason string.
 */
export function checkUsernameClaim(raw: unknown): { ok: true; handle: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: 'Username must be a string' };
  const handle = raw.trim().toLowerCase();
  const check = validateUsername(handle);
  if (!check.valid) return { ok: false, reason: check.reason ?? 'Invalid username' };
  if (isReservedUsername(handle)) return { ok: false, reason: 'That handle is reserved' };
  return { ok: true, handle };
}
