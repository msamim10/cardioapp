/**
 * On-device clips library: every composed run video ("clip") lives under
 * `<Documents>/clips/` next to its JPEG thumbnail, indexed by
 * `clips/index.json` (`{ id, levelId, score, accuracy, createdAt, path,
 * thumbPath, bytes, durationMs }`). Documents rather than Caches so iOS never
 * purges a clip the user has not chosen to delete. Retention (newest 10 or
 * 1 GiB, oldest evicted first) is the pure policy in `clipsLibraryPolicy.ts`.
 *
 * Paths in the index are file names relative to the clips directory because
 * the app container path changes between installs; `Clip` resolves them to
 * absolute paths (no `file://`) for the native modules, expo-video, sharing.
 */

import { Directory, File, Paths } from 'expo-file-system';
import {
  addClip,
  findClip,
  parseClipsIndex,
  removeClip,
  serializeClipsIndex,
  sortClips,
  type ClipEntry,
  type ClipsIndex,
} from '@/lib/clipsLibraryPolicy';

export type {
  ClipEntry,
  ClipsIndex,
  ClipRetentionPolicy,
} from '@/lib/clipsLibraryPolicy';
export {
  CLIPS_MAX_BYTES,
  CLIPS_MAX_COUNT,
  DEFAULT_CLIP_RETENTION,
  applyClipRetention,
  parseClipsIndex,
} from '@/lib/clipsLibraryPolicy';

const DIR_NAME = 'clips';
const INDEX_FILE = 'index.json';

/** An index entry with its files resolved to absolute paths. */
export type Clip = ClipEntry & {
  filePath: string;
  thumbFilePath: string | null;
};

function clipsDir(): Directory {
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) {
    try {
      dir.create({ intermediates: true, idempotent: true });
    } catch {
      // Created concurrently.
    }
  }
  return dir;
}

function safeStem(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Absolute path (no `file://`) of the clips directory. */
export function clipsDirPath(): string {
  return toPath(clipsDir().uri);
}

/** Where a clip with this id is (or will be) stored. Used as the composer's output path. */
export function clipVideoPath(id: string): string {
  return toPath(new File(clipsDir(), `${safeStem(id)}.mp4`).uri);
}

export function clipThumbnailPath(id: string): string {
  return toPath(new File(clipsDir(), `${safeStem(id)}.jpg`).uri);
}

function readIndex(): ClipsIndex {
  try {
    const file = new File(clipsDir(), INDEX_FILE);
    return parseClipsIndex(file.exists ? file.textSync() : null);
  } catch {
    return parseClipsIndex(null);
  }
}

function writeIndex(index: ClipsIndex): void {
  try {
    new File(clipsDir(), INDEX_FILE).write(serializeClipsIndex(index));
  } catch {
    // Losing the index only hides clips from the library; the files stay.
  }
}

function resolve(entry: ClipEntry): Clip {
  const dir = clipsDir();
  return {
    ...entry,
    filePath: toPath(new File(dir, entry.path).uri),
    thumbFilePath: entry.thumbPath ? toPath(new File(dir, entry.thumbPath).uri) : null,
  };
}

function deleteFiles(entry: Pick<ClipEntry, 'path' | 'thumbPath'>): void {
  const dir = clipsDir();
  for (const name of [entry.path, entry.thumbPath]) {
    if (!name) continue;
    try {
      const file = new File(dir, name);
      if (file.exists) file.delete();
    } catch {
      // Already gone.
    }
  }
}

/** Newest first. Entries whose video file has vanished are dropped from the index. */
export function listClips(): Clip[] {
  const index = readIndex();
  const present: ClipEntry[] = [];
  let dirty = false;
  for (const entry of index.entries) {
    const clip = resolve(entry);
    let exists = false;
    try {
      exists = new File(toFileUri(clip.filePath)).exists;
    } catch {
      exists = false;
    }
    if (exists) present.push(entry);
    else dirty = true;
  }
  if (dirty) writeIndex({ version: 1, entries: present });
  return sortClips(present).map(resolve);
}

export function getClip(id: string): Clip | null {
  const entry = findClip(readIndex(), id);
  return entry ? resolve(entry) : null;
}

export type RegisterClipInput = {
  id: string;
  levelId: string;
  score: number;
  accuracy: number;
  createdAt: number;
  durationMs: number;
  /** Absolute path of the composed video. Moved into the clips directory unless already there. */
  sourcePath: string;
  sourceThumbPath: string | null;
};

/**
 * Add a composed video to the library: move the file (and thumbnail) into
 * the clips directory if needed, write the index entry, evict what the
 * retention policy drops. Returns the registered clip, or null when the video
 * file could not be placed (the caller keeps its original path).
 */
export function registerClip(input: RegisterClipInput): Clip | null {
  try {
    const dir = clipsDir();
    const stem = safeStem(input.id);
    const videoName = `${stem}.mp4`;
    const thumbName = `${stem}.jpg`;
    const video = placeFile(input.sourcePath, new File(dir, videoName));
    if (!video) return null;
    const thumb = input.sourceThumbPath ? placeFile(input.sourceThumbPath, new File(dir, thumbName)) : null;
    const entry: ClipEntry = {
      id: input.id,
      levelId: input.levelId,
      score: Math.max(0, Math.round(input.score)),
      accuracy: Math.min(1, Math.max(0, input.accuracy)),
      createdAt: input.createdAt,
      path: videoName,
      thumbPath: thumb ? thumbName : null,
      bytes: video.size,
      durationMs: Math.max(0, input.durationMs),
    };
    const { index, evicted } = addClip(readIndex(), entry);
    evicted.forEach(deleteFiles);
    writeIndex(index);
    return resolve(entry);
  } catch {
    return null;
  }
}

/** Move `sourcePath` onto `target` (no-op when they are the same file). */
function placeFile(sourcePath: string, target: File): File | null {
  const source = new File(toFileUri(sourcePath));
  if (!source.exists) return null;
  if (toPath(source.uri) === toPath(target.uri)) return source;
  try {
    if (target.exists) target.delete();
  } catch {
    // Overwritten below.
  }
  source.move(target);
  return target;
}

/** Remove the clip's video, thumbnail and index entry. Idempotent. */
export function deleteClip(id: string): void {
  const index = readIndex();
  const entry = findClip(index, id);
  if (entry) {
    deleteFiles(entry);
  } else {
    // Not indexed (e.g. compose finished but registration failed): still clean the files.
    deleteFiles({ path: `${safeStem(id)}.mp4`, thumbPath: `${safeStem(id)}.jpg` });
  }
  writeIndex(removeClip(index, id));
}

/** `file:///…` → `/…` for the native modules, which take plain paths. */
export function toPath(uri: string): string {
  return decodeURI(uri.replace(/^file:\/\//, ''));
}

export function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${encodeURI(path)}`;
}
