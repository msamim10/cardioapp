# Progression, unlocks, streaks & daily challenge

Technical reference for the local-only progression layer. Everything here is
derived from persisted `RunRecord`s (`src/lib/progressSync.ts`) plus two small
persisted fields (`hudTheme`, `legacyLevelFloor`). No backend, no push.

Replays: `npm run test:levels`, `npm run test:streaks` (plus `test:progression`,
`test:progress`, `test:notifications`, which cover the touched seams).

## XP

Unchanged. A run's XP is `rewardForRunPerformance(...).total.xp`
(`src/lib/progression.ts`):

```
base            = 40 XP/min × class multiplier (1 / 1.25 / 1.5)
accuracyFactor  = 0.3 + 0.7 × accuracy                        (level has a beatmap)
                = 0.3 + 0.7 × clamp(movesPerMin / 30, 0, 1)   (no beatmap — today's state)
comboFactor     = 1 + min(0.25, maxCombo / 100)
xpBonusFactor   = 1.25 when the run completes today's daily challenge, else 1
xp              = round(base × accuracyFactor × comboFactor × xpBonusFactor)
coins           = round(base.coins × accuracyFactor × comboFactor)      (never boosted)
```

Total XP is the sum of `RunRecord.xp`. The breakdown persisted on each run
carries `xpBonusFactor` (legacy records normalise to `1`).

## Level curve (`src/lib/levels.ts`)

Cumulative threshold to *be* level `L`, capped at 50:

```
T(L) = round(300 × (L − 1)^1.5)
```

| L | T(L) | | L | T(L) |
|---|-----:|-|---|-----:|
| 1 | 0 | | 15 | 15,715 |
| 2 | 300 | | 20 | 24,846 |
| 3 | 849 | | 25 | 35,273 |
| 5 | 2,400 | | 30 | 46,851 |
| 8 | 5,556 | | 40 | 73,066 |
| 10 | 8,100 | | 50 | 102,900 |

API (re-exported from `progressAggregation.ts` for existing consumers):
`xpForLevel(L)`, `levelFromXp(xp)`, `effectiveLevel(xp, floor)`,
`progressWithinLevel(xp, floor) → { level, current, needed, fraction, toNext, isMax }`.
At level 50 the bar pins at `fraction = 1`, `toNext = 0`; XP keeps accumulating.

### Grandfathering (`legacyLevelFloor`)

The old model was flat 500 XP/level, which is *more* generous than the curve
past ~1,500 XP (e.g. 4,500 XP: old L10, new L7). On the first launch after the
upgrade `ProgressContext` computes `legacyLevelFor(totalXp)` once and persists
it as `legacyLevelFloor` (local store + `CloudProgressState`, backward
compatible — missing → computed, cloud/local merge takes the max). The
displayed level is `max(curveLevel, legacyLevelFloor)`. While the floor is
holding the level up, the bar sits at 0 and "X XP to level N+1" counts to the
floor's next threshold. Rewards derive from the effective level, so nobody
loses a badge or theme. Fresh installs get floor `1` (inert).

## Level rewards (`LEVEL_REWARDS` in `levels.ts`)

Derived purely from the effective level — never persisted. Only the *chosen*
HUD theme id is persisted (`hudTheme`, null = default).

| Level | Badge | HUD theme |
|------:|-------|-----------|
| 2 | First Stride | |
| 3 | | Glacier |
| 5 | Cadence | |
| 8 | | Ember |
| 10 | Trailblazer | |
| 12 | | Ultraviolet |
| 15 | Summit | |
| 18 | | Rose |
| 20 | Velocity | |
| 25 | | Gold |
| 30 | Endurance | |
| 35 | | Mint |
| 40 | Vanguard | |
| 45 | | Carbon |
| 50 | Legend | |

- Badges: Profile → "Level rewards" (locked/unlocked by level, `levelBadges`).
  Run-based achievements in `achievements.ts` are untouched.
- HUD themes (`src/lib/hudThemes.ts`, 8 palettes incl. the default **Volt** =
  current look): Profile → "HUD theme" picker. `resolveHudTheme(pick, level)`
  falls back to Volt if the persisted pick is locked on this device (e.g. after
  a reset). Applied to `PoseOverlay` (skeleton, lane, cue, counters, grade
  flash) via `workout.tsx` / `preflight.tsx` → `WorkoutCameraPreview`.
- Level-up: `summary.tsx` compares `effectiveLevel` before/after `recordRun`;
  on increase it shows the animated level badge and `rewardsBetween(from, to)`.

## Campaign gates (`campaignLockReason` in `progression.ts`)

Campaign paths only. Casual/discovery entry is policy-unlocked for Pro
(`CASUAL_MAPS_ALWAYS_UNLOCKED = true`, formerly
`UNLOCK_ALL_GENERAL_MAPS_FOR_TESTING`). Completed nodes are always replayable.
Otherwise node `k` on a class roster opens when **all** hold, reported in this
order so the card shows the nearest blocker:

1. **Sequence** — `k === 0` or node `k−1` is completed in this class.
2. **Skill** — node `k−1`'s best campaign `accuracy ≥ 0.70` **if** that level
   has a published beatmap. No beatmap → auto-pass (every level today, so this
   rule is inert until beatmaps ship). Copy: "Score 70% accuracy on <prev> · best 52%".
3. **Level** — effective player level ≥ `1 + floor(k × classStep)`,
   `classStep` = 1 beginner / 2 intermediate / 3 hard. Copy: "Reach level 6 · now 4".

| node k | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 |
|--------|---|---|---|---|---|---|---|---|----|----|
| beginner | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 9 | 11 | 13 |
| intermediate | 1 | 3 | 5 | 7 | 9 | 11 | 13 | 17 | 21 | 25 |
| hard | 1 | 4 | 7 | 10 | 13 | 16 | 19 | 25 | 31 | 37 |

Best accuracy per level uses only runs carrying that class's `classKey` (same
attribution as completions). Surfaces: `ModeCampaignPath` node meta, level
detail banner + disabled CTA, summary "next level" slot (`nextLockedMapInClass`).

## Streaks with one freeze per week (`computeStreaksWithFreeze`)

Consecutive local calendar days with ≥1 run, computed **purely from run
timestamps** (no counter). Walking unique day keys newest → oldest:

- gap of 1 day → chain continues;
- gap of 2 days (one missed day) → bridged iff the freeze of the
  **Monday-local week containing the missed day** has not already been used on
  this walk; the missed day does **not** add to the count;
- anything else, or a second single gap in the same week → chain breaks.

The current streak is alive if the latest active day is today or yesterday, or
two days ago with yesterday still freezable (`freezePending`). `StreakInfo`
also exposes `ranToday`, `freezeUsedThisWeek` / `freezeAvailable` (home chip:
"Freeze available" / "Freeze used") and `lastLinkFrozen` (summary: "Streak
freeze used" when the just-completed run bridged a gap). `computeStreaks` wraps
this, so `achievements.ts` streak milestones read the freeze-aware value.

### Streak-expiry nudge (local notification only)

`notificationSchedule.ts` / `notifications.ts`: the 20:00 local streak nudge
copy reflects the freeze ("…ends tonight — you have a freeze…" vs "…no freeze
left this week…"). When today already has a run the DAILY trigger is replaced
by one-shot triggers for tomorrow and the day after (a streak cannot survive
two silent days), and the plan is rebuilt on launch / streak change.

## Daily challenge (`getDailyChallenge` in `dailyRecommendations.ts`)

One video per local `YYYY-MM-DD`, identical for every user:

```
pool  = levels with a published beatmap (canonical order); if empty → all levels, practice = true
index = fnv1a(`${dateKey}:daily-challenge`) mod pool.length
```

The salt keeps it independent of the featured/recommended discovery rotation.
While the registry ships empty the card is tagged **PRACTICE** (same bonus,
free scoring). Completion is derived (`isDailyChallengeCompleted`): ≥1 run on
that level whose local day equals `dateKey`. `recordRun` passes
`dailyChallenge: true` for the *first* such run of the day, which sets
`xpBonusFactor = 1.25` (XP only; shown as "Daily challenge +25%" in the summary
breakdown). The run counts toward the streak like any other.

## Deferred

- Daily 24-hour leaderboard → feature 2 (needs the backend).
- Beatmaps are still unpublished, so the accuracy gate and non-practice
  challenges activate automatically once `beatmapRegistry.ts` is populated.
