/**
 * Beatmap registry: which chart (if any) a level is scored against.
 *
 * Charts are no longer shipped in the bundle. They are derived server-side
 * from how players actually move (`shared/scoring/consensus.ts`, rebuilt by
 * the `rebuildConsensusBeatmaps` Function) and published to Firestore as
 * `beatmaps/{levelId}` (signed-in read). This module:
 *
 *   - mirrors those docs in memory, backed by an AsyncStorage cache with a
 *     6 h TTL (`refreshBeatmap` on level open, `refreshAllBeatmaps` on
 *     launch), so new charts arrive without an app update and the sync
 *     accessors (`getBeatmap`, `hasBeatmap`) keep working offline;
 *   - lets the workout adopt the chart `startRun` hands back for a run
 *     (`adoptChart`) — that response is the source of truth for scoring;
 *   - still accepts bundled JSON under `__DEV__` (`example.dev.json`) so the
 *     loader path can be exercised without a backend.
 *
 * Levels without a chart score with the free-move rules and post
 * provisionally; see docs/LEADERBOARDS.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { beatmapHash, parseBeatmap, type Beatmap } from '@/lib/beatmaps';
import { isFirebaseConfigured } from '@/lib/config';
import { getFirebaseDb } from '@/lib/firebase';

export type ChartInfo = {
  beatmap: Beatmap;
  /** Content hash (`beatmapHash`), sent with every submission. */
  hash: string;
  /** Server chart revision (`beatmaps/{levelId}.chartVersion`); bundled charts are 1. */
  chartVersion: number;
  /** Runs the consensus was built from (0 for authored charts). */
  runCount: number;
  source: 'consensus' | 'manual' | 'bundled';
};

const CACHE_KEY = '@cardiosurf/beatmaps/v1';
export const BEATMAP_CACHE_TTL_MS = 6 * 3_600_000;
/**
 * A consensus chart built from fewer runs than this is "early": scoring uses
 * it, but the campaign accuracy gate does not lock players behind it.
 */
export const CHART_MATURE_RUNS = 10;

type CacheEntry = { fetchedAt: number; doc: Record<string, unknown> | null };
type CacheFile = { entries: Record<string, CacheEntry> };

// --- Bundled (dev only) -----------------------------------------------------

const BEATMAP_SOURCES: unknown[] = [];
if (__DEV__) {
  BEATMAP_SOURCES.push(require('../data/beatmaps/example.dev.json'));
}

const bundled: Record<string, ChartInfo> = {};
for (const source of BEATMAP_SOURCES) {
  const beatmap = parseBeatmap(source);
  if (!beatmap) {
    if (__DEV__) console.warn('[beatmaps] Skipping invalid beatmap source', source);
    continue;
  }
  bundled[beatmap.levelId] = {
    beatmap,
    hash: beatmapHash(beatmap),
    chartVersion: 1,
    runCount: 0,
    source: 'bundled',
  };
}

// --- Remote mirror -----------------------------------------------------------

/** `null` = the server has no chart for this level (known, cached). */
const remote: Record<string, ChartInfo | null> = {};
const fetchedAt: Record<string, number> = {};
let hydrated: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

/** Parse a `beatmaps/{levelId}` document (or the chart in a `startRun` reply). */
export function parseChartDoc(levelId: string, data: unknown): ChartInfo | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  if (raw.published === false) return null;
  const beatmap = parseBeatmap(raw);
  if (!beatmap || beatmap.levelId !== levelId) return null;
  const hash = typeof raw.hash === 'string' && raw.hash ? raw.hash : beatmapHash(beatmap);
  const chartVersion =
    typeof raw.chartVersion === 'number' && raw.chartVersion >= 1 ? Math.floor(raw.chartVersion) : 1;
  return {
    beatmap,
    hash,
    chartVersion,
    runCount: typeof raw.runCount === 'number' && raw.runCount >= 0 ? raw.runCount : 0,
    source: raw.source === 'consensus' ? 'consensus' : 'manual',
  };
}

function store(levelId: string, docData: Record<string, unknown> | null, at: number): void {
  remote[levelId] = docData ? parseChartDoc(levelId, docData) : null;
  fetchedAt[levelId] = at;
}

async function persist(): Promise<void> {
  const entries: Record<string, CacheEntry> = {};
  for (const levelId of Object.keys(fetchedAt)) {
    const chart = remote[levelId];
    entries[levelId] = {
      fetchedAt: fetchedAt[levelId],
      doc: chart ? { ...JSON.parse(JSON.stringify(chart.beatmap)), hash: chart.hash, chartVersion: chart.chartVersion, runCount: chart.runCount, source: chart.source, published: true } : null,
    };
  }
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ entries } satisfies CacheFile));
  } catch {
    // Cache only; the next launch refetches.
  }
}

/** Load the persisted mirror once. Safe to call repeatedly. */
export function hydrateBeatmapCache(): Promise<void> {
  if (hydrated) return hydrated;
  hydrated = (async () => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const file = JSON.parse(raw) as Partial<CacheFile>;
      const entries = file?.entries && typeof file.entries === 'object' ? file.entries : {};
      for (const [levelId, entry] of Object.entries(entries)) {
        if (!entry || typeof entry.fetchedAt !== 'number') continue;
        // Never let a stale cache shadow a chart adopted from startRun meanwhile.
        if (fetchedAt[levelId] && fetchedAt[levelId] >= entry.fetchedAt) continue;
        store(levelId, entry.doc && typeof entry.doc === 'object' ? entry.doc : null, entry.fetchedAt);
      }
      notify();
    } catch {
      // Corrupt cache: start empty.
    }
  })();
  return hydrated;
}

function isStale(levelId: string, now: number): boolean {
  const at = fetchedAt[levelId];
  return !at || now - at > BEATMAP_CACHE_TTL_MS;
}

/**
 * Refresh one level's chart from Firestore when the cached copy is older than
 * the TTL (or `force`). Resolves to the current chart (cached on failure).
 */
export async function refreshBeatmap(
  levelId: string | undefined,
  options: { force?: boolean } = {},
): Promise<ChartInfo | null> {
  if (!levelId) return null;
  await hydrateBeatmapCache();
  const now = Date.now();
  if (!isFirebaseConfigured || (!options.force && !isStale(levelId, now))) return getChart(levelId);
  try {
    const snapshot = await getDoc(doc(getFirebaseDb(), 'beatmaps', levelId));
    store(levelId, snapshot.exists() ? snapshot.data() : null, now);
    notify();
    void persist();
  } catch (error) {
    if (__DEV__) console.info('[beatmaps] refresh failed:', (error as Error).message);
  }
  return getChart(levelId);
}

/**
 * Refresh every published chart in one query when any cached level is stale
 * (launch / sign-in). Levels absent from the collection are recorded as
 * "no chart" so `hasBeatmap` is accurate for them too.
 */
export async function refreshAllBeatmaps(
  levelIds: readonly string[],
  options: { force?: boolean } = {},
): Promise<void> {
  await hydrateBeatmapCache();
  const now = Date.now();
  if (!isFirebaseConfigured) return;
  if (!options.force && !levelIds.some((id) => isStale(id, now))) return;
  try {
    const snapshot = await getDocs(collection(getFirebaseDb(), 'beatmaps'));
    const seen = new Set<string>();
    snapshot.forEach((entry) => {
      seen.add(entry.id);
      store(entry.id, entry.data(), now);
    });
    for (const id of levelIds) if (!seen.has(id)) store(id, null, now);
    notify();
    void persist();
  } catch (error) {
    if (__DEV__) console.info('[beatmaps] refresh-all failed:', (error as Error).message);
  }
}

/**
 * Adopt the chart `startRun` returned for a run (authoritative for that run)
 * into the mirror, so the rest of the app agrees with what was just scored.
 */
export function adoptChart(levelId: string, chartDoc: Record<string, unknown> | null): ChartInfo | null {
  store(levelId, chartDoc, Date.now());
  notify();
  void persist();
  return getChart(levelId);
}

// --- Sync accessors ----------------------------------------------------------

export function getChart(levelId: string | undefined): ChartInfo | null {
  if (!levelId) return null;
  if (levelId in remote) return remote[levelId] ?? bundled[levelId] ?? null;
  return bundled[levelId] ?? null;
}

export function getBeatmap(levelId: string | undefined): Beatmap | null {
  return getChart(levelId)?.beatmap ?? null;
}

export function getBeatmapHash(levelId: string | undefined): string | null {
  return getChart(levelId)?.hash ?? null;
}

export function hasBeatmap(levelId: string | undefined): boolean {
  return getChart(levelId) !== null;
}

/**
 * A chart the campaign skill gate may trust: authored, or a consensus chart
 * built from at least CHART_MATURE_RUNS runs. Early charts are rough on
 * purpose; nobody should be locked out of a path by one.
 */
export function hasMatureBeatmap(levelId: string | undefined): boolean {
  const chart = getChart(levelId);
  if (!chart) return false;
  return chart.source !== 'consensus' || chart.runCount >= CHART_MATURE_RUNS;
}

export function subscribeBeatmaps(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-render when the chart mirror changes (adopt / refresh / hydrate). */
export function useBeatmapCacheVersion(): number {
  const [current, setCurrent] = useState(version);
  useEffect(() => subscribeBeatmaps(() => setCurrent(version)), []);
  return current;
}
