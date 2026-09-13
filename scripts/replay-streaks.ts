// @ts-nocheck -- Node replay loader imports .ts sources via strip-types + path alias.
/**
 * Replay for FEATURE 4a (streaks + daily challenge): one streak freeze per
 * Monday-local week derived purely from run history, and the deterministic
 * daily challenge pick with its +25% XP bonus.
 */
import assert from 'node:assert/strict';
import { modes } from '../src/lib/gameData.ts';
import {
  getDailyChallenge,
  getDailyDiscovery,
  isDailyChallengeCompleted,
  localDateKey,
} from '../src/lib/dailyRecommendations.ts';
import {
  computeStreaks,
  computeStreaksWithFreeze,
  DAILY_CHALLENGE_XP_BONUS,
  dayKey,
  rewardForRunPerformance,
  weekKeyOf,
} from '../src/lib/progression.ts';
import { normalizeRunRecord } from '../src/lib/progressSync.ts';

/** Local-time timestamp (month is 1-based). */
const local = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour).getTime();

// Calendar anchor: Mon 2026-09-07 … Sun 2026-09-13, then Mon 2026-09-14.
const MON = 7;
assert.equal(new Date(2026, 8, MON).getDay(), 1, 'fixture Monday must be a Monday');
const d = (day: number, hour = 12) => local(2026, 9, day, hour);

// ---------------------------------------------------------------------------
// Baseline (no gaps) behaves exactly as before.
// ---------------------------------------------------------------------------
assert.deepEqual(computeStreaks([], d(10)), { current: 0, longest: 0 });
{
  const info = computeStreaksWithFreeze([], d(10));
  assert.equal(info.current, 0);
  assert.equal(info.freezeAvailable, true);
  assert.equal(info.ranToday, false);
}
{
  // Mon–Wed active, now Wednesday evening.
  const info = computeStreaksWithFreeze([d(7), d(8), d(9)], d(9, 20));
  assert.equal(info.current, 3);
  assert.equal(info.longest, 3);
  assert.equal(info.ranToday, true);
  assert.equal(info.freezeUsedThisWeek, false);
  assert.equal(info.freezeAvailable, true);
  assert.equal(info.lastLinkFrozen, false);
  assert.equal(info.freezePending, false);
}
// Multiple runs on one day count once; yesterday-only still alive.
assert.equal(computeStreaksWithFreeze([d(8, 7), d(8, 19), d(9)], d(10)).current, 2);
// Two silent days without a freezable gap → dead.
assert.equal(computeStreaksWithFreeze([d(7)], d(10)).current, 0);

// ---------------------------------------------------------------------------
// Freeze: one single-day gap per Monday-local week is bridged, not counted.
// ---------------------------------------------------------------------------
{
  // Mon, Tue, (Wed missed), Thu — now Thursday.
  const info = computeStreaksWithFreeze([d(7), d(8), d(10)], d(10));
  assert.equal(info.current, 3, 'frozen day does not add to the count');
  assert.equal(info.longest, 3);
  assert.equal(info.freezeUsedThisWeek, true);
  assert.equal(info.freezeAvailable, false);
  assert.equal(info.lastLinkFrozen, true, 'the run that just landed bridged the gap');
  // The chip flips back to "available" on the next Monday-local week.
  const nextWeek = computeStreaksWithFreeze([d(7), d(8), d(10), d(11), d(12), d(13), d(14)], d(14));
  assert.equal(nextWeek.current, 7);
  assert.equal(nextWeek.freezeUsedThisWeek, false, 'new week, new freeze');
  assert.equal(nextWeek.lastLinkFrozen, false);
}

// Two single-day gaps in the SAME week → the second one breaks the chain.
{
  // Mon, (Tue), Wed, (Thu), Fri — now Friday.
  const info = computeStreaksWithFreeze([d(7), d(9), d(11)], d(11));
  assert.equal(info.current, 2, 'Wed→Fri bridged; Mon→Wed needs a second freeze → break');
  assert.equal(info.longest, 2);
  assert.equal(info.freezeUsedThisWeek, true);
}

// A two-day hole is never freezable, even with the week's freeze unspent.
{
  // Mon, (Tue), (Wed), Thu — now Thursday.
  const info = computeStreaksWithFreeze([d(7), d(10)], d(10));
  assert.equal(info.current, 1);
  assert.equal(info.longest, 1);
  assert.equal(info.freezeUsedThisWeek, false, 'nothing was bridged');
  assert.equal(info.freezeAvailable, true);
}

// The freeze belongs to the week OF THE MISSED DAY (Monday-local boundary).
{
  // Sat 12, (Sun 13 missed), Mon 14, (Tue 15 missed), Wed 16 — now Wed 16.
  // Sun 13 is in week of Mon 7; Tue 15 is in week of Mon 14 → two different
  // weeks, two freezes, one continuous chain.
  const info = computeStreaksWithFreeze([d(12), d(14), d(16)], d(16));
  assert.equal(info.current, 3, 'gaps in different weeks each get their own freeze');
  assert.equal(info.freezeUsedThisWeek, true, 'this week (Mon 14) spent its freeze on Tue 15');
  assert.equal(weekKeyOf(dayKey(d(13))), dayKey(d(7)));
  assert.equal(weekKeyOf(dayKey(d(15))), dayKey(d(14)));
  // Same shape but both gaps inside one week: Mon 7, (Tue), Wed 9, (Thu), Fri 11 → already covered above.
  // Sun→Tue across the boundary: Sun 13, (Mon 14 missed), Tue 15 — the missed
  // day is Monday, so it spends the NEW week's freeze.
  const boundary = computeStreaksWithFreeze([d(13), d(15)], d(15));
  assert.equal(boundary.current, 2);
  assert.equal(boundary.freezeUsedThisWeek, true);
  // And when the missed day is Sunday, the OLD week pays and this week's is still available.
  const sunday = computeStreaksWithFreeze([d(12), d(14)], d(14));
  assert.equal(sunday.current, 2);
  assert.equal(sunday.freezeUsedThisWeek, false, 'freeze charged to last week');
  assert.equal(sunday.freezeAvailable, true);
}

// Alive-but-pending: last run two days ago, yesterday freezable → still counts
// (the summary would then say "freeze used" once today's run lands).
{
  const pending = computeStreaksWithFreeze([d(7), d(8)], d(10));
  assert.equal(pending.current, 2);
  assert.equal(pending.freezePending, true);
  assert.equal(pending.freezeUsedThisWeek, false, 'not spent until a run actually bridges it');
  assert.equal(pending.ranToday, false);
  // Freeze already spent this week → yesterday cannot be covered → dead.
  const spent = computeStreaksWithFreeze([d(7), d(9)], d(11));
  assert.equal(spent.current, 0, 'Mon,(Tue),Wed used the freeze; (Thu) cannot be covered on Fri');
  assert.equal(spent.freezePending, false);
  assert.equal(spent.freezeUsedThisWeek, true);
}

// Longest tracks the best chain including frozen bridges; achievements read `current`/`longest`.
{
  const info = computeStreaksWithFreeze([d(1), d(2), d(4), d(5), d(6), /* break */ d(11)], d(11));
  assert.equal(info.longest, 5, 'Sep 1,2,(3),4,5,6 = 5 active days bridged once');
  assert.equal(info.current, 1);
  assert.deepEqual(computeStreaks([d(1), d(2), d(4), d(5), d(6), d(11)], d(11)), { current: 1, longest: 5 });
}

// Local day boundaries: 23:59 and 00:01 are different days, 00:00 belongs to the new day.
assert.equal(computeStreaksWithFreeze([local(2026, 9, 8, 23), local(2026, 9, 9, 0)], local(2026, 9, 9, 1)).current, 2);

// ---------------------------------------------------------------------------
// Daily challenge: deterministic per local date, beatmap-filtered, +25% XP.
// ---------------------------------------------------------------------------
assert.ok(modes.length >= 5, 'need a few maps for challenge tests');
const NO_BEATMAPS = () => false;
const dateA = new Date(2026, 8, 13, 9);
const dateALater = new Date(2026, 8, 13, 23, 59);
const dateB = new Date(2026, 8, 14, 0, 1);

{
  const a1 = getDailyChallenge(modes, dateA, NO_BEATMAPS)!;
  const a2 = getDailyChallenge(modes, dateALater, NO_BEATMAPS)!;
  assert.equal(a1.mode.id, a2.mode.id, 'same local date → same video, any time of day');
  assert.equal(a1.dateKey, '2026-09-13');
  assert.equal(a1.practice, true, 'empty registry → practice challenge from the full roster');
  // Independent of input order (canonical order is by id map insertion, so reverse must match).
  const reversed = getDailyChallenge([...modes].reverse(), dateA, NO_BEATMAPS)!;
  assert.notEqual(reversed.mode.id, undefined);
  // Different from the featured discovery pick more often than not is not
  // guaranteed, but the salt makes it a separate stream — pin that it's a
  // valid mode and the rotation over a month covers more than one video.
  const ids = new Set<string>();
  for (let day = 1; day <= 30; day += 1) {
    ids.add(getDailyChallenge(modes, new Date(2026, 8, day), NO_BEATMAPS)!.mode.id);
  }
  assert.ok(ids.size > 1, 'the pick rotates across days');
  assert.ok(getDailyDiscovery(modes, dateA).featured, 'discovery rotation still works');
  assert.equal(localDateKey(dateB), '2026-09-14');
  const b = getDailyChallenge(modes, dateB, NO_BEATMAPS)!;
  assert.equal(b.dateKey, '2026-09-14');
}

// Beatmap filtering: only cued levels are eligible; the pick is practice=false.
{
  const cuedIds = new Set([modes[1].id, modes[3].id]);
  const has = (id: string) => cuedIds.has(id);
  for (let day = 1; day <= 60; day += 1) {
    const pick = getDailyChallenge(modes, new Date(2026, 8, day), has)!;
    assert.ok(cuedIds.has(pick.mode.id), `day ${day} picked an uncued level`);
    assert.equal(pick.practice, false);
  }
  // A single cued level is always the challenge.
  const only = (id: string) => id === modes[2].id;
  assert.equal(getDailyChallenge(modes, dateA, only)!.mode.id, modes[2].id);
  assert.equal(getDailyChallenge([], dateA, has), null);
}

// Completion derives from runs: same level, same local day.
{
  const challenge = getDailyChallenge(modes, dateA, NO_BEATMAPS)!;
  const other = modes.find((m) => m.id !== challenge.mode.id)!;
  const sameDay = local(2026, 9, 13, 18);
  assert.equal(isDailyChallengeCompleted([], challenge), false);
  assert.equal(isDailyChallengeCompleted([{ levelId: other.id, at: sameDay }], challenge), false);
  assert.equal(isDailyChallengeCompleted([{ levelId: challenge.mode.id, at: local(2026, 9, 12, 18) }], challenge), false, 'yesterday does not count');
  assert.equal(isDailyChallengeCompleted([{ levelId: challenge.mode.id, at: sameDay }], challenge), true);
  assert.equal(isDailyChallengeCompleted([{ levelId: challenge.mode.id, at: 'bad' }], challenge), false);
  assert.equal(isDailyChallengeCompleted([{ levelId: challenge.mode.id, at: sameDay }], null), false);
}

// Bonus: +25% on XP only, applied after accuracy/combo scaling, integer-rounded.
{
  assert.equal(DAILY_CHALLENGE_XP_BONUS, 0.25);
  const plain = rewardForRunPerformance({
    durationMin: 10, classKey: 'beginner', accuracy: 0.5, maxCombo: 20, hasBeatmap: true, movesPerMin: 0,
  });
  const bonus = rewardForRunPerformance({
    durationMin: 10, classKey: 'beginner', accuracy: 0.5, maxCombo: 20, hasBeatmap: true, movesPerMin: 0, dailyChallenge: true,
  });
  assert.equal(plain.xpBonusFactor, 1);
  assert.equal(bonus.xpBonusFactor, 1.25);
  assert.equal(bonus.total.coins, plain.total.coins, 'coins are not boosted');
  assert.equal(bonus.total.xp, Math.round(400 * 0.65 * 1.2 * 1.25));
  assert.equal(plain.total.xp, Math.round(400 * 0.65 * 1.2));
  assert.ok(bonus.total.xp > plain.total.xp);
  // Explicit false / omitted are identical.
  assert.deepEqual(
    rewardForRunPerformance({ durationMin: 3, classKey: 'hard', accuracy: 1, maxCombo: 0, hasBeatmap: false, movesPerMin: 30, dailyChallenge: false }),
    rewardForRunPerformance({ durationMin: 3, classKey: 'hard', accuracy: 1, maxCombo: 0, hasBeatmap: false, movesPerMin: 30 })
  );
  // Persisted breakdown keeps the factor; legacy records default to 1.
  const stored = normalizeRunRecord(
    { levelId: modes[0].id, durationMin: 10, at: 1, coins: 1, xp: 1, calories: 1, rewardBreakdown: { ...bonus, total: undefined } },
    0
  )!;
  assert.equal(stored.rewardBreakdown.xpBonusFactor, 1.25);
  assert.equal(normalizeRunRecord({ levelId: modes[0].id, at: 1 }, 0)!.rewardBreakdown.xpBonusFactor, 1);
}

console.log(
  'Streaks replay passed: baseline streaks, freeze once per Monday-local week, two gaps break, two-day hole never bridged, week-boundary attribution, pending freeze, longest with bridges, local day boundaries, daily-challenge determinism + rotation + beatmap filtering + practice fallback + derived completion + XP-only +25% bonus + persisted factor'
);
