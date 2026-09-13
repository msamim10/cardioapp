/**
 * Pure, native-free scheduling logic for the local workout / streak reminders.
 *
 * Kept separate from `notifications.ts` (which touches the native
 * `expo-notifications` module) so the day/time cadence and streak copy can be
 * replayed and reasoned about without the native module present.
 *
 * Weekday numbers follow the expo-notifications convention: 1 = Sunday ...
 * 7 = Saturday.
 */

/** Marks a scheduled notification as ours so we only ever cancel our own. */
export const REMINDER_SOURCE = 'cardiosurf-reminder';

export type ReminderKind = 'weekly' | 'streak';

/** Default local delivery time for the recurring weekly run reminders (6:00 PM). */
export const WEEKLY_REMINDER_HOUR = 18;
export const WEEKLY_REMINDER_MINUTE = 0;

/** The streak nudge lands later so it reads as a gentle "last chance" (8:00 PM). */
export const STREAK_REMINDER_HOUR = 20;
export const STREAK_REMINDER_MINUTE = 0;

export type WeeklyReminderSlot = {
  kind: 'weekly';
  weekday: number; // 1-7, Sunday = 1
  hour: number;
  minute: number;
  title: string;
  body: string;
};

export type StreakReminderSlot = {
  kind: 'streak';
  hour: number;
  minute: number;
  title: string;
  body: string;
  /**
   * Today already has a run, so tonight's nudge is pointless: the first
   * delivery must be tomorrow. `notifications.ts` then schedules one-shot
   * triggers for tomorrow's and the day after's slot instead of a DAILY
   * trigger (a streak cannot outlive two silent days even with a freeze, and
   * the plan is rebuilt on every launch / streak change anyway).
   */
  startsTomorrow: boolean;
};

export type ReminderPlan = {
  weekly: WeeklyReminderSlot[];
  streak: StreakReminderSlot;
};

/**
 * Evenly-spread weekday sets for a given weekly run goal so reminders don't
 * bunch up. Keyed by the clamped 2–6 goal (see `weeklyGoalOptions`).
 */
const WEEKDAY_SPREAD: Record<number, number[]> = {
  2: [2, 5], // Mon, Thu
  3: [2, 4, 6], // Mon, Wed, Fri
  4: [1, 2, 4, 6], // Sun, Mon, Wed, Fri
  5: [2, 3, 4, 5, 6], // Mon–Fri
  6: [2, 3, 4, 5, 6, 7], // Mon–Sat
};

const MIN_DAYS = 2;
const MAX_DAYS = 6;
const DEFAULT_DAYS = 4;

const WEEKLY_TITLE = 'Time for your run';
const WEEKLY_BODY = 'Time for your run — keep the momentum going.';

/** Weekday numbers (1 = Sunday) to schedule weekly reminders on for a goal. */
export function reminderDaysFor(daysPerWeek: number | null | undefined): number[] {
  const n =
    typeof daysPerWeek === 'number' && Number.isFinite(daysPerWeek)
      ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(daysPerWeek)))
      : DEFAULT_DAYS;
  return WEEKDAY_SPREAD[n] ?? WEEKDAY_SPREAD[DEFAULT_DAYS];
}

/**
 * Streak-nudge copy. Because a recurring local notification bakes its text in at
 * schedule time, callers reschedule on launch so the day count stays accurate.
 * `freezeAvailable` (one streak freeze per Monday-local week, derived from run
 * history) changes the stakes: with a freeze tonight's miss is covered once.
 */
export function streakReminderCopy(
  streak: number,
  options: { freezeAvailable?: boolean } = {}
): { title: string; body: string } {
  const safe = Number.isFinite(streak) ? Math.max(0, Math.floor(streak)) : 0;
  if (safe <= 0) {
    return {
      title: 'Keep your streak alive',
      body: 'Start a streak today — a quick run is all it takes.',
    };
  }
  const dayLabel = safe === 1 ? '1-day' : `${safe}-day`;
  if (options.freezeAvailable) {
    return {
      title: 'Protect your streak',
      body: `Your ${dayLabel} streak ends tonight — you have a freeze, but a quick run keeps it growing.`,
    };
  }
  return {
    title: 'Protect your streak',
    body: `Your ${dayLabel} streak ends tonight — no freeze left this week. Jump in for a quick run.`,
  };
}

/** Build the full reminder plan (weekly slots + a single streak nudge). */
export function buildReminderPlan({
  daysPerWeek,
  streak,
  ranToday = false,
  freezeAvailable = false,
}: {
  daysPerWeek: number | null | undefined;
  streak: number;
  /** A run already exists today → the streak nudge first fires tomorrow. */
  ranToday?: boolean;
  /** This week's streak freeze is unspent → softer copy. */
  freezeAvailable?: boolean;
}): ReminderPlan {
  const weekly = reminderDaysFor(daysPerWeek).map<WeeklyReminderSlot>((weekday) => ({
    kind: 'weekly',
    weekday,
    hour: WEEKLY_REMINDER_HOUR,
    minute: WEEKLY_REMINDER_MINUTE,
    title: WEEKLY_TITLE,
    body: WEEKLY_BODY,
  }));

  const copy = streakReminderCopy(streak, { freezeAvailable });
  const streakSlot: StreakReminderSlot = {
    kind: 'streak',
    hour: STREAK_REMINDER_HOUR,
    minute: STREAK_REMINDER_MINUTE,
    title: copy.title,
    body: copy.body,
    startsTomorrow: ranToday,
  };

  return { weekly, streak: streakSlot };
}

/**
 * Seconds from `now` until the streak slot on the NEXT local day. Used for the
 * one-shot triggers when today already has a run.
 */
export function secondsUntilTomorrowSlot(
  slot: { hour: number; minute: number },
  now = Date.now()
): number {
  const target = new Date(now);
  target.setDate(target.getDate() + 1);
  target.setHours(slot.hour, slot.minute, 0, 0);
  return Math.max(60, Math.round((target.getTime() - now) / 1000));
}

export const ONE_DAY_SECONDS = 24 * 60 * 60;
