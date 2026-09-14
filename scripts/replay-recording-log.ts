import assert from 'node:assert/strict';
import {
  CACHE_CAPACITY,
  parseCacheIndex,
  removeEntry,
  sortedEntries,
  touchEntry,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/compositeCachePolicy.ts';
import {
  buildCompositionPlan,
  cameraCropRect,
  CAMERA_REGION,
  CAMERA_SOURCE,
  END_CARD_SEC,
  FREEZE_FRAME_SEC,
  focusYFromLog,
  normalizeSegments,
  planHud,
  planInserts,
  SAFE_ZONE,
  validateCompositionPlan,
  type CompositionPlan,
  type PlanInsert,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/compositionPlan.ts';
import type { CueJudgement, CueScore } from '../src/lib/cueScoring';
import {
  MAX_LOG_EVENTS,
  MAX_LOG_SEGMENTS,
  parseRunLog,
  RunRecordingLog,
  serializeRunLog,
  type RunLogFile,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/runRecordingLog.ts';
// @ts-expect-error -- required by Node's type-stripping ESM resolver
import { RunClock, TICK_INTERVAL_S } from '../src/lib/runClock.ts';
// @ts-expect-error -- required by Node's type-stripping ESM resolver
import { getCompositeGameSource } from '../src/lib/videoSources.ts';

const close = (actual: number, expected: number, message?: string, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${message ?? ''} expected ${expected}, got ${actual}`);

const META = {
  levelId: 'neon-rails',
  levelName: 'Neon Rails',
  intensity: 'active',
  playbackRate: 1,
  targetSeconds: 300,
  hudThemeId: 'volt',
};

const THEME = { accent: '#D7FF3E', perfect: '#D7FF3E', good: '#3DC5F0', miss: '#FF5C8A' };
const END_CARD = { levelName: 'Neon Rails', score: 4210, accuracyPct: 91, maxCombo: 18, personalBest: true };

const score = (s: number, c: number): CueScore => ({
  score: s,
  combo: c,
  maxCombo: c,
  perfect: 0,
  good: 0,
  miss: 0,
  spurious: 0,
  lastGrade: null,
  judgements: 0,
  lastDeltaMs: null,
});

const judgement = (grade: 'perfect' | 'good' | 'miss', move: 'jump' | 'duck' | 'left' | 'right', deltaMs: number | null): CueJudgement => ({
  grade,
  cue: { t: 1, move, at: 1, loop: 0, index: 0 },
  deltaMs,
  points: grade === 'perfect' ? 100 : grade === 'good' ? 50 : 0,
});

/**
 * Drive a RunClock and the log together the way workout.tsx does: every
 * timeUpdate tick is classified by the clock and forwarded with the gate.
 */
function drive(
  clock: RunClock,
  log: RunRecordingLog,
  from: number,
  to: number,
  rate: number,
  now: { t: number },
) {
  const step = TICK_INTERVAL_S * rate;
  let position = from;
  while (position + step <= to + 1e-9) {
    position += step;
    now.t += TICK_INTERVAL_S * 1000;
    const kind = clock.tick(position, now.t);
    log.onTick(kind, position, clock.isAdvancing(), now.t);
  }
  return position;
}

// ---------------------------------------------------------------------------
// 1. Segment map: straight play at 1.2x, a pause, a loop wrap, a stall, a seek.
{
  const now = { t: 1_000_000 };
  const rate = 1.2;
  const clock = new RunClock({ playbackRate: rate, loop: true });
  const log = new RunRecordingLog({ ...META, playbackRate: rate });
  const length = 100;
  clock.start(0, length, now.t);
  log.anchor(0);
  log.setVideoLength(length);
  clock.setReady(true);
  clock.setPlaying(true, 0, now.t);
  log.onGate(clock.isAdvancing(), 0);
  // Recording starts 200 ms after playback began (the writer's first frame).
  const startedAt = now.t + 200;
  log.begin(startedAt);

  let position = drive(clock, log, 0, 12, rate, now); // 10 s of wall time, 12 s of video
  // Pause 5 s.
  clock.setPlaying(false, position, now.t);
  log.onGate(clock.isAdvancing(), position);
  now.t += 5_000;
  clock.setPlaying(true, position, now.t);
  log.onGate(clock.isAdvancing(), position);
  // Play to just before the end, then wrap.
  position = drive(clock, log, position, 99.6, rate, now);
  now.t += 500;
  assert.equal(clock.tick(0.2, now.t), 'wrap');
  log.onTick('wrap', 0.2, clock.isAdvancing(), now.t);
  position = drive(clock, log, 0.2, 6.2, rate, now);
  // Stall (buffering: same position twice) then resume.
  now.t += 500;
  assert.equal(clock.tick(position, now.t), 'stall');
  log.onTick('stall', position, clock.isAdvancing(), now.t);
  position = drive(clock, log, position, 9.2, rate, now);
  // Seek forward.
  now.t += 500;
  assert.equal(clock.tick(50, now.t), 'seek');
  log.onTick('seek', 50, clock.isAdvancing(), now.t);
  position = drive(clock, log, 50, 53, rate, now);

  const endAt = now.t;
  log.setSummary({ score: 4210, totalScore: 5000, accuracy: 0.91, maxCombo: 18, perfect: 30, good: 4, miss: 3, elapsedSeconds: 120 });
  log.end(endAt, endAt - startedAt);
  const file = log.toFile();

  // Round trip.
  const parsed = parseRunLog(serializeRunLog(file));
  assert.ok(parsed, 'log parses back');
  assert.deepEqual(parsed, file, 'serialization round-trips exactly');
  assert.equal(parseRunLog('not json'), null);
  assert.equal(parseRunLog(JSON.stringify({ ...file, version: 2 })), null, 'unknown version rejected');
  assert.equal(parseRunLog(JSON.stringify({ ...file, segments: [{ ws: 'x' }] })), null, 'malformed segment rejected');

  // Segments: [0→12 wall 0..10s] [12→100 after the pause] [0→6.2 after the wrap]
  // [6.2→9.2 after the stall] [50→53 after the seek] — five, in wall order.
  assert.equal(file.segments.length, 5, `five segments, got ${JSON.stringify(file.segments)}`);
  const [a, b, c, d, e] = file.segments;
  close(a.vs, 0);
  close(a.ve, 12);
  close(a.ws, -200, 'first segment starts before the recording (back-dated)', 0.6);
  close((a.we - a.ws) / 1000, 10, 'wall length 10 s at 1.2x', 0.01);
  close(b.vs, 12, 'resume anchor');
  close((b.ws - a.we) / 1000, 5, 'pause is a 5 s gap', 0.01);
  close(b.ve, 100, 'segment runs to the source end at the wrap');
  assert.equal(b.loop, 0);
  close(c.vs, 0, 'wrap starts a new pass at 0');
  assert.equal(c.loop, 1);
  close(c.ws, b.we, 'no gap across a wrap', 0.01);
  close(d.vs, 6.2, 'after the stall the segment resumes at the stalled position');
  assert.ok(d.ws >= c.we, 'a stall never overlaps the frozen period');
  close(e.vs, 50, 'seek re-anchors the video position');
  close(e.ve, 53);
  assert.equal(file.recording.cameraDurationMs, endAt - startedAt);

  // Composition plan: inserts tile [0, D + 4] with no gaps; freezes across the
  // pause, the stall and the seek; play ranges scale by the wall/video ratio.
  const D = (endAt - startedAt) / 1000;
  const inserts = planInserts(file.segments, D, length);
  let cursor = 0;
  for (const insert of inserts) {
    close(insert.canvasStart, cursor, 'inserts are contiguous', 1e-6);
    assert.ok(insert.canvasEnd > insert.canvasStart);
    cursor = insert.canvasEnd;
  }
  close(cursor, D + END_CARD_SEC, 'inserts end with the end card');
  const plays = inserts.filter((i): i is Extract<PlanInsert, { kind: 'play' }> => i.kind === 'play');
  assert.equal(plays.length, 5, 'one play insert per segment');
  // The first segment is clipped at the recording start: 0.2 s of wall → 0.24 s of video.
  close(plays[0].canvasStart, 0);
  close(plays[0].gameStart, 0.24, 'pre-recording playback trimmed proportionally', 0.01);
  close(plays[0].gameEnd, 12);
  for (const play of plays) {
    close((play.gameEnd - play.gameStart) / (play.canvasEnd - play.canvasStart), rate, 'scaled at 1.2x', 0.02);
  }
  const freezes = inserts.filter((i): i is Extract<PlanInsert, { kind: 'freeze' }> => i.kind === 'freeze');
  assert.ok(freezes.length >= 3, 'pause, stall/seek gaps and the end card each freeze');
  const pauseFreeze = freezes.find((f) => Math.abs(f.canvasEnd - f.canvasStart - 5) < 0.02);
  assert.ok(pauseFreeze, 'the 5 s pause becomes a 5 s freeze');
  close(pauseFreeze!.gameAt, 12, 'frozen on the last frame before the pause');
  const endCard = inserts[inserts.length - 1];
  assert.equal(endCard.kind, 'freeze');
  close(endCard.canvasEnd - endCard.canvasStart, END_CARD_SEC);
  if (endCard.kind === 'freeze') close(endCard.gameAt, 53, 'end card holds the last played frame');

  // Full plan + invariants.
  const plan: CompositionPlan = buildCompositionPlan(file, {
    gameDurationSec: length,
    cameraDurationSec: D,
    theme: THEME,
    endCard: END_CARD,
  });
  validateCompositionPlan(plan);
  assert.equal(plan.version, 1);
  close(plan.durationSec, D + END_CARD_SEC);
  assert.equal(plan.audio.includeGameAudio, false, 'silent by default');
  assert.equal(plan.endCard.personalBest, true);
  assert.equal(plan.endCard.score, 4210);
  assert.equal(plan.hud.watermark.text, 'CARDIOSURF');
  assert.ok(plan.hud.watermark.x >= SAFE_ZONE.minX && plan.hud.watermark.y >= SAFE_ZONE.minY, 'watermark inside the safe zone');
  assert.ok(plan.hud.scoreAnchor.right <= SAFE_ZONE.maxX);
  assert.ok(plan.hud.popCenter.y < plan.gameRegion.height, 'pops stay in the game half');
  assert.ok(plan.hud.chevronCenter.y < plan.gameRegion.height);
  assert.equal(JSON.parse(JSON.stringify(plan)).inserts.length, plan.inserts.length, 'plan is plain JSON');
  const withAudio = buildCompositionPlan(file, { gameDurationSec: length, cameraDurationSec: D, theme: THEME, endCard: END_CARD, includeGameAudio: true });
  assert.equal(withAudio.audio.includeGameAudio, true);
}

// ---------------------------------------------------------------------------
// 2. Events: judgements, expiries, upcoming transitions → HUD keyframes.
{
  const log = new RunRecordingLog(META);
  const t0 = 5_000_000;
  log.onJudgement(judgement('perfect', 'jump', 40), 1, score(100, 1), t0 - 100); // before begin: dropped
  log.begin(t0);
  log.onUpcoming({ move: 'jump', at: 3 }, t0 + 500);
  log.onUpcoming({ move: 'jump', at: 3 }, t0 + 900); // same cue → no new event
  log.onJudgement(judgement('perfect', 'jump', 40), 3.04, score(100, 1), t0 + 3_000);
  log.onUpcoming({ move: 'duck', at: 5 }, t0 + 3_100);
  log.onJudgement(judgement('good', 'duck', -180), 5.1, score(155, 2), t0 + 5_000);
  log.onUpcoming(null, t0 + 5_100);
  log.onExpiry(1, 8, score(155, 0), t0 + 8_000);
  log.onJudgement({ grade: 'miss', cue: null, deltaMs: null, points: 0 }, 9, score(155, 0), t0 + 9_000);
  log.end(t0 + 10_000, 10_000);
  const file = log.toFile();
  assert.equal(file.events.length, 7);
  assert.equal(file.events[0].k, 'u');
  const j = file.events.find((e) => e.k === 'j');
  assert.ok(j && j.k === 'j' && j.g === 'perfect' && j.d === 40 && j.m === 'jump' && j.s === 100 && j.c === 1);
  const spurious = file.events[file.events.length - 1];
  assert.ok(spurious.k === 'j' && spurious.m === null, 'spurious move keeps a null move');

  const hud = planHud(file.events, 10);
  assert.equal(hud.pops.length, 4, 'three judgements + one expiry pop');
  assert.deepEqual(hud.pops.map((p) => p.text), ['PERFECT', 'GOOD', 'MISS', 'MISS']);
  close(hud.pops[0].at, 3);
  assert.equal(hud.pops[2].grade, 'miss');
  // Score intervals: 0 until 3 s, 100 until 5 s, 155 to the end.
  assert.deepEqual(
    hud.score.map((s) => [s.start, s.end, s.text]),
    [[0, 3, '0'], [3, 5, '100'], [5, 8, '155'], [8, 9, '155'], [9, 10, '155']],
  );
  // Combo shows from 2x only, and the expiry at 8 s resets it.
  assert.deepEqual(hud.combo.map((c) => [c.start, c.end, c.text]), [[5, 8, '2x']]);
  // Chevrons: jump from 0.5 s to 3.1 s, duck from 3.1 s to 5.1 s, none after.
  assert.deepEqual(hud.chevrons.map((c) => [c.start, c.end, c.move]), [[0.5, 3.1, 'jump'], [3.1, 5.1, 'duck']]);
  // Events past the camera duration are excluded.
  assert.equal(planHud(file.events, 4).pops.length, 1);
}

// ---------------------------------------------------------------------------
// 3. Bounded memory: caps + truncated flags, pose focus averaging.
{
  const log = new RunRecordingLog(META);
  log.begin(0);
  for (let i = 0; i < MAX_LOG_EVENTS + 50; i++) {
    log.onJudgement(judgement('perfect', 'jump', 0), i, score(i, 1), i * 10 + 1);
  }
  const file = log.toFile();
  assert.equal(file.events.length, MAX_LOG_EVENTS);
  assert.equal(file.truncated.events, true);
  assert.equal(file.truncated.segments, false);

  const segLog = new RunRecordingLog(META);
  segLog.begin(0);
  segLog.setVideoLength(10_000);
  let pos = 0;
  for (let i = 0; i < MAX_LOG_SEGMENTS + 10; i++) {
    const now = i * 1_000 + 1;
    segLog.onTick('natural', pos + 0.5, true, now);
    segLog.onTick('stall', pos + 0.5, true, now + 500);
    pos += 0.5;
  }
  const segFile = segLog.toFile();
  assert.equal(segFile.segments.length, MAX_LOG_SEGMENTS);
  assert.equal(segFile.truncated.segments, true);

  // Pose focus: mean of nose and hip height across frames; frames missing a
  // joint are skipped, low confidence ignored.
  const focusLog = new RunRecordingLog(META);
  focusLog.onPose({ keypoints: [{ name: 'nose', y: 0.2, confidence: 0.9 }, { name: 'root', y: 0.6, confidence: 0.9 }] });
  focusLog.onPose({ keypoints: [{ name: 'nose', y: 0.3, confidence: 0.9 }, { name: 'leftHip', y: 0.7, confidence: 0.9 }, { name: 'rightHip', y: 0.7, confidence: 0.9 }] });
  focusLog.onPose({ keypoints: [{ name: 'nose', y: 0.9, confidence: 0.1 }, { name: 'root', y: 0.9, confidence: 0.9 }] });
  focusLog.onPose({ keypoints: [{ name: 'root', y: 0.9, confidence: 0.9 }] });
  focusLog.begin(0);
  const focusFile = focusLog.toFile();
  assert.ok(focusFile.pose);
  assert.equal(focusFile.pose!.samples, 2);
  close(focusFile.pose!.headY, 0.25, '', 1e-3);
  close(focusFile.pose!.hipY, 0.65, '', 1e-3);
  close(focusYFromLog(focusFile), 0.45, '', 1e-3);
  assert.equal(focusYFromLog({ pose: null }), 0.5, 'no pose → centre');
}

// ---------------------------------------------------------------------------
// 4. Camera cover-crop with body bias.
{
  // 720×1280 into 720×704: crop height 704, offset range 0..576.
  const centre = cameraCropRect(CAMERA_SOURCE, CAMERA_REGION, 0.5);
  assert.deepEqual(centre, { x: 0, y: 288, width: 720, height: 704 });
  const high = cameraCropRect(CAMERA_SOURCE, CAMERA_REGION, 0.1);
  assert.equal(high.y, 0, 'a body near the top clamps to the top edge');
  const low = cameraCropRect(CAMERA_SOURCE, CAMERA_REGION, 0.95);
  assert.equal(low.y, 576, 'a body near the bottom clamps to the bottom edge');
  const biased = cameraCropRect(CAMERA_SOURCE, CAMERA_REGION, 0.4);
  close(biased.y, 0.4 * 1280 - 352, 'body centred in the region');
  // A 1080×1920 clip (other preset) scales to 720 wide → crop 1056 tall.
  const hd = cameraCropRect({ width: 1080, height: 1920 }, CAMERA_REGION, 0.5);
  close(hd.height, 1056);
  close(hd.y, (1920 - 1056) / 2);
}

// ---------------------------------------------------------------------------
// 5. Segment normalization edge cases: overlaps, clipping to the game asset,
//    empty inputs, a run with no segments at all.
{
  const segs = normalizeSegments(
    [
      { ws: 0, we: 4_000, vs: 0, ve: 4, r: 1, loop: 0 },
      { ws: 3_000, we: 6_000, vs: 3, ve: 6, r: 1, loop: 0 }, // overlaps the first by 1 s
      { ws: 7_000, we: 9_000, vs: 98, ve: 100, r: 1, loop: 0 }, // runs past a 99 s asset
      { ws: 9_500, we: 9_500, vs: 1, ve: 1, r: 1, loop: 0 }, // empty
    ],
    12,
    99,
  );
  assert.equal(segs.length, 3);
  close(segs[1].ws, 4, 'overlap resolved in favour of the earlier segment');
  close(segs[1].vs, 4);
  close(segs[2].ve, 99, 'clipped to the asset length');
  close(segs[2].we, 8, 'wall end shrinks with the clip');

  const none = planInserts([], 3, 60);
  assert.equal(none.length, 2, 'freeze for the run + freeze for the end card');
  assert.equal(none[0].kind, 'freeze');
  close(none[0].canvasEnd, 3);
  close(none[1].canvasEnd, 3 + END_CARD_SEC);
  const short = planInserts([{ ws: 0, we: 1_000, vs: 59.99, ve: 60.99, r: 1, loop: 0 }], 1, 60);
  const lastFreeze = short[short.length - 1];
  assert.ok(lastFreeze.kind === 'freeze' && lastFreeze.gameAt <= 60 - FREEZE_FRAME_SEC + 1e-9, 'freeze frame never past the last frame');

  // A zero-length camera clip still yields a valid (end-card only) plan.
  const emptyFile: RunLogFile = {
    version: 1,
    ...META,
    recording: { startedAtEpochMs: 1, endedAtEpochMs: 2, interruptedAtEpochMs: null, cameraDurationMs: 0 },
    segments: [],
    events: [],
    truncated: { events: false, segments: false },
    pose: null,
    summary: null,
  };
  const emptyPlan = buildCompositionPlan(emptyFile, { gameDurationSec: 60, cameraDurationSec: 0, theme: THEME, endCard: { ...END_CARD, personalBest: false } });
  validateCompositionPlan(emptyPlan);
  close(emptyPlan.durationSec, END_CARD_SEC);
  assert.equal(emptyPlan.inserts.length, 1);
}

// ---------------------------------------------------------------------------
// 6. Interrupted recording: the log ends at the interruption, later ticks are ignored.
{
  const log = new RunRecordingLog(META);
  log.begin(0);
  log.setVideoLength(100);
  log.onTick('natural', 0.5, true, 500);
  log.onTick('natural', 1, true, 1_000);
  log.markInterrupted(1_200, 1_150);
  log.onTick('natural', 1.5, true, 1_500);
  log.onJudgement(judgement('perfect', 'jump', 0), 1.5, score(100, 1), 1_500);
  log.end(2_000, null);
  const file = log.toFile();
  assert.equal(file.recording.interruptedAtEpochMs, 1_200);
  assert.equal(file.recording.endedAtEpochMs, 1_200, 'end() after an interruption keeps the interruption time');
  assert.equal(file.recording.cameraDurationMs, 1_150);
  assert.equal(file.events.length, 0);
  assert.equal(file.segments.length, 1);
  close(file.segments[0].ve, 1);
}

// ---------------------------------------------------------------------------
// 7. Asset URL resolver.
{
  assert.equal(
    getCompositeGameSource('neon-rails'),
    'https://storage.googleapis.com/cardiosurf-mvp-media/composite/level13/game-576.mp4',
  );
  assert.equal(getCompositeGameSource('wild-city'), 'https://storage.googleapis.com/cardiosurf-mvp-media/composite/level1/game-576.mp4');
  assert.equal(getCompositeGameSource('not-a-level'), null);
  assert.equal(getCompositeGameSource(undefined), null);
}

// ---------------------------------------------------------------------------
// 8. Composite cache LRU (capacity 3).
{
  assert.equal(CACHE_CAPACITY, 3);
  let index = parseCacheIndex(null);
  assert.deepEqual(index.entries, []);
  let evicted: string[];
  ({ index, evicted } = touchEntry(index, 'a', 1, 100));
  assert.deepEqual(evicted, []);
  ({ index, evicted } = touchEntry(index, 'b', 2, 100));
  ({ index, evicted } = touchEntry(index, 'c', 3, 100));
  assert.deepEqual(evicted, []);
  assert.deepEqual(sortedEntries(index).map((e) => e.levelId), ['c', 'b', 'a']);
  // Reading `a` makes it most recent; adding `d` then evicts `b`.
  ({ index, evicted } = touchEntry(index, 'a', 4));
  assert.deepEqual(evicted, []);
  assert.equal(index.entries.find((e) => e.levelId === 'a')!.bytes, 100, 'a touch keeps the known size');
  ({ index, evicted } = touchEntry(index, 'd', 5, 200));
  assert.deepEqual(evicted, ['b']);
  assert.deepEqual(sortedEntries(index).map((e) => e.levelId), ['d', 'a', 'c']);
  // Round trip through JSON, with garbage tolerated.
  const parsed = parseCacheIndex(JSON.stringify(index));
  assert.deepEqual(sortedEntries(parsed), sortedEntries(index));
  assert.deepEqual(parseCacheIndex('{"version":1,"entries":[{"levelId":"x","lastUsedAt":"no"},null,{"levelId":"y","lastUsedAt":3}]}').entries, [
    { levelId: 'y', lastUsedAt: 3, bytes: 0 },
  ]);
  assert.deepEqual(parseCacheIndex('garbage').entries, []);
  assert.deepEqual(parseCacheIndex('{"version":2,"entries":[]}').entries, []);
  // Duplicates collapse to the latest use.
  assert.deepEqual(
    parseCacheIndex('{"version":1,"entries":[{"levelId":"z","lastUsedAt":1,"bytes":1},{"levelId":"z","lastUsedAt":9,"bytes":2}]}').entries,
    [{ levelId: 'z', lastUsedAt: 9, bytes: 2 }],
  );
  index = removeEntry(index, 'a');
  assert.deepEqual(sortedEntries(index).map((e) => e.levelId), ['d', 'c']);
}

console.log(
  'Recording log replay passed: serialization round-trip + rejection of malformed input, RunClock segment map (pause gap, loop wrap, stall, seek, pre-recording trim) → contiguous composition inserts scaled 1.2x with freezes and a 4 s end card, HUD keyframes (pops, score/combo intervals, chevrons), bounded caps, pose-biased cover crop, interruption, asset URL resolver, cache LRU of 3',
);
