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
  shouldBlurCampaignTitle,
} from '../src/lib/progression.ts';

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

console.log(
  'Progression replay passed: sequential unlocks, class isolation, casual discovery ignored, early-exit no unlock, finished-to-end unlocks next, finished campaign null next, classKey parsing, full roster expansion, title blur window'
);
