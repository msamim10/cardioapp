import assert from 'node:assert/strict';
// Node 24 executes this TypeScript replay directly; the app compiler otherwise
// intentionally disallows source imports with a .ts suffix.
// @ts-expect-error -- required by Node's type-stripping ESM resolver
import { applyRecognizedMove, INITIAL_POSE_SCORE } from '../src/lib/poseTracking.ts';
import type { PoseScore } from '../src/lib/poseTracking';
import {
  LOOP_WRAP_WINDOW_S,
  naturalMaxDeltaS,
  RunClock,
  SEEK_SCORING_PAUSE_MS,
  SWAP_WRAP_SUPPRESS_MS,
  TICK_INTERVAL_S,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/runClock.ts';

const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} expected ${expected}, got ${actual}`);

/** Drive a clock with regular ticks like expo-video at `rate` from `from` to `to` video seconds. */
function play(clock: RunClock, from: number, to: number, rate: number, now: { t: number }) {
  const step = TICK_INTERVAL_S * rate;
  let position = from;
  while (position + step <= to + 1e-9) {
    position += step;
    now.t += TICK_INTERVAL_S * 1000;
    assert.equal(clock.tick(position, now.t), 'natural');
  }
  return position;
}

/** What the workout does with a recognized move: score only through the gate. */
function recognize(clock: RunClock, score: PoseScore, now: number): PoseScore {
  if (!clock.isScoringActive(now)) return score;
  return applyRecognizedMove(score, 'Jump', Math.round(clock.videoTimeSec(now) * 1000));
}

// naturalMax: two intervals of slack, floored at 1.5 s.
close(naturalMaxDeltaS(0.5, 1), 1.5);
close(naturalMaxDeltaS(0.5, 1.2), 1.5);
close(naturalMaxDeltaS(1, 1.2), 2.4);

// Pause mid-combo: moves during the pause neither score nor build a combo;
// the wall clock advancing 20 s while paused does not break the video-time combo.
{
  const now = { t: 1_000_000 };
  const clock = new RunClock({ playbackRate: 1, loop: true });
  clock.start(0, 120, now.t);
  clock.setReady(true);
  clock.setPlaying(true, 0, now.t);
  let position = play(clock, 0, 10, 1, now);
  let score = recognize(clock, INITIAL_POSE_SCORE, now.t);
  assert.equal(score.combo, 1);
  assert.equal(score.score, 30);

  clock.setPlaying(false, position, now.t);
  assert.equal(clock.isScoringActive(now.t), false);
  now.t += 20_000; // 20 s paused on the wall clock
  const paused = recognize(clock, score, now.t);
  assert.deepEqual(paused, score, 'a move while paused must not score');
  close(clock.videoTimeSec(now.t), 10, 'paused video time does not extrapolate');

  clock.setPlaying(true, position, now.t);
  // Phantom-delta guard: the first tick after resume is a natural half-second.
  now.t += 500;
  assert.equal(clock.tick(position + 0.5, now.t), 'natural');
  position += 0.5;
  score = recognize(clock, score, now.t);
  assert.equal(score.combo, 2, 'video-time combo continues across a pause');
  assert.equal(score.maxCombo, 2);
  close(clock.videoPlayedSec, 10.5);
  close(clock.wallElapsedSec(), 10.5);
}

// Combo window is video time: 3 s of video breaks it, regardless of wall time.
{
  const now = { t: 5_000_000 };
  const clock = new RunClock({ playbackRate: 1, loop: true });
  clock.start(0, 120, now.t);
  clock.setReady(true);
  clock.setPlaying(true, 0, now.t);
  play(clock, 0, 5, 1, now);
  let score = recognize(clock, INITIAL_POSE_SCORE, now.t);
  play(clock, 5, 8.5, 1, now);
  score = recognize(clock, score, now.t);
  assert.equal(score.combo, 1, 'more than 3 s of video resets the combo');
}

// Forward seek: not credited, anchor moves, scoring pauses briefly.
{
  const now = { t: 2_000_000 };
  const clock = new RunClock({ playbackRate: 1, loop: true });
  clock.start(0, 120, now.t);
  clock.setReady(true);
  clock.setPlaying(true, 0, now.t);
  play(clock, 0, 10, 1, now);
  now.t += 500;
  assert.equal(clock.tick(40, now.t), 'seek');
  close(clock.videoPlayedSec, 10, 'seek is not credited');
  assert.equal(clock.isScoringActive(now.t), false, 'scoring pauses after a seek');
  assert.equal(clock.isScoringActive(now.t + SEEK_SCORING_PAUSE_MS), true);
  now.t += 500;
  assert.equal(clock.tick(40.5, now.t), 'natural', 'anchor moved to the seek target');
  close(clock.videoPlayedSec, 10.5);
  // A 2 s forward jump (< 30 s) is still a seek under the new rule.
  now.t += 500;
  assert.equal(clock.tick(42.6, now.t), 'seek');
  close(clock.videoPlayedSec, 10.5);
  assert.equal(clock.seekCount, 2);
}

// Backward seek (not near the end): treated as a seek, not a wrap.
{
  const now = { t: 3_000_000 };
  const clock = new RunClock({ playbackRate: 1, loop: true });
  clock.start(0, 120, now.t);
  clock.setReady(true);
  clock.setPlaying(true, 0, now.t);
  play(clock, 0, 60, 1, now);
  now.t += 500;
  assert.equal(clock.tick(20, now.t), 'seek');
  close(clock.videoPlayedSec, 60);
}

// Loop wrap at 1.2x: tail of pass one + head of pass two credited exactly once.
{
  const now = { t: 4_000_000 };
  const clock = new RunClock({ playbackRate: 1.2, loop: true });
  const length = 100;
  clock.start(0, length, now.t);
  clock.setReady(true);
  clock.setPlaying(true, 0, now.t);
  // 0.6 s per tick at 1.2x; land at 99.6 then wrap to 0.2.
  const position = play(clock, 0, 99.6, 1.2, now);
  close(position, 99.6);
  now.t += 500;
  assert.equal(clock.tick(0.2, now.t), 'wrap');
  close(clock.videoPlayedSec, 100.2);
  close(clock.wallElapsedSec(), 100.2 / 1.2);
  assert.equal(clock.wrapCount, 1);
  assert.equal(clock.isScoringActive(now.t), true, 'a wrap does not pause scoring');
}

// Late tick wrap: the tick before the wrap was missed (last = length − 4 s,
// outside LOOP_WRAP_WINDOW_S) but total travelled is within 2× the window.
{
  const now = { t: 6_000_000 };
  const clock = new RunClock({ playbackRate: 1, loop: true });
  const length = 100;
  clock.start(0, length, now.t);
  clock.setReady(true);
  clock.setPlaying(true, 0, now.t);
  play(clock, 0, 96, 1, now);
  now.t += 1_500; // stalled JS thread: one late tick after the wrap
  assert.equal(clock.tick(1, now.t), 'wrap');
  close(clock.videoPlayedSec, 101);
  // But a jump from 90 back to 1 (travelled 11 s) is a seek, not a wrap.
  const seekClock = new RunClock({ playbackRate: 1, loop: true });
  seekClock.start(0, length, now.t);
  seekClock.setReady(true);
  seekClock.setPlaying(true, 0, now.t);
  play(seekClock, 0, 90, 1, now);
  now.t += 500;
  assert.equal(seekClock.tick(1, now.t), 'seek');
  close(seekClock.videoPlayedSec, 90);
  assert.equal(LOOP_WRAP_WINDOW_S, 3);
}

// Untimed runs (loop = false) never see a wrap: a backward jump is a seek.
{
  const now = { t: 6_500_000 };
  const clock = new RunClock({ playbackRate: 1, loop: false });
  clock.start(0, 100, now.t);
  clock.setReady(true);
  clock.setPlaying(true, 0, now.t);
  play(clock, 0, 99.5, 1, now);
  now.t += 500;
  assert.equal(clock.tick(0.2, now.t), 'seek');
}

// AirPlay swap early (< 30 s in): ticks during the swap are ignored, the
// first post-swap tick from the new source reporting 0 is a seek (never a
// wrap), and the resumed position is credited exactly once.
function airplaySwap(resumeAt: number) {
  const now = { t: 7_000_000 };
  const clock = new RunClock({ playbackRate: 1, loop: true });
  clock.start(0, 120, now.t);
  clock.setReady(true);
  clock.setPlaying(true, 0, now.t);
  play(clock, 0, resumeAt, 1, now);
  close(clock.videoPlayedSec, resumeAt);

  clock.beginSwap();
  assert.equal(clock.isScoringActive(now.t), false, 'no scoring during the swap');
  now.t += 500;
  assert.equal(clock.tick(0, now.t), 'ignored');
  now.t += 500;
  assert.equal(clock.tick(0.3, now.t), 'ignored');
  close(clock.videoPlayedSec, resumeAt, 'swap ticks are never credited');

  // Horizontal cut is 2 s longer; currentTime restored to resumeAt.
  now.t += 200;
  clock.endSwap(resumeAt, 122, now.t);
  close(clock.videoLengthSec, 122, 'duration re-read from the new source');
  assert.equal(clock.isScoringActive(now.t), true);

  // A straggler tick from before the restore reads ~0: seek, not a wrap.
  now.t += 100;
  assert.equal(clock.tick(0.05, now.t), 'seek');
  close(clock.videoPlayedSec, resumeAt);
  // The restore lands: forward jump back to resumeAt is a seek too (no credit).
  now.t += 400;
  assert.equal(clock.tick(resumeAt + 0.1, now.t), 'seek');
  close(clock.videoPlayedSec, resumeAt);
  // Then natural playback resumes and is credited.
  now.t += 500;
  assert.equal(clock.tick(resumeAt + 0.6, now.t), 'natural');
  close(clock.videoPlayedSec, resumeAt + 0.5, 'post-swap playback credited exactly once');
  assert.equal(clock.wrapCount, 0);
  return { clock, now };
}
airplaySwap(12); // early
airplaySwap(75); // late (> 30 s)

// Clean swap (first post-swap tick already at resumeAt) credits directly.
{
  const now = { t: 8_000_000 };
  const clock = new RunClock({ playbackRate: 1, loop: true });
  clock.start(0, 120, now.t);
  clock.setReady(true);
  clock.setPlaying(true, 0, now.t);
  play(clock, 0, 40, 1, now);
  clock.beginSwap();
  now.t += 700;
  clock.endSwap(40, 120, now.t);
  now.t += 500;
  assert.equal(clock.tick(40.5, now.t), 'natural');
  close(clock.videoPlayedSec, 40.5);
}

// Swap right before the loop end: the 0-report after the swap must not be
// mistaken for a wrap while suppression is active.
{
  const now = { t: 9_000_000 };
  const clock = new RunClock({ playbackRate: 1, loop: true });
  clock.start(0, 100, now.t);
  clock.setReady(true);
  clock.setPlaying(true, 0, now.t);
  play(clock, 0, 98, 1, now);
  clock.beginSwap();
  now.t += 700;
  clock.endSwap(98, 100, now.t);
  now.t += 100;
  assert.equal(clock.tick(0, now.t), 'seek', 'wrap suppressed right after a swap');
  close(clock.videoPlayedSec, 98);
  // After suppression lapses, a genuine wrap is accepted again.
  now.t += 500;
  assert.equal(clock.tick(98.5, now.t), 'seek'); // restore lands
  now.t += SWAP_WRAP_SUPPRESS_MS;
  now.t += 500;
  assert.equal(clock.tick(99, now.t), 'natural');
  now.t += 500;
  assert.equal(clock.tick(99.5, now.t), 'natural');
  now.t += 500;
  assert.equal(clock.tick(0.2, now.t), 'wrap');
  close(clock.videoPlayedSec, 98 + 0.5 + 0.5 + 0.5 + 0.2);
}

// Buffering / not ready closes the gate; a stall tick credits nothing.
{
  const now = { t: 10_000_000 };
  const clock = new RunClock({ playbackRate: 1, loop: true });
  clock.start(0, 100, now.t);
  clock.setReady(true);
  clock.setPlaying(true, 0, now.t);
  play(clock, 0, 3, 1, now);
  clock.setReady(false);
  assert.equal(clock.isScoringActive(now.t), false);
  now.t += 500;
  assert.equal(clock.tick(3, now.t), 'stall');
  close(clock.videoPlayedSec, 3);
  clock.setReady(true);
  assert.equal(clock.isScoringActive(now.t), true);
}

// Video-time extrapolation between ticks is rate-aware and capped.
{
  const now = { t: 11_000_000 };
  const clock = new RunClock({ playbackRate: 1.2, loop: true });
  clock.start(0, 100, now.t);
  clock.setReady(true);
  clock.setPlaying(true, 0, now.t);
  play(clock, 0, 6, 1.2, now);
  close(clock.videoTimeSec(now.t), 6);
  close(clock.videoTimeSec(now.t + 250), 6.3);
  close(clock.videoTimeSec(now.t + 5_000), 6.75, 'extrapolation is capped');
}

console.log(
  'Run clock replay passed: pause gates scoring and preserves video-time combo, forward/backward seeks not credited, loop wrap credited once at 1.2x, late-tick wrap, AirPlay swap early/late credited once with wrap suppression, buffering gate, extrapolation cap',
);
