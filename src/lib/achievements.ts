/**
 * Post-run recognition, derived purely from persisted run records so the
 * summary screen never has to invent a reward. Everything here is a function of
 * (runs before this one, this run, streak after it): no new currency, no new
 * persistence — the badges the profile already shows use the same thresholds.
 */

import type { IconName } from '@/lib/gameData';
import type { RunRecord } from '@/lib/progressSync';
import type { AccentKey } from '@/theme';

export type Achievement = {
  key: string;
  title: string;
  detail: string;
  icon: IconName;
  accent: AccentKey;
};

export type PersonalBest =
  | { kind: 'first-map' }
  | { kind: 'score'; previous: number }
  | { kind: 'duration'; previousMin: number }
  | null;

const RUN_COUNT_MILESTONES: Record<number, { title: string; detail: string }> = {
  1: { title: 'First run', detail: 'The hardest one is done.' },
  5: { title: 'Five runs', detail: 'This is a habit forming.' },
  10: { title: 'Ten runs', detail: 'Double digits. Real consistency.' },
  25: { title: 'Twenty-five runs', detail: 'A quarter century of sessions.' },
  50: { title: 'Fifty runs', detail: 'Elite consistency.' },
  100: { title: 'One hundred runs', detail: 'Centurion.' },
};

const MINUTE_MILESTONES: readonly { mark: number; title: string }[] = [
  { mark: 60, title: 'One hour moving' },
  { mark: 300, title: 'Five hours moving' },
  { mark: 1000, title: '1,000 minutes moving' },
];

const STREAK_MILESTONES: Record<number, { title: string; detail: string }> = {
  3: { title: '3-day streak', detail: 'Three days back to back.' },
  7: { title: '7-day streak', detail: 'A full week, unbroken.' },
  14: { title: '14-day streak', detail: 'Two weeks without a miss.' },
  30: { title: '30-day streak', detail: 'A month. This is who you are now.' },
};

/**
 * Badges this run unlocked. `runsBefore` must exclude `run`; `streak` is the
 * current day-streak after the run has been recorded.
 */
export function achievementsForRun(
  runsBefore: readonly RunRecord[],
  run: RunRecord,
  streak: number,
): Achievement[] {
  const unlocked: Achievement[] = [];
  const total = runsBefore.length + 1;

  const countMilestone = RUN_COUNT_MILESTONES[total];
  if (countMilestone) {
    unlocked.push({
      key: `runs-${total}`,
      icon: total === 1 ? 'footsteps' : 'medal',
      accent: 'lime',
      ...countMilestone,
    });
  }

  const streakMilestone = STREAK_MILESTONES[streak];
  // A streak milestone only counts on the day it is reached: a second run on
  // the same day leaves the streak unchanged, so it must not re-award.
  if (streakMilestone && !runsBefore.some((r) => sameDay(r.at, run.at))) {
    unlocked.push({
      key: `streak-${streak}`,
      icon: 'flame',
      accent: 'orange',
      ...streakMilestone,
    });
  }

  const mapsBefore = new Set(runsBefore.map((r) => r.levelId));
  if (total > 1 && !mapsBefore.has(run.levelId)) {
    const explored = mapsBefore.size + 1;
    unlocked.push({
      key: `map-${run.levelId}`,
      title: 'New territory',
      detail: `${explored} ${explored === 1 ? 'map' : 'maps'} explored.`,
      icon: 'map',
      accent: 'cyan',
    });
  }

  const totalMinutes = runsBefore.reduce((sum, r) => sum + r.durationMin, 0) + run.durationMin;
  const minutesBefore = totalMinutes - run.durationMin;
  for (const { mark, title } of MINUTE_MILESTONES) {
    if (minutesBefore < mark && totalMinutes >= mark) {
      unlocked.push({
        key: `minutes-${mark}`,
        title,
        detail: 'Lifetime time on your feet.',
        icon: 'time',
        accent: 'violet',
      });
      break;
    }
  }

  return unlocked;
}

/**
 * Whether this run beat the user's own history. Score on the same map wins
 * over duration; a first visit to a map is called out separately because there
 * is nothing to compare against yet.
 */
export function personalBestForRun(runsBefore: readonly RunRecord[], run: RunRecord): PersonalBest {
  const sameMap = runsBefore.filter((r) => r.levelId === run.levelId);
  if (sameMap.length === 0) return runsBefore.length > 0 ? { kind: 'first-map' } : null;

  const bestScore = Math.max(...sameMap.map((r) => r.poseScore));
  if (run.poseScore > 0 && run.poseScore > bestScore) {
    return { kind: 'score', previous: bestScore };
  }
  const longest = Math.max(...runsBefore.map((r) => r.durationMin));
  if (run.durationMin > longest + 0.5) {
    return { kind: 'duration', previousMin: longest };
  }
  return null;
}

function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}
