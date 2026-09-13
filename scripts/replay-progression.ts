// @ts-nocheck -- Node replay loader imports .ts sources via strip-types + path alias.
import assert from 'node:assert/strict';
import { modes } from '../src/lib/gameData.ts';
import {
  buildClassData,
  campaignClassKeyForCompletion,
  campaignCoverBlurIntensity,
  campaignTitleBlurFromIndex,
  completedLevelIdsForClass,
  expandClassRoster,
  isModeCampaignStepUnlocked,
  nextMapInClass,
  parseClassKeyParam,
  parseOptionalClassKeyParam,
  resolveClassMaps,
  REWARD_ACCURACY_FLOOR,
  REWARD_COMBO_CAP,
  REWARD_REFERENCE_MOVES_PER_MIN,
  rewardForRun,
  rewardForRunPerformance,
  shouldBlurCampaignTitle,
} from '../src/lib/progression.ts';
import { normalizeRunRecord } from '../src/lib/progressSync.ts';

assert.ok(modes.length >= 4, 'expected at least 4 canonical maps for roster tests');
const roster: string[] = modes.slice(0, 4).map((mode: { id: string }) => mode.id);
const [mapA, mapB, mapC, mapD] = roster;

/** Simulate what recordRun persists for campaign attribution. */
function recordForProgression(input: {
  levelId: string;
  classKey?: string;
  finishedToEnd: boolean;
}): { levelId: string; classKey?: string } {
  const classKey = campaignClassKeyForCompletion(input.classKey, input.finishedToEnd);
  return {
    levelId: input.levelId,
    ...(classKey ? { classKey } : {}),
  };
}

// Fresh campaign: only the first step is unlocked / next.
{
  const completed = new Set<string>();
  const maps = resolveClassMaps(roster, completed);
  assert.equal(maps[0].state, 'next');
  assert.equal(maps[1].state, 'locked');
  assert.equal(maps[2].state, 'locked');
  assert.equal(nextMapInClass(roster, completed), mapA);
  assert.equal(isModeCampaignStepUnlocked(roster, 0, completed), true);
  assert.equal(isModeCampaignStepUnlocked(roster, 1, completed), false);
}

// Completing step 0 unlocks step 1 as next — not later steps.
{
  const completed = new Set<string>([mapA]);
  const maps = resolveClassMaps(roster, completed);
  assert.equal(maps[0].state, 'completed');
  assert.equal(maps[1].state, 'next');
  assert.equal(maps[2].state, 'locked');
  assert.equal(nextMapInClass(roster, completed), mapB);
}

// Completing mid-path unlocks only the immediate next node.
{
  const completed = new Set<string>([mapA, mapB]);
  const maps = resolveClassMaps(roster, completed);
  assert.equal(maps[2].state, 'next');
  assert.equal(maps[3].state, 'locked');
  assert.equal(nextMapInClass(roster, completed), mapC);
}

// Full clear: no next map (summary should show finish state, not a replay CTA).
{
  const completed = new Set<string>(roster);
  const maps = resolveClassMaps(roster, completed);
  assert.ok(maps.every((entry: { state: string }) => entry.state === 'completed'));
  assert.equal(nextMapInClass(roster, completed), null);
}

// Class-scoped completions: wrong classKey must not unlock another campaign.
{
  const runs = [
    { levelId: mapA, classKey: 'beginner' },
    { levelId: mapB, classKey: 'hard' },
  ];
  const beginnerDone = completedLevelIdsForClass(runs, 'beginner');
  const hardDone = completedLevelIdsForClass(runs, 'hard');
  assert.deepEqual([...beginnerDone], [mapA]);
  assert.deepEqual([...hardDone], [mapB]);
  assert.equal(nextMapInClass(roster, beginnerDone), mapB);
  assert.equal(nextMapInClass(roster, hardDone), mapA);
}

// Malformed / missing classKey on runs do not unlock any campaign.
{
  const runs = [
    { levelId: mapA },
    { levelId: mapB, classKey: 'nope' },
    { levelId: mapC, classKey: 'beginner' },
  ];
  assert.deepEqual([...completedLevelIdsForClass(runs, 'beginner')], [mapC]);
}

// Casual discovery completions (no classKey) never advance a campaign path,
// even when the map id happens to sit on that class roster.
{
  const casualRuns = [
    { levelId: mapA },
    { levelId: mapA },
    { levelId: mapB },
  ];
  const beginnerDone = completedLevelIdsForClass(casualRuns, 'beginner');
  assert.deepEqual([...beginnerDone], []);
  assert.equal(nextMapInClass(roster, beginnerDone), mapA);

  const withOneCampaignClear = [
    ...casualRuns,
    { levelId: mapA, classKey: 'beginner' },
  ];
  const afterCampaign = completedLevelIdsForClass(withOneCampaignClear, 'beginner');
  assert.deepEqual([...afterCampaign], [mapA]);
  assert.equal(nextMapInClass(roster, afterCampaign), mapB);
}

// Finished-to-end gate: casual / early-exit / full finish attribution.
{
  assert.equal(campaignClassKeyForCompletion('beginner', false), undefined);
  assert.equal(campaignClassKeyForCompletion(undefined, true), undefined);
  assert.equal(campaignClassKeyForCompletion('beginner', true), 'beginner');

  // Casual play finishes the video but never carries a campaign classKey.
  const casualFinish = recordForProgression({
    levelId: mapA,
    finishedToEnd: true,
  });
  assert.equal(casualFinish.classKey, undefined);
  const afterCasual = completedLevelIdsForClass([casualFinish], 'beginner');
  assert.deepEqual([...afterCasual], []);
  assert.equal(nextMapInClass(roster, afterCasual), mapA);
  assert.equal(resolveClassMaps(roster, afterCasual)[0].state, 'next');

  // Mode early exit: classKey was present on the active run, but unfinished.
  const earlyExit = recordForProgression({
    levelId: mapA,
    classKey: 'beginner',
    finishedToEnd: false,
  });
  assert.equal(earlyExit.classKey, undefined);
  const afterEarlyExit = completedLevelIdsForClass([earlyExit], 'beginner');
  assert.deepEqual([...afterEarlyExit], []);
  assert.equal(nextMapInClass(roster, afterEarlyExit), mapA);
  assert.equal(resolveClassMaps(roster, afterEarlyExit)[0].state, 'next');
  assert.equal(resolveClassMaps(roster, afterEarlyExit)[1].state, 'locked');

  // Mode full finish unlocks the next map on that class path only.
  const modeFinish = recordForProgression({
    levelId: mapA,
    classKey: 'beginner',
    finishedToEnd: true,
  });
  assert.equal(modeFinish.classKey, 'beginner');
  const afterModeFinish = completedLevelIdsForClass([modeFinish], 'beginner');
  assert.deepEqual([...afterModeFinish], [mapA]);
  assert.equal(nextMapInClass(roster, afterModeFinish), mapB);
  const maps = resolveClassMaps(roster, afterModeFinish);
  assert.equal(maps[0].state, 'completed');
  assert.equal(maps[1].state, 'next');
  assert.equal(maps[2].state, 'locked');

  // Hard campaign stays locked after a beginner finish of the same map.
  assert.deepEqual([...completedLevelIdsForClass([modeFinish], 'hard')], []);
}

// Expo may pass classKey as string[].
assert.equal(parseClassKeyParam(['intermediate'], 'beginner'), 'intermediate');
assert.equal(parseClassKeyParam('hard', 'beginner'), 'hard');
assert.equal(parseClassKeyParam('nope', 'beginner'), 'beginner');
assert.equal(parseClassKeyParam(undefined, 'hard'), 'hard');

// Optional campaign parser: missing/malformed means casual (null), never invent.
assert.equal(parseOptionalClassKeyParam('beginner'), 'beginner');
assert.equal(parseOptionalClassKeyParam(['hard']), 'hard');
assert.equal(parseOptionalClassKeyParam(undefined), null);
assert.equal(parseOptionalClassKeyParam('nope'), null);
assert.equal(parseOptionalClassKeyParam(['nope']), null);

// buildClassData wires nextLevelId / allComplete for summary CTAs.
{
  const data = buildClassData(
    'beginner',
    roster,
    [],
    [
      { levelId: mapA, calories: 10, classKey: 'beginner' },
      { levelId: mapB, calories: 12, classKey: 'beginner' },
    ],
    'Tester'
  );
  assert.equal(data.nextLevelId, mapC);
  assert.equal(data.allComplete, false);
  assert.equal(data.completedCount, 2);

  const finished = buildClassData(
    'beginner',
    roster,
    [],
    roster.map((levelId) => ({ levelId, calories: 8, classKey: 'beginner' as const })),
    'Tester'
  );
  assert.equal(finished.nextLevelId, null);
  assert.equal(finished.allComplete, true);
  assert.equal(mapD, roster[3]);
}

// Full-roster expansion preserves existing prefix and appends every remaining map.
{
  const short = modes.slice(0, 4).map((mode: { id: string }) => mode.id);
  const expanded = expandClassRoster(short);
  assert.equal(expanded.length, modes.length);
  assert.deepEqual(expanded.slice(0, 4), short);
  assert.equal(new Set(expanded).size, modes.length);
  // Idempotent on an already-full roster.
  assert.deepEqual(expandClassRoster(expanded), expanded);
}

// Title blur: first 5 clear on long paths; only the last locked node blurs on a 5-map path.
{
  assert.equal(campaignTitleBlurFromIndex(13), 5);
  assert.equal(campaignTitleBlurFromIndex(5), 4);
  assert.equal(shouldBlurCampaignTitle(4, 'locked', 13), false);
  assert.equal(shouldBlurCampaignTitle(5, 'locked', 13), true);
  assert.equal(shouldBlurCampaignTitle(5, 'next', 13), false);
  assert.equal(shouldBlurCampaignTitle(5, 'completed', 13), false);
  assert.equal(shouldBlurCampaignTitle(4, 'locked', 5), true);
  assert.equal(shouldBlurCampaignTitle(3, 'locked', 5), false);
}

// Cover blur: crisp until the blur window, then graduates deeper down the path.
{
  // Clear / reachable nodes are never blurred, regardless of depth.
  assert.equal(campaignCoverBlurIntensity(4, 'locked', 13), 0);
  assert.equal(campaignCoverBlurIntensity(8, 'next', 13), 0);
  assert.equal(campaignCoverBlurIntensity(8, 'completed', 13), 0);
  assert.equal(campaignCoverBlurIntensity(8, 'unlocked', 13), 0);

  // First blurred node is lightly frosted; each step deeper adds more blur.
  const first = campaignCoverBlurIntensity(5, 'locked', 13);
  const second = campaignCoverBlurIntensity(6, 'locked', 13);
  const third = campaignCoverBlurIntensity(7, 'locked', 13);
  assert.equal(first, 28);
  assert.ok(second > first, 'deeper locked nodes must be blurrier');
  assert.ok(third > second, 'blur must increase monotonically with depth');

  // Blur saturates at the ceiling for very deep nodes and never exceeds it.
  assert.equal(campaignCoverBlurIntensity(60, 'locked', 100), 96);
  assert.ok(campaignCoverBlurIntensity(99, 'locked', 100) <= 96);
}

// Performance-scaled rewards: base × accuracyFactor × comboFactor, rounded.
{
  const close = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} vs ${b}`);
  // Base is unchanged: 10 min beginner = 200 coins / 400 XP; hard ×1.5.
  assert.deepEqual(rewardForRun(10, 'beginner'), { coins: 200, xp: 400 });
  assert.deepEqual(rewardForRun(10, 'hard'), { coins: 300, xp: 600 });

  // Beatmap, perfect accuracy, no combo → exactly base.
  const perfect = rewardForRunPerformance({
    durationMin: 10, classKey: 'beginner', accuracy: 1, maxCombo: 0, hasBeatmap: true, movesPerMin: 0,
  });
  assert.deepEqual(perfect.base, { coins: 200, xp: 400 });
  close(perfect.accuracyFactor, 1);
  close(perfect.comboFactor, 1);
  assert.deepEqual(perfect.total, { coins: 200, xp: 400 });

  // Standing still on a cued map → the 30% floor (movesPerMin is ignored with a beatmap).
  const still = rewardForRunPerformance({
    durationMin: 10, classKey: 'beginner', accuracy: 0, maxCombo: 0, hasBeatmap: true, movesPerMin: 60,
  });
  close(still.accuracyFactor, REWARD_ACCURACY_FLOOR);
  assert.deepEqual(still.total, { coins: 60, xp: 120 });

  // Half accuracy → 0.65; combo 10 → ×1.10; total rounded.
  const mid = rewardForRunPerformance({
    durationMin: 10, classKey: 'beginner', accuracy: 0.5, maxCombo: 10, hasBeatmap: true, movesPerMin: 0,
  });
  close(mid.accuracyFactor, 0.65);
  close(mid.comboFactor, 1.1);
  assert.deepEqual(mid.total, { coins: Math.round(200 * 0.65 * 1.1), xp: Math.round(400 * 0.65 * 1.1) });
  assert.deepEqual(mid.total, { coins: 143, xp: 286 });

  // Combo bonus caps at +25% (combo 25 and 100 are identical).
  const combo25 = rewardForRunPerformance({
    durationMin: 10, classKey: 'beginner', accuracy: 1, maxCombo: 25, hasBeatmap: true, movesPerMin: 0,
  });
  const combo100 = rewardForRunPerformance({
    durationMin: 10, classKey: 'beginner', accuracy: 1, maxCombo: 100, hasBeatmap: true, movesPerMin: 0,
  });
  close(combo25.comboFactor, 1 + REWARD_COMBO_CAP);
  assert.deepEqual(combo25.total, combo100.total);
  assert.deepEqual(combo25.total, { coins: 250, xp: 500 });

  // Accuracy is clamped to [0, 1]; garbage becomes the floor.
  close(rewardForRunPerformance({ durationMin: 1, classKey: 'beginner', accuracy: 1.7, maxCombo: 0, hasBeatmap: true, movesPerMin: 0 }).accuracyFactor, 1);
  close(rewardForRunPerformance({ durationMin: 1, classKey: 'beginner', accuracy: Number.NaN, maxCombo: -3, hasBeatmap: true, movesPerMin: 0 }).accuracyFactor, REWARD_ACCURACY_FLOOR);
  close(rewardForRunPerformance({ durationMin: 1, classKey: 'beginner', accuracy: 1, maxCombo: -3, hasBeatmap: true, movesPerMin: 0 }).comboFactor, 1);

  // Free scoring: activity factor from moves per minute against the 30/min reference.
  assert.equal(REWARD_REFERENCE_MOVES_PER_MIN, 30);
  const idle = rewardForRunPerformance({
    durationMin: 5, classKey: 'hard', accuracy: 1, maxCombo: 0, hasBeatmap: false, movesPerMin: 0,
  });
  close(idle.accuracyFactor, REWARD_ACCURACY_FLOOR, 'accuracy is ignored without a beatmap');
  assert.deepEqual(idle.base, { coins: 150, xp: 300 });
  assert.deepEqual(idle.total, { coins: 45, xp: 90 });
  const halfActive = rewardForRunPerformance({
    durationMin: 5, classKey: 'hard', accuracy: 0, maxCombo: 4, hasBeatmap: false, movesPerMin: 15,
  });
  close(halfActive.accuracyFactor, 0.65);
  close(halfActive.comboFactor, 1.04);
  assert.deepEqual(halfActive.total, { coins: Math.round(150 * 0.65 * 1.04), xp: Math.round(300 * 0.65 * 1.04) });
  const veryActive = rewardForRunPerformance({
    durationMin: 5, classKey: 'hard', accuracy: 0, maxCombo: 0, hasBeatmap: false, movesPerMin: 90,
  });
  close(veryActive.accuracyFactor, 1, 'activity above the reference is not rewarded further');
  assert.deepEqual(veryActive.total, idle.base);

  // Rounding: factors produce integers, never fractional coins.
  const odd = rewardForRunPerformance({
    durationMin: 7.37, classKey: 'intermediate', accuracy: 0.71, maxCombo: 13, hasBeatmap: true, movesPerMin: 0,
  });
  assert.ok(Number.isInteger(odd.total.coins) && Number.isInteger(odd.total.xp));
  assert.ok(odd.total.coins <= odd.base.coins * 1.25 && odd.total.coins >= odd.base.coins * 0.3);

  // Legacy run records normalize to factors of 1 with base = stored totals.
  const legacy = normalizeRunRecord({ levelId: mapA, durationMin: 10, at: 1, coins: 200, xp: 400, calories: 90 }, 0)!;
  assert.deepEqual(legacy.rewardBreakdown, { base: { coins: 200, xp: 400 }, accuracyFactor: 1, comboFactor: 1, xpBonusFactor: 1 });
  assert.equal(legacy.perfectCount, 0);
  assert.equal(legacy.maxCombo, 0);
  assert.equal(legacy.accuracy, 0);
  const modern = normalizeRunRecord(
    {
      levelId: mapA, durationMin: 10, at: 1, coins: 143, xp: 286, calories: 90, runId: 'r1',
      perfectCount: 7, goodCount: 2, missCount: 3, maxCombo: 10, accuracy: 0.5,
      rewardBreakdown: { base: { coins: 200, xp: 400 }, accuracyFactor: 0.65, comboFactor: 1.1 },
    },
    0,
  )!;
  // Pre-daily-challenge breakdowns (no xpBonusFactor) default to a neutral 1.
  assert.deepEqual(modern.rewardBreakdown, { base: { coins: 200, xp: 400 }, accuracyFactor: 0.65, comboFactor: 1.1, xpBonusFactor: 1 });
  assert.equal(modern.perfectCount, 7);
  assert.equal(modern.accuracy, 0.5);
  assert.equal(normalizeRunRecord({ levelId: mapA, accuracy: 3 }, 0)!.accuracy, 1, 'accuracy clamps to 1');
}

console.log(
  'Progression replay passed: sequential unlocks, class isolation, casual discovery ignored, early-exit no unlock, finished-to-end unlocks next, finished campaign null next, classKey parsing, full roster expansion, title blur window, performance-scaled rewards (beatmap + activity branches, floors, cap, rounding, legacy records)'
);
