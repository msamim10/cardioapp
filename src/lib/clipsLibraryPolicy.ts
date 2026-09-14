/**
 * Retention + index policy for the on-device clips library (pure; the file
 * I/O lives in `clipsLibrary.ts`, the tests in
 * `scripts/replay-clips-library.ts`). One entry per composed run video. The
 * newest `CLIPS_MAX_COUNT` clips stay as long as they fit in
 * `CLIPS_MAX_BYTES`; oldest are evicted first.
 */

export const CLIPS_MAX_COUNT = 10;
export const CLIPS_MAX_BYTES = 1024 * 1024 * 1024; // 1 GiB

export type ClipEntry = {
  /** Stable id (the run id). Also the file stem inside the clips directory. */
  id: string;
  levelId: string;
  score: number;
  /** 0..1 */
  accuracy: number;
  /** Epoch ms of the run that produced the clip. */
  createdAt: number;
  /** File name relative to the clips directory (the container path changes between installs). */
  path: string;
  thumbPath: string | null;
  bytes: number;
  durationMs: number;
};

export type ClipsIndex = { version: 1; entries: ClipEntry[] };

export type ClipRetentionPolicy = { maxCount: number; maxBytes: number };

export const DEFAULT_CLIP_RETENTION: ClipRetentionPolicy = {
  maxCount: CLIPS_MAX_COUNT,
  maxBytes: CLIPS_MAX_BYTES,
};

export function emptyClipsIndex(): ClipsIndex {
  return { version: 1, entries: [] };
}

const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function parseEntry(value: unknown): ClipEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<ClipEntry>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  if (typeof raw.path !== 'string' || raw.path.length === 0) return null;
  if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) return null;
  return {
    id: raw.id,
    levelId: typeof raw.levelId === 'string' ? raw.levelId : '',
    score: Math.max(0, finite(raw.score)),
    accuracy: Math.min(1, Math.max(0, finite(raw.accuracy))),
    createdAt: raw.createdAt,
    path: raw.path,
    thumbPath: typeof raw.thumbPath === 'string' && raw.thumbPath.length > 0 ? raw.thumbPath : null,
    bytes: Math.max(0, finite(raw.bytes)),
    durationMs: Math.max(0, finite(raw.durationMs)),
  };
}

/** Tolerant parse: garbage, wrong version or malformed entries yield an empty/partial index. */
export function parseClipsIndex(json: string | null): ClipsIndex {
  if (!json) return emptyClipsIndex();
  try {
    const raw = JSON.parse(json) as Partial<ClipsIndex>;
    if (raw.version !== 1 || !Array.isArray(raw.entries)) return emptyClipsIndex();
    const byId = new Map<string, ClipEntry>();
    for (const candidate of raw.entries) {
      const entry = parseEntry(candidate);
      if (!entry) continue;
      const prev = byId.get(entry.id);
      if (!prev || entry.createdAt >= prev.createdAt) byId.set(entry.id, entry);
    }
    return { version: 1, entries: sortClips([...byId.values()]) };
  } catch {
    return emptyClipsIndex();
  }
}

export function serializeClipsIndex(index: ClipsIndex): string {
  return JSON.stringify({ version: 1, entries: sortClips(index.entries) });
}

/** Newest first; ties broken by id so the order is stable. */
export function sortClips(entries: readonly ClipEntry[]): ClipEntry[] {
  return entries.slice().sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Decide which clips survive: walk newest → oldest, keeping a clip while the
 * count and the running byte total stay within the policy. The newest clip
 * is always kept (a single oversized clip is still the user's latest run).
 */
export function applyClipRetention(
  entries: readonly ClipEntry[],
  policy: ClipRetentionPolicy = DEFAULT_CLIP_RETENTION,
): { keep: ClipEntry[]; evict: ClipEntry[] } {
  const maxCount = Math.max(1, Math.floor(policy.maxCount));
  const maxBytes = Math.max(0, policy.maxBytes);
  const keep: ClipEntry[] = [];
  const evict: ClipEntry[] = [];
  let bytes = 0;
  for (const entry of sortClips(entries)) {
    const fitsCount = keep.length < maxCount;
    const fitsBytes = bytes + entry.bytes <= maxBytes;
    if (keep.length === 0 || (fitsCount && fitsBytes)) {
      keep.push(entry);
      bytes += entry.bytes;
    } else {
      evict.push(entry);
    }
  }
  return { keep, evict };
}

/** Insert (or replace by id) and apply retention. `evicted` never contains the new clip. */
export function addClip(
  index: ClipsIndex,
  entry: ClipEntry,
  policy: ClipRetentionPolicy = DEFAULT_CLIP_RETENTION,
): { index: ClipsIndex; evicted: ClipEntry[] } {
  // The new clip is pinned first; the others compete for what budget is left.
  const maxCount = Math.max(1, Math.floor(policy.maxCount));
  const maxBytes = Math.max(0, policy.maxBytes);
  const keep: ClipEntry[] = [entry];
  const evicted: ClipEntry[] = [];
  let bytes = entry.bytes;
  for (const other of sortClips(index.entries.filter((e) => e.id !== entry.id))) {
    if (keep.length < maxCount && bytes + other.bytes <= maxBytes) {
      keep.push(other);
      bytes += other.bytes;
    } else {
      evicted.push(other);
    }
  }
  return { index: { version: 1, entries: sortClips(keep) }, evicted };
}

export function removeClip(index: ClipsIndex, id: string): ClipsIndex {
  return { version: 1, entries: index.entries.filter((e) => e.id !== id) };
}

export function findClip(index: ClipsIndex, id: string): ClipEntry | null {
  return index.entries.find((e) => e.id === id) ?? null;
}

export function totalClipBytes(entries: readonly ClipEntry[]): number {
  return entries.reduce((sum, e) => sum + e.bytes, 0);
}
