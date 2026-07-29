import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { buildReminderPlan, REMINDER_SOURCE } from '@/lib/notificationSchedule';
import type * as Notifications from 'expo-notifications';

/**
 * Local (on-device) notification scheduling for workout + streak reminders.
 *
 * There is no backend and no push: everything here uses `expo-notifications`
 * scheduled locals, so no `aps-environment` entitlement / APNs is required.
 *
 * `expo-notifications` is a native module, so every entry point is guarded to
 * no-op (returning 'unavailable' where relevant) on web and on older dev builds
 * that predate the native module — mirroring the guards in `storeReview.ts`.
 */

export type PermissionResult = 'granted' | 'denied' | 'unavailable';

/** Data tag written onto every reminder so we only ever cancel our own. */
type ReminderData = { source: typeof REMINDER_SOURCE; kind: 'weekly' | 'streak' };

/**
 * Returns the live `expo-notifications` module only when the backing native
 * module is actually present, otherwise `null`. Kept sync + cheap so callers
 * can bail before awaiting anything.
 */
function getNotificationsModule(): typeof Notifications | null {
  if (Platform.OS === 'web') return null;
  try {
    if (requireOptionalNativeModule('ExpoNotificationScheduler') === null) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as typeof Notifications;
  } catch {
    return null;
  }
}

let handlerConfigured = false;

/**
 * Configure sane foreground presentation once. Safe to call on every launch;
 * it no-ops after the first successful call and on builds without the module.
 */
export function initNotificationHandler(): void {
  if (handlerConfigured) return;
  const mod = getNotificationsModule();
  if (!mod) return;
  try {
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    handlerConfigured = true;
  } catch {
    // Presentation config is best-effort; scheduling still works without it.
  }
}

/**
 * Request notification permission. Returns 'granted' / 'denied', or
 * 'unavailable' on web / older builds lacking the native module.
 */
export async function ensureNotificationPermission(): Promise<PermissionResult> {
  const mod = getNotificationsModule();
  if (!mod) return 'unavailable';
  try {
    const current = await mod.getPermissionsAsync();
    if (current.granted) return 'granted';
    if (!current.canAskAgain && current.status === 'denied') return 'denied';
    const requested = await mod.requestPermissionsAsync();
    return requested.granted ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/** Current permission without prompting. 'unavailable' when the module is absent. */
export async function getNotificationPermission(): Promise<PermissionResult> {
  const mod = getNotificationsModule();
  if (!mod) return 'unavailable';
  try {
    const current = await mod.getPermissionsAsync();
    return current.granted ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/** Cancel only the reminders this app scheduled (identified by our data tag). */
async function cancelOurReminders(mod: typeof Notifications): Promise<void> {
  const scheduled = await mod.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => {
        const data = request.content?.data as Partial<ReminderData> | undefined;
        return data?.source === REMINDER_SOURCE;
      })
      .map((request) => mod.cancelScheduledNotificationAsync(request.identifier))
  );
}

/** Public: cancel every reminder we scheduled. No-ops without the native module. */
export async function cancelAllReminders(): Promise<void> {
  const mod = getNotificationsModule();
  if (!mod) return;
  try {
    await cancelOurReminders(mod);
  } catch {
    // Never let reminder maintenance surface an error to callers.
  }
}

/**
 * Cancel our existing reminders and (re)schedule the weekly workout reminders +
 * streak nudge derived from the user's weekly goal and current streak.
 *
 * - `enabled: false` (or denied/unavailable permission) → cancel only, no schedule.
 * - Always cancels first so repeated calls (cold start, schedule changes) are
 *   idempotent and never stack duplicates.
 */
export async function scheduleWeeklyReminders({
  daysPerWeek,
  streak,
  enabled,
}: {
  daysPerWeek: number | null | undefined;
  streak: number;
  /** Optional: timestamp of the most recent run. Reserved for future tuning. */
  lastRunAt?: number | null;
  enabled: boolean;
}): Promise<'scheduled' | 'cancelled' | 'unavailable'> {
  const mod = getNotificationsModule();
  if (!mod) return 'unavailable';

  try {
    // Always clear ours first so this is idempotent across relaunches.
    await cancelOurReminders(mod);

    if (!enabled) return 'cancelled';

    const permission = await mod.getPermissionsAsync();
    if (!permission.granted) return 'cancelled';

    const { SchedulableTriggerInputTypes } = mod;
    const plan = buildReminderPlan({ daysPerWeek, streak });

    await Promise.all(
      plan.weekly.map((slot) =>
        mod.scheduleNotificationAsync({
          content: {
            title: slot.title,
            body: slot.body,
            data: { source: REMINDER_SOURCE, kind: 'weekly' } satisfies ReminderData,
          },
          trigger: {
            type: SchedulableTriggerInputTypes.WEEKLY,
            weekday: slot.weekday,
            hour: slot.hour,
            minute: slot.minute,
          },
        })
      )
    );

    await mod.scheduleNotificationAsync({
      content: {
        title: plan.streak.title,
        body: plan.streak.body,
        data: { source: REMINDER_SOURCE, kind: 'streak' } satisfies ReminderData,
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DAILY,
        hour: plan.streak.hour,
        minute: plan.streak.minute,
      },
    });

    return 'scheduled';
  } catch {
    return 'unavailable';
  }
}
