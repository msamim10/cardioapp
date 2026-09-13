/**
 * Deep links that arrive while the auth gate is redirecting (welcome /
 * create-account / resume) would otherwise be dropped by `router.replace`.
 * The root layout stashes the parsed link here when it redirects and replays
 * it once the gate settles on `tabs`. Module-level: it only has to survive
 * the current process — a killed app re-receives the URL from the OS.
 */

import type { ChallengeLink } from './challengeLinks';

let pending: ChallengeLink | null = null;

export function stashPendingDeepLink(link: ChallengeLink | null): void {
  if (link) pending = link;
}

export function takePendingDeepLink(): ChallengeLink | null {
  const link = pending;
  pending = null;
  return link;
}

export function hasPendingDeepLink(): boolean {
  return pending !== null;
}
