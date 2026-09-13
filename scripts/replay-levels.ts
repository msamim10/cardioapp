// @ts-nocheck -- Node replay loader imports .ts sources via strip-types + path alias.
/**
 * Replay for FEATURE 5 (progression + unlocks): the 1–50 level curve, cap,
 * grandfather floor, static reward table, HUD-theme unlocks, and the campaign
 * gates (sequence + accuracy-with-beatmap + player level).
 */
import assert from 'node:assert/strict';
import { modes } from '../src/lib/gameData.ts';
import {
  DEFAULT_HUD_THEME_ID,
  HUD_THEMES,
  hudThemeOptions,
  resolveHudTheme,
} from '../src/lib/hudThemes.ts';
import {
  effectiveLevel,
  isHudThemeUnlocked,
  legacyLevelFor,
  LEVEL_REWARDS,
  levelBadges,
  levelFromXp,
  MAX_LEVEL,
  nextRewardLevel,
  progressWithinLevel,
  REWARD_LEVELS,
  rewardsBetween,
  unlockLevelForHudTheme,
  xpForLevel,
} from '../src/lib/levels.ts';
import {
  bestAccuracyByLevelForClass,
  CAMPAIGN_ACCURACY_GATE,
  CAMPAIGN_LEVEL_STEP,
  campaignLockReason,
  CASUAL_MAPS_ALWAYS_UNLOCKED,
  isGeneralMapUnlocked,
  isModeCampaignStepUnlocked,
  lockReasonCopy,
  nextLockedMapInClass,
  nextMapInClass,
  OPEN_CAMPAIGN_GATE,
  requiredLevelForNode,
  resolveClassMaps,
  type CampaignGate,
} from '../src/lib/progression.ts';
import { levelFromXp as reExportedLevelFromXp } from '../src/lib/progressAggregation.ts';

const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} !== ${expected}`);

// ---------------------------------------------------------------------------
// Curve: T(L) = round(300 × (L − 1)^1.5)
// ---------------------------------------------------------------------------
assert.equal(xpForLevel(1), 0);
assert.equal(xpForLevel(2), 300);
assert.equal(xpForLevel(3), 849);
assert.equal(xpForLevel(5), 2_400);
assert.equal(xpForLevel(10), 8_100);
assert.equal(xpForLevel(25), 35_273); // 300 × 24^1.5 = 35,272.5 → rounds up
assert.equal(xpForLevel(50), 102_900);
// Strictly increasing, integer thresholds.
for (let level = 2; level <= MAX_LEVEL; level += 1) {
  assert.ok(xpForLevel(level) > xpForLevel(level - 1), `T(${level}) must grow`);
  assert.ok(Number.isInteger(xpForLevel(level)));
}
// Out-of-range inputs clamp.
assert.equal(xpForLevel(0), 0);
assert.equal(xpForLevel(-5), 0);
assert.equal(xpForLevel(99), xpForLevel(MAX_LEVEL));
assert.equal(xpForLevel(Number.NaN), 0);

// levelFromXp inverts the table exactly at every boundary (and one below it).
for (let level = 1; level <= MAX_LEVEL; level += 1) {
  const threshold = xpForLevel(level);
  assert.equal(levelFromXp(threshold), level, `xp ${threshold} → level ${level}`);
  if (level > 1) {
    assert.equal(levelFromXp(threshold - 1), level - 1, `xp ${threshold - 1} → level ${level - 1}`);
  }
}
assert.equal(levelFromXp(0), 1);
assert.equal(levelFromXp(299), 1);
assert.equal(levelFromXp(300), 2);
assert.equal(levelFromXp(2_399), 4);
assert.equal(levelFromXp(2_400), 5);
assert.equal(levelFromXp(-1), 1);
assert.equal(levelFromXp(Number.NaN), 1);
assert.equal(levelFromXp(Number.POSITIVE_INFINITY), 1, 'non-finite XP is treated as 0');

// Cap at 50: XP keeps accumulating, the level does not.
assert.equal(levelFromXp(102_900), MAX_LEVEL);
assert.equal(levelFromXp(1_000_000), MAX_LEVEL);
assert.deepEqual(progressWithinLevel(5_000_000), {
  level: MAX_LEVEL,
  current: 0,
  needed: 0,
  fraction: 1,
  toNext: 0,
  isMax: true,
});

// progressAggregation re-exports the same implementation.
assert.equal(reExportedLevelFromXp, levelFromXp);

// Progress inside a level.
{
  const p = progressWithinLevel(0);
  assert.deepEqual(p, { level: 1, current: 0, needed: 300, fraction: 0, toNext: 300, isMax: false });
}
{
  const p = progressWithinLevel(450); // level 2 spans 300 → 849 (549 XP)
  assert.equal(p.level, 2);
  assert.equal(p.current, 150);
  assert.equal(p.needed, 549);
  assert.equal(p.toNext, 399);
  close(p.fraction, 150 / 549);
  assert.equal(p.isMax, false);
}
{
  const p = progressWithinLevel(8_099);
  assert.equal(p.level, 9);
  assert.equal(p.toNext, 1, 'one XP short of level 10');
}

// ---------------------------------------------------------------------------
// Grandfathering: max(oldFlatLevel, newCurveLevel) via a persisted floor
// ---------------------------------------------------------------------------
assert.equal(legacyLevelFor(0), 1);
assert.equal(legacyLevelFor(499), 1);
assert.equal(legacyLevelFor(500), 2);
assert.equal(legacyLevelFor(4_500), 10);
assert.equal(legacyLevelFor(30_000), MAX_LEVEL, 'legacy level also caps at 50');
// Below ~1,500 XP the new curve is more generous — floor never lowers anything.
assert.equal(levelFromXp(1_000), 3);
assert.equal(legacyLevelFor(1_000), 3);
assert.equal(effectiveLevel(1_000, legacyLevelFor(1_000)), 3);
// A 4,500 XP veteran was level 10 on the flat line but only 7 on the curve.
assert.equal(levelFromXp(4_500), 7);
assert.equal(effectiveLevel(4_500, 10), 10, 'floor holds the displayed level');
assert.equal(effectiveLevel(4_500), 7, 'no floor (fresh install) → curve level');
{
  // With the floor holding the level up, the bar sits at 0 and counts to floor+1.
  const held = progressWithinLevel(4_500, 10);
  assert.equal(held.level, 10);
  assert.equal(held.current, 0);
  assert.equal(held.fraction, 0);
  assert.equal(held.toNext, xpForLevel(11) - 4_500);
  // Once the curve catches up, the floor is inert.
  const caughtUp = progressWithinLevel(xpForLevel(12) + 10, 10);
  assert.equal(caughtUp.level, 12);
  assert.equal(caughtUp.current, 10);
}
// Garbage floors are clamped, never trusted.
assert.equal(effectiveLevel(0, 999), MAX_LEVEL);
assert.equal(effectiveLevel(0, -3), 1);
assert.equal(effectiveLevel(0, Number.NaN), 1);

// ---------------------------------------------------------------------------
// Reward table
// ---------------------------------------------------------------------------
assert.deepEqual(REWARD_LEVELS, [2, 3, 5, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40, 45, 50]);
const badgeLevels = REWARD_LEVELS.filter((l) => LEVEL_REWARDS[l].badge);
const themeLevels = REWARD_LEVELS.filter((l) => LEVEL_REWARDS[l].hudThemeId);
assert.deepEqual(badgeLevels, [2, 5, 10, 15, 20, 30, 40, 50]);
assert.deepEqual(themeLevels, [3, 8, 12, 18, 25, 35, 45]);
// Every referenced theme exists and unlocks exactly where the table says.
const themeIds = new Set(HUD_THEMES.map((t) => t.id));
for (const level of themeLevels) {
  const id = LEVEL_REWARDS[level].hudThemeId!;
  assert.ok(themeIds.has(id), `theme ${id} at level ${level} must exist in hudThemes.ts`);
  assert.equal(unlockLevelForHudTheme(id), level);
}
assert.equal(HUD_THEMES.length, 8, '1 default + 7 unlockable palettes');
assert.equal(unlockLevelForHudTheme(DEFAULT_HUD_THEME_ID), 1, 'default theme is always unlocked');
assert.ok(new Set(badgeLevels.map((l) => LEVEL_REWARDS[l].badge!.id)).size === badgeLevels.length, 'badge ids unique');

// Badges derive purely from level.
assert.equal(levelBadges(1).filter((b) => b.unlocked).length, 0);
assert.equal(levelBadges(2).filter((b) => b.unlocked).length, 1);
assert.equal(levelBadges(10).filter((b) => b.unlocked).length, 3);
assert.equal(levelBadges(MAX_LEVEL).filter((b) => b.unlocked).length, 8);
assert.equal(levelBadges(500).filter((b) => b.unlocked).length, 8);

// Level-up celebration: rewards strictly after `from` up to `to`.
assert.deepEqual(rewardsBetween(1, 1), []);
assert.deepEqual(rewardsBetween(5, 2), []);
assert.deepEqual(rewardsBetween(1, 2).map((r) => r.level), [2]);
assert.deepEqual(rewardsBetween(2, 5).map((r) => r.level), [3, 5]);
assert.deepEqual(rewardsBetween(9, 12).map((r) => r.level), [10, 12]);
assert.equal(nextRewardLevel(1), 2);
assert.equal(nextRewardLevel(2), 3);
assert.equal(nextRewardLevel(45), 50);
assert.equal(nextRewardLevel(50), null);

// HUD theme resolution: a persisted pick only applies once unlocked.
assert.equal(resolveHudTheme(null, 1).id, DEFAULT_HUD_THEME_ID);
assert.equal(resolveHudTheme('glacier', 2).id, DEFAULT_HUD_THEME_ID, 'locked pick falls back');
assert.equal(resolveHudTheme('glacier', 3).id, 'glacier');
assert.equal(resolveHudTheme('not-a-theme', 50).id, DEFAULT_HUD_THEME_ID);
assert.equal(isHudThemeUnlocked('carbon', 44), false);
assert.equal(isHudThemeUnlocked('carbon', 45), true);
{
  const options = hudThemeOptions(12);
  assert.equal(options.length, HUD_THEMES.length);
  assert.deepEqual(
    options.filter((o) => o.unlocked).map((o) => o.theme.id),
    [DEFAULT_HUD_THEME_ID, 'glacier', 'ember', 'ultraviolet']
  );
  assert.equal(options.find((o) => o.theme.id === 'rose')!.unlockLevel, 18);
}

// ---------------------------------------------------------------------------
// Campaign gates
// ---------------------------------------------------------------------------
assert.equal(CASUAL_MAPS_ALWAYS_UNLOCKED, true);
assert.equal(isGeneralMapUnlocked(), true, 'casual/discovery entry is policy-unlocked');

// Level requirement per node: 1 + floor(k × step).
assert.deepEqual(CAMPAIGN_LEVEL_STEP, { beginner: 1, intermediate: 2, hard: 3 });
assert.deepEqual([0, 1, 2, 5, 12].map((k) => requiredLevelForNode(k, 'beginner')), [1, 2, 3, 6, 13]);
assert.deepEqual([0, 1, 2, 5, 12].map((k) => requiredLevelForNode(k, 'intermediate')), [1, 3, 5, 11, 25]);
assert.deepEqual([0, 1, 2, 5, 12].map((k) => requiredLevelForNode(k, 'hard')), [1, 4, 7, 16, 37]);
assert.equal(requiredLevelForNode(-1, 'hard'), 1);
assert.equal(requiredLevelForNode(100, 'hard'), MAX_LEVEL, 'requirement caps at 50');

assert.ok(modes.length >= 4);
const roster: string[] = modes.slice(0, 4).map((mode: { id: string }) => mode.id);
const [mapA, mapB, mapC] = roster;

const gate = (over: Partial<CampaignGate>): CampaignGate => ({
  ...OPEN_CAMPAIGN_GATE,
  classKey: 'beginner',
  ...over,
});

// (a) sequence: nothing but the previous node matters with an open gate.
{
  const none = new Set<string>();
  assert.equal(campaignLockReason(roster, 0, none), null);
  assert.deepEqual(campaignLockReason(roster, 1, none), { kind: 'previous', previousLevelId: mapA, previousIndex: 0 });
  assert.equal(campaignLockReason(roster, 1, new Set([mapA])), null);
  assert.equal(campaignLockReason(roster, 0, new Set([mapA])), null, 'completed nodes stay replayable');
  assert.equal(isModeCampaignStepUnlocked(roster, 9, none), false, 'out of range');
}

// (b) accuracy gate only bites when the previous level HAS a beatmap.
{
  const completed = new Set([mapA]);
  const noBeatmap = gate({ hasBeatmap: () => false, bestAccuracyInClass: new Map([[mapA, 0.1]]) });
  assert.equal(campaignLockReason(roster, 1, completed, noBeatmap), null, 'no beatmap → auto-pass');

  const cued = (best: number) =>
    gate({ hasBeatmap: (id) => id === mapA, bestAccuracyInClass: new Map([[mapA, best]]) });
  assert.deepEqual(campaignLockReason(roster, 1, completed, cued(0.69)), {
    kind: 'accuracy',
    previousLevelId: mapA,
    previousIndex: 0,
    required: CAMPAIGN_ACCURACY_GATE,
    current: 0.69,
  });
  assert.equal(campaignLockReason(roster, 1, completed, cued(0.7)), null, 'boundary 0.70 passes');
  assert.equal(campaignLockReason(roster, 1, completed, cued(0.95)), null);
  // Missing accuracy record for a cued level counts as 0.
  const cuedNoRecord = gate({ hasBeatmap: (id) => id === mapA });
  assert.equal(campaignLockReason(roster, 1, completed, cuedNoRecord)!.kind, 'accuracy');
  // The gate examines the PREVIOUS node's beatmap, not the target's.
  const targetOnly = gate({ hasBeatmap: (id) => id === mapB, bestAccuracyInClass: new Map([[mapA, 0]]) });
  assert.equal(campaignLockReason(roster, 1, completed, targetOnly), null);
  // Already-completed target: replayable even with a failing accuracy gate.
  assert.equal(campaignLockReason(roster, 1, new Set([mapA, mapB]), cued(0)), null);
}

// (c) player level per node and class step.
{
  const completed = new Set([mapA, mapB]);
  assert.deepEqual(campaignLockReason(roster, 2, completed, gate({ playerLevel: 2 })), {
    kind: 'level',
    required: 3,
    current: 2,
  });
  assert.equal(campaignLockReason(roster, 2, completed, gate({ playerLevel: 3 })), null);
  assert.deepEqual(campaignLockReason(roster, 2, completed, gate({ classKey: 'hard', playerLevel: 6 })), {
    kind: 'level',
    required: 7,
    current: 6,
  });
  assert.equal(campaignLockReason(roster, 2, completed, gate({ classKey: 'hard', playerLevel: 7 })), null);
  // Node 0 never needs a level.
  assert.equal(campaignLockReason(roster, 0, new Set(), gate({ classKey: 'hard', playerLevel: 1 })), null);
}

// Reason ordering: previous → accuracy → level (nearest blocker first).
{
  const both = gate({
    playerLevel: 1,
    hasBeatmap: () => true,
    bestAccuracyInClass: new Map([[mapA, 0.2]]),
  });
  assert.equal(campaignLockReason(roster, 1, new Set(), both)!.kind, 'previous');
  assert.equal(campaignLockReason(roster, 1, new Set([mapA]), both)!.kind, 'accuracy');
  const levelOnly = gate({ playerLevel: 1, hasBeatmap: () => true, bestAccuracyInClass: new Map([[mapA, 0.9]]) });
  assert.equal(campaignLockReason(roster, 1, new Set([mapA]), levelOnly)!.kind, 'level');
}

// resolveClassMaps surfaces the lock reason + required level; nextMapInClass
// yields null while gated and nextLockedMapInClass explains why.
{
  const completed = new Set([mapA]);
  const maps = resolveClassMaps(roster, completed, gate({ playerLevel: 1 }));
  assert.equal(maps[0].state, 'completed');
  assert.equal(maps[1].state, 'locked');
  assert.deepEqual(maps[1].lockReason, { kind: 'level', required: 2, current: 1 });
  assert.equal(maps[1].requiredLevel, 2);
  assert.equal(maps[0].lockReason, null, 'unlocked/completed nodes carry no reason');
  assert.equal(nextMapInClass(roster, completed, gate({ playerLevel: 1 })), null);
  const blocked = nextLockedMapInClass(maps)!;
  assert.equal(blocked.levelId, mapB);
  assert.equal(blocked.reason.kind, 'level');
  // Plain "previous incomplete" is not a gate → no lock explanation.
  assert.equal(nextLockedMapInClass(resolveClassMaps(roster, new Set(), gate({ playerLevel: 1 }))), null);
  // With enough level the same roster opens up.
  assert.equal(nextMapInClass(roster, completed, gate({ playerLevel: 2 })), mapB);
  assert.equal(resolveClassMaps(roster, completed, gate({ playerLevel: 2 }))[2].requiredLevel, 3);
  void mapC;
}

// Copy shows the requirement AND the current value.
{
  const nameOf = (id: string) => `«${id}»`;
  assert.equal(lockReasonCopy({ kind: 'level', required: 6, current: 4 }, nameOf), 'Reach level 6 · now 4');
  assert.equal(
    lockReasonCopy({ kind: 'accuracy', previousLevelId: mapA, previousIndex: 0, required: 0.7, current: 0.523 }, nameOf),
    `Score 70% accuracy on «${mapA}» · best 52%`
  );
  assert.equal(lockReasonCopy({ kind: 'previous', previousLevelId: mapA, previousIndex: 2 }, nameOf), 'Complete Level 3');
}

// Best accuracy per level respects class attribution and clamps garbage.
{
  const best = bestAccuracyByLevelForClass(
    [
      { levelId: mapA, classKey: 'beginner', accuracy: 0.4 },
      { levelId: mapA, classKey: 'beginner', accuracy: 0.8 },
      { levelId: mapA, classKey: 'hard', accuracy: 1 }, // other class
      { levelId: mapA, accuracy: 1 }, // casual — no classKey
      { levelId: mapB, classKey: 'beginner', accuracy: 7 },
      { levelId: mapC, classKey: 'beginner' }, // legacy, no accuracy
    ],
    'beginner'
  );
  assert.equal(best.get(mapA), 0.8);
  assert.equal(best.get(mapB), 1);
  assert.equal(best.get(mapC), 0);
}

console.log(
  'Levels replay passed: curve table, boundaries, cap at 50, progress within level, grandfather floor, reward table, badges, HUD theme unlocks, campaign gates (sequence / accuracy with+without beatmap / level per class), lock copy, best-accuracy attribution'
);
