/**
 * On-device cache of the per-level composite game assets
 * (`composite/<slug>/game-576.mp4`, see `videoSources.ts`). The composer
 * needs the whole file locally, so the level screen prefetches it in the
 * background as soon as "Record my run" is on, and the summary falls back to
 * a foreground download if the prefetch did not finish.
 *
 * Storage: `<Caches>/cardiosurf-composite/<levelId>.mp4` plus an
 * `index.json` with last-used stamps. LRU of `CACHE_CAPACITY` (3) levels —
 * policy in `compositeCachePolicy.ts`. Everything here is best-effort: a
 * failure only means the recording toggle reports the asset as unavailable.
 */

import { Directory, File, Paths } from 'expo-file-system';
import {
  parseCacheIndex,
  removeEntry,
  touchEntry,
  type CacheIndex,
} from '@/lib/compositeCachePolicy';
import { getCompositeGameSource } from '@/lib/videoSources';

const DIR_NAME = 'cardiosurf-composite';
const INDEX_FILE = 'index.json';

export type CompositeAvailability = 'available' | 'missing' | 'unknown';

function cacheDir(): Directory {
  const dir = new Directory(Paths.cache, DIR_NAME);
  if (!dir.exists) {
    try {
      dir.create({ intermediates: true, idempotent: true });
    } catch {
      // Created concurrently, or the cache directory is unavailable.
    }
  }
  return dir;
}

function assetFile(levelId: string): File {
  return new File(cacheDir(), `${levelId}.mp4`);
}

function readIndex(): CacheIndex {
  const file = new File(cacheDir(), INDEX_FILE);
  try {
    return parseCacheIndex(file.exists ? file.textSync() : null);
  } catch {
    return parseCacheIndex(null);
  }
}

function writeIndex(index: CacheIndex): void {
  try {
    new File(cacheDir(), INDEX_FILE).write(JSON.stringify(index));
  } catch {
    // Losing the index only costs an early eviction.
  }
}

function deleteAsset(levelId: string): void {
  try {
    const file = assetFile(levelId);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}

/** Absolute file path (not a URI) of the cached asset, or null. Touches the LRU. */
export function getCachedCompositeAsset(levelId: string): string | null {
  try {
    const file = assetFile(levelId);
    if (!file.exists || file.size <= 0) return null;
    const { index, evicted } = touchEntry(readIndex(), levelId, Date.now(), file.size);
    evicted.forEach(deleteAsset);
    writeIndex(index);
    return toPath(file.uri);
  } catch {
    return null;
  }
}

export function hasCachedCompositeAsset(levelId: string): boolean {
  try {
    const file = assetFile(levelId);
    return file.exists && file.size > 0;
  } catch {
    return false;
  }
}

/**
 * Is the asset hosted for this level? HEAD against the bucket; `unknown`
 * when offline or the request fails, `missing` on 404 (or no mapping).
 */
export async function checkCompositeAvailable(levelId: string): Promise<CompositeAvailability> {
  const url = getCompositeGameSource(levelId);
  if (!url) return 'missing';
  if (hasCachedCompositeAsset(levelId)) return 'available';
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (response.ok) return 'available';
    if (response.status === 404 || response.status === 403) return 'missing';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

const inflight = new Map<string, Promise<string | null>>();

/**
 * Download the asset into the cache (idempotent; concurrent callers share one
 * download). Resolves to the local path, or null when the download failed or
 * the asset is not hosted.
 */
export function prefetchCompositeAsset(levelId: string): Promise<string | null> {
  const cached = getCachedCompositeAsset(levelId);
  if (cached) return Promise.resolve(cached);
  const url = getCompositeGameSource(levelId);
  if (!url) return Promise.resolve(null);
  const existing = inflight.get(levelId);
  if (existing) return existing;
  const task = (async () => {
    try {
      const target = assetFile(levelId);
      const downloaded = await File.downloadFileAsync(url, target, { idempotent: true });
      if (!downloaded.exists || downloaded.size <= 0) {
        deleteAsset(levelId);
        return null;
      }
      const { index, evicted } = touchEntry(readIndex(), levelId, Date.now(), downloaded.size);
      evicted.forEach(deleteAsset);
      writeIndex(index);
      return toPath(downloaded.uri);
    } catch {
      deleteAsset(levelId);
      return null;
    } finally {
      inflight.delete(levelId);
    }
  })();
  inflight.set(levelId, task);
  return task;
}

export function removeCompositeAsset(levelId: string): void {
  deleteAsset(levelId);
  writeIndex(removeEntry(readIndex(), levelId));
}

/** `file:///…` → `/…` for the native modules, which take plain paths. */
export function toPath(uri: string): string {
  return decodeURI(uri.replace(/^file:\/\//, ''));
}
