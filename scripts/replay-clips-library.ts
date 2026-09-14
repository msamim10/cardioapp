import assert from 'node:assert/strict';
import {
  addClip,
  applyClipRetention,
  CLIPS_MAX_BYTES,
  CLIPS_MAX_COUNT,
  DEFAULT_CLIP_RETENTION,
  findClip,
  parseClipsIndex,
  removeClip,
  serializeClipsIndex,
  sortClips,
  totalClipBytes,
  type ClipEntry,
  type ClipsIndex,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/clipsLibraryPolicy.ts';

const MB = 1024 * 1024;

const clip = (id: string, createdAt: number, bytes = 50 * MB, extra: Partial<ClipEntry> = {}): ClipEntry => ({
  id,
  levelId: 'neon-rails',
  score: 4210,
  accuracy: 0.91,
  createdAt,
  path: `${id}.mp4`,
  thumbPath: `${id}.jpg`,
  bytes,
  durationMs: 300_000,
  ...extra,
});

const ids = (entries: readonly ClipEntry[]) => entries.map((e) => e.id);

// ---------------------------------------------------------------------------
// 1. Defaults.
assert.equal(CLIPS_MAX_COUNT, 10);
assert.equal(CLIPS_MAX_BYTES, 1024 * MB, '1 GiB');
assert.deepEqual(DEFAULT_CLIP_RETENTION, { maxCount: 10, maxBytes: 1024 * MB });

// ---------------------------------------------------------------------------
// 2. Count cap: 12 clips of 50 MB → the 10 newest stay, the 2 oldest go.
{
  const entries = Array.from({ length: 12 }, (_, i) => clip(`c${i}`, 1_000 + i));
  const { keep, evict } = applyClipRetention(entries);
  assert.equal(keep.length, 10);
  assert.deepEqual(ids(evict), ['c1', 'c0'], 'oldest evicted first');
  assert.deepEqual(ids(keep)[0], 'c11', 'newest first');
  assert.equal(totalClipBytes(keep), 500 * MB);
}

// ---------------------------------------------------------------------------
// 3. Byte cap: 5 clips of 300 MB → only 3 fit in 1 GiB even though the count allows 10.
{
  const entries = Array.from({ length: 5 }, (_, i) => clip(`b${i}`, 2_000 + i, 300 * MB));
  const { keep, evict } = applyClipRetention(entries);
  assert.deepEqual(ids(keep), ['b4', 'b3', 'b2']);
  assert.deepEqual(ids(evict), ['b1', 'b0']);
  assert.ok(totalClipBytes(keep) <= CLIPS_MAX_BYTES);
}

// ---------------------------------------------------------------------------
// 4. The newest clip is always kept, even when it alone exceeds the byte cap;
//    a later small clip that would still overflow is evicted, not squeezed in.
{
  const huge = clip('huge', 9_000, 2 * 1024 * MB);
  const small = clip('small', 8_000, 1 * MB);
  const { keep, evict } = applyClipRetention([small, huge]);
  assert.deepEqual(ids(keep), ['huge']);
  assert.deepEqual(ids(evict), ['small']);
  // Byte cap of 0 still keeps exactly one (the newest).
  const zero = applyClipRetention([small, huge], { maxCount: 10, maxBytes: 0 });
  assert.deepEqual(ids(zero.keep), ['huge']);
  // maxCount below 1 is treated as 1.
  const one = applyClipRetention([small, huge], { maxCount: 0, maxBytes: CLIPS_MAX_BYTES });
  assert.deepEqual(ids(one.keep), ['huge']);
}

// ---------------------------------------------------------------------------
// 5. Walk order is strictly newest → oldest: once a clip does not fit, older
//    ones are still considered (a small older clip may fit after a big one is skipped).
{
  const entries = [
    clip('n1', 5_000, 600 * MB),
    clip('n2', 4_000, 500 * MB), // 1100 MB > cap → evicted
    clip('n3', 3_000, 100 * MB), // 700 MB → kept
  ];
  const { keep, evict } = applyClipRetention(entries);
  assert.deepEqual(ids(keep), ['n1', 'n3']);
  assert.deepEqual(ids(evict), ['n2']);
}

// ---------------------------------------------------------------------------
// 6. addClip / removeClip / findClip: replace by id, never evict the new clip.
{
  let index: ClipsIndex = parseClipsIndex(null);
  assert.deepEqual(index, { version: 1, entries: [] });
  let evicted: ClipEntry[];
  for (let i = 0; i < 10; i++) {
    ({ index, evicted } = addClip(index, clip(`r${i}`, 10_000 + i)));
    assert.deepEqual(evicted, []);
  }
  assert.equal(index.entries.length, 10);
  ({ index, evicted } = addClip(index, clip('r10', 10_010)));
  assert.deepEqual(ids(evicted), ['r0'], 'the 11th clip evicts the oldest');
  assert.equal(index.entries.length, 10);
  assert.equal(index.entries[0].id, 'r10', 'index is kept newest first');

  // Re-registering an id replaces the entry (compose retry) without counting twice.
  ({ index, evicted } = addClip(index, clip('r10', 10_010, 70 * MB)));
  assert.deepEqual(evicted, []);
  assert.equal(index.entries.filter((e) => e.id === 'r10').length, 1);
  assert.equal(findClip(index, 'r10')!.bytes, 70 * MB);

  // A new clip with an older stamp is still protected from its own eviction.
  const tenFull = Array.from({ length: 10 }, (_, i) => clip(`f${i}`, 20_000 + i));
  const full: ClipsIndex = { version: 1, entries: tenFull };
  const late = addClip(full, clip('late', 1));
  assert.ok(findClip(late.index, 'late'), 'new clip is kept');
  assert.equal(late.index.entries.length, 10);
  assert.deepEqual(ids(late.evicted), ['f0'], 'the oldest other clip goes instead');

  // Oversized new clip evicts everything else but itself.
  const big = addClip(full, clip('big', 30_000, 3 * 1024 * MB));
  assert.deepEqual(ids(big.index.entries), ['big']);
  assert.equal(big.evicted.length, 10);
  assert.ok(!big.evicted.some((e) => e.id === 'big'));

  index = removeClip(index, 'r10');
  assert.equal(findClip(index, 'r10'), null);
  assert.equal(index.entries.length, 9);
  assert.deepEqual(removeClip(index, 'nope'), index, 'removing an unknown id is a no-op');
}

// ---------------------------------------------------------------------------
// 7. parseClipsIndex: round trip, tolerance, dedupe, clamping.
{
  const a = clip('a', 3);
  const b = clip('b', 2, 10 * MB, { thumbPath: null });
  const json = serializeClipsIndex({ version: 1, entries: [b, a] });
  const parsed = parseClipsIndex(json);
  assert.deepEqual(parsed.entries, [a, b], 'serialized newest first and round-trips');
  assert.deepEqual(parseClipsIndex('garbage'), { version: 1, entries: [] });
  assert.deepEqual(parseClipsIndex('{"version":2,"entries":[]}'), { version: 1, entries: [] });
  assert.deepEqual(parseClipsIndex('{"version":1}'), { version: 1, entries: [] });
  const messy = parseClipsIndex(
    JSON.stringify({
      version: 1,
      entries: [
        null,
        { id: 'x' }, // no path/createdAt → dropped
        { id: 'y', path: 'y.mp4', createdAt: 5, score: -3, accuracy: 4, bytes: 'big', thumbPath: '' },
        { id: 'y', path: 'y2.mp4', createdAt: 7 }, // duplicate id → latest wins
        { id: 'z', path: 'z.mp4', createdAt: 'no' },
      ],
    }),
  );
  assert.equal(messy.entries.length, 1);
  assert.deepEqual(messy.entries[0], {
    id: 'y',
    levelId: '',
    score: 0,
    accuracy: 0,
    createdAt: 7,
    path: 'y2.mp4',
    thumbPath: null,
    bytes: 0,
    durationMs: 0,
  });
  const clamped = parseClipsIndex(
    JSON.stringify({ version: 1, entries: [{ id: 'q', path: 'q.mp4', createdAt: 1, score: -1, accuracy: 1.5, thumbPath: '' }] }),
  );
  assert.equal(clamped.entries[0].score, 0);
  assert.equal(clamped.entries[0].accuracy, 1);
  assert.equal(clamped.entries[0].thumbPath, null, 'empty thumb path reads as none');
}

// ---------------------------------------------------------------------------
// 8. sortClips is stable on equal stamps and does not mutate its input.
{
  const same = [clip('m2', 1), clip('m1', 1), clip('m3', 2)];
  const sorted = sortClips(same);
  assert.deepEqual(ids(sorted), ['m3', 'm1', 'm2']);
  assert.deepEqual(ids(same), ['m2', 'm1', 'm3'], 'input untouched');
}

console.log(
  'Clips library replay passed: defaults (10 clips / 1 GiB), count cap, byte cap, newest-always-kept, newest→oldest walk, addClip replace/protect/evict, removeClip, tolerant index parse + round trip, stable sort',
);
