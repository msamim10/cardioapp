import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo-modules-core';
import {
  isStoreReviewEligible,
  REVIEW_REQUESTED_STORAGE_KEY,
} from '@/lib/reviewEligibility';

let requestInFlight = false;

/**
 * Attempts the system-owned review flow once, after a real completion milestone.
 * The flag is persisted before invoking StoreKit/Play so remounts cannot race.
 */
export async function requestMilestoneStoreReview(completedRunCount: number): Promise<void> {
  if (requestInFlight) return;
  requestInFlight = true;

  try {
    const alreadyRequested =
      (await AsyncStorage.getItem(REVIEW_REQUESTED_STORAGE_KEY)) === '1';
    if (alreadyRequested) return;

    // Probe without throwing before importing: older development builds may
    // not contain this native module at all.
    if (requireOptionalNativeModule('ExpoStoreReview') === null) return;
    const StoreReview = await import('expo-store-review');
    const supported = await StoreReview.hasAction();
    if (
      !isStoreReviewEligible({
        completedRunCount,
        alreadyRequested,
        supported,
      })
    ) {
      return;
    }

    await AsyncStorage.setItem(REVIEW_REQUESTED_STORAGE_KEY, '1');
    await StoreReview.requestReview();
  } catch {
    // Review prompts are optional and must never interrupt the completed-run flow.
  } finally {
    requestInFlight = false;
  }
}
