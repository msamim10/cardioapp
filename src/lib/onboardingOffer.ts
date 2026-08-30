/**
 * Presents the end-of-onboarding offer. Extracted from AccountAuthScreen so the
 * plan screen, which now sits between account creation and the offer, presents
 * it through exactly the same path rather than a parallel copy.
 *
 * The offer is the last step of onboarding: the account already exists (so a
 * bounce here is still a recoverable email) and RevenueCat is already keyed to
 * the Firebase UID, so a purchase lands on the right customer instead of an
 * anonymous one that has to be aliased afterwards.
 *
 * Awaiting the ATT request is what keeps the two native modals apart. It also
 * guarantees the ask happened at all: a user who signs in faster than the auth
 * screen's prompt delay would otherwise unmount that screen before the scheduled
 * prompt fired and lose the IDFA for good. The call is one-shot across the app's
 * lifetime, so this can never produce a second sheet.
 *
 * The claim is taken up front and released again when nothing was presented, so
 * a hosted paywall that is unavailable this once doesn't burn the step.
 */

import { requestTrackingAuthorization } from './analytics';
import { claimOnboardingPaywall, releaseOnboardingPaywall } from './funnelStore';
import { synchronizePurchasesIdentity } from './purchases';
import type { PaywallUIResult } from './purchases';
import {
  allowsUnpaidAccess,
  requestOnboardingSubscriptionAccess,
} from './subscriptionAccess';

/**
 * Gap between the ATT sheet being answered and the paywall being presented. Two
 * native modals must never be in flight together — the ATT sheet needs its
 * dismissal animation to finish before UIKit is asked to present again.
 */
export const PAYWALL_AFTER_ATT_DELAY_MS = 450;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function presentOnboardingOffer({
  userId,
  isPremium,
  presentPaywall,
  isMounted,
}: {
  userId: string | null;
  isPremium: boolean;
  presentPaywall: (opts?: { ifNeeded?: boolean }) => Promise<PaywallUIResult>;
  isMounted: () => boolean;
}): Promise<void> {
  if (isPremium || allowsUnpaidAccess()) return;
  if (!(await claimOnboardingPaywall())) return;
  let presented = false;
  try {
    await requestTrackingAuthorization();
    if (!isMounted()) return;
    // Keyed to the Firebase UID before presenting, so a purchase made on the
    // hosted paywall lands on this account rather than an anonymous one. This
    // also configures the SDK; `presentHostedPaywall` then waits for offerings.
    if (userId) await synchronizePurchasesIdentity(userId);
    await wait(PAYWALL_AFTER_ATT_DELAY_MS);
    if (!isMounted()) return;
    presented = (await requestOnboardingSubscriptionAccess(presentPaywall)) !== 'not_shown';
    if (!presented) {
      console.error(
        '[onboarding] end-of-onboarding RevenueCat paywall was NOT presented — see the ' +
          'preceding [paywall] error for the cause. The user reaches the tabs unpaywalled ' +
          'and is gated again by the level screen.'
      );
    }
  } catch (e) {
    // The offer is never allowed to strand a signed-in user mid-flow, but a
    // throw here means the step is silently skipped, so it has to be visible.
    console.error('[onboarding] presenting the end-of-onboarding offer threw:', e);
  } finally {
    if (!presented) void releaseOnboardingPaywall();
  }
}
