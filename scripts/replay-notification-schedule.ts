import assert from 'node:assert/strict';
// prettier-ignore
// @ts-expect-error -- Node type-stripping requires the source extension.
import { buildReminderPlan, reminderDaysFor, secondsUntilTomorrowSlot, streakReminderCopy, WEEKLY_REMINDER_HOUR, STREAK_REMINDER_HOUR } from '../src/lib/notificationSchedule.ts';

// Weekly goal → number of evenly-spread reminder days (clamped to 2–6).
assert.equal(reminderDaysFor(2).length, 2);
assert.equal(reminderDaysFor(3).length, 3);
assert.equal(reminderDaysFor(4).length, 4);
assert.equal(reminderDaysFor(5).length, 5);
assert.equal(reminderDaysFor(6).length, 6);

// Out-of-range / missing goals clamp to the supported window and default to 4.
assert.equal(reminderDaysFor(99).length, 6);
assert.equal(reminderDaysFor(0).length, 2);
assert.equal(reminderDaysFor(null).length, 4);
assert.equal(reminderDaysFor(undefined).length, 4);

// Days are valid expo weekday numbers (1–7) with no duplicates.
for (const goal of [2, 3, 4, 5, 6]) {
  const days = reminderDaysFor(goal);
  assert.equal(new Set(days).size, days.length, `duplicate weekday for goal ${goal}`);
  for (const day of days) {
    assert.ok(day >= 1 && day <= 7, `weekday ${day} out of range for goal ${goal}`);
  }
}

// Streak copy: 0 encourages starting; >=1 protects the exact day count.
assert.ok(/start a streak/i.test(streakReminderCopy(0).body));
assert.ok(streakReminderCopy(1).body.includes('1-day'));
assert.ok(streakReminderCopy(7).body.includes('7-day'));
assert.ok(streakReminderCopy(NaN).body.length > 0);
// No emojis in any generated copy.
const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
assert.ok(!emoji.test(streakReminderCopy(5).body));

// Full plan: one weekly slot per day + a single streak nudge at the later hour.
const plan = buildReminderPlan({ daysPerWeek: 3, streak: 4 });
assert.equal(plan.weekly.length, 3);
assert.ok(plan.weekly.every((slot) => slot.hour === WEEKLY_REMINDER_HOUR));
assert.equal(plan.streak.hour, STREAK_REMINDER_HOUR);
assert.ok(plan.streak.body.includes('4-day'));
assert.equal(plan.streak.startsTomorrow, false);
assert.ok(!emoji.test(plan.weekly[0].body));

// Streak-freeze aware copy: the same day count, different stakes.
const withFreeze = streakReminderCopy(5, { freezeAvailable: true });
const noFreeze = streakReminderCopy(5, { freezeAvailable: false });
assert.ok(withFreeze.body.includes('5-day') && /you have a freeze/i.test(withFreeze.body));
assert.ok(noFreeze.body.includes('5-day') && /no freeze/i.test(noFreeze.body));
assert.notEqual(withFreeze.body, noFreeze.body);
assert.ok(!emoji.test(withFreeze.body) && !emoji.test(noFreeze.body));
// A 0 streak has nothing to protect; freeze availability doesn't change the ask.
assert.deepEqual(streakReminderCopy(0, { freezeAvailable: true }), streakReminderCopy(0));

// Today already has a run → tonight's nudge is skipped (first delivery tomorrow).
const ranToday = buildReminderPlan({ daysPerWeek: 3, streak: 4, ranToday: true, freezeAvailable: true });
assert.equal(ranToday.streak.startsTomorrow, true);
assert.ok(/you have a freeze/i.test(ranToday.streak.body));
assert.equal(ranToday.weekly.length, 3, 'weekly slots are unaffected by today\'s run');

// One-shot offset lands on tomorrow's slot, never in the past.
const tenAm = new Date(2026, 8, 13, 10, 0, 0, 0).getTime(); // local 10:00
const offset = secondsUntilTomorrowSlot({ hour: STREAK_REMINDER_HOUR, minute: 0 }, tenAm);
assert.equal(offset, 34 * 60 * 60, 'tomorrow 20:00 is 34h after today 10:00');
const lateNight = new Date(2026, 8, 13, 23, 30, 0, 0).getTime();
assert.equal(secondsUntilTomorrowSlot({ hour: STREAK_REMINDER_HOUR, minute: 0 }, lateNight), 20.5 * 60 * 60);
assert.ok(secondsUntilTomorrowSlot({ hour: 0, minute: 0 }, lateNight) >= 60);

console.log('Notification schedule replay passed: day spread, clamping, streak copy, freeze copy, ran-today skip, one-shot offset, plan shape');
