/**
 * Beat-my-score links. Two shapes resolve to the same level + challenge:
 *
 *   cardiosurf://level/{id}?challenge={runId}      (custom scheme, app.json)
 *   https://cardiosurf.com/l/{id}?c={runId}        (universal link, AASA)
 *
 * The web form lands on `src/app/l/[id].tsx`, which redirects to
 * `/level/[id]?challenge=` so the level screen only ever sees one shape.
 * Pure string handling — no React/Expo imports — so it is unit-testable.
 */

export const CHALLENGE_WEB_ORIGIN = 'https://cardiosurf.com';
export const CHALLENGE_SCHEME = 'cardiosurf';

export type ChallengeLink = { levelId: string; challengeId: string | null };

const LEVEL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RUN_ID = /^[A-Za-z0-9_-]{4,128}$/;

export function challengeWebUrl(levelId: string, runId: string): string {
  return `${CHALLENGE_WEB_ORIGIN}/l/${encodeURIComponent(levelId)}?c=${encodeURIComponent(runId)}`;
}

export function challengeSchemeUrl(levelId: string, runId: string): string {
  return `${CHALLENGE_SCHEME}://level/${encodeURIComponent(levelId)}?challenge=${encodeURIComponent(runId)}`;
}

function parseQuery(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of search.replace(/^\?/, '').split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v);
    } catch {
      // skip malformed component
    }
  }
  return out;
}

/**
 * Parse either link shape. Returns null for anything that is not a level
 * link, so callers can ignore unrelated URLs (auth callbacks, etc.).
 */
export function parseChallengeLink(url: string | null | undefined): ChallengeLink | null {
  if (!url) return null;
  const hashless = url.split('#')[0];
  const qIndex = hashless.indexOf('?');
  const base = qIndex >= 0 ? hashless.slice(0, qIndex) : hashless;
  const query = qIndex >= 0 ? parseQuery(hashless.slice(qIndex)) : {};

  let levelId: string | null = null;
  let challengeId: string | null = null;

  const scheme = base.match(/^cardiosurf:\/\/(?:level|l)\/([^/?#]+)\/?$/i);
  if (scheme) {
    levelId = scheme[1];
    challengeId = query.challenge ?? query.c ?? null;
  } else {
    const web = base.match(/^https?:\/\/(?:www\.)?cardiosurf\.com\/(?:l|level)\/([^/?#]+)\/?$/i);
    if (web) {
      levelId = web[1];
      challengeId = query.c ?? query.challenge ?? null;
    }
  }
  if (!levelId) return null;
  try {
    levelId = decodeURIComponent(levelId);
  } catch {
    return null;
  }
  if (!LEVEL_ID.test(levelId)) return null;
  if (challengeId && !RUN_ID.test(challengeId)) challengeId = null;
  return { levelId, challengeId };
}

/** Route target inside the app for a parsed link. */
export function challengeHref(link: ChallengeLink): {
  pathname: '/level/[id]';
  params: { id: string; challenge?: string };
} {
  return {
    pathname: '/level/[id]',
    params: { id: link.levelId, ...(link.challengeId ? { challenge: link.challengeId } : {}) },
  };
}
