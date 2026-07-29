/**
 * Central config for Firebase Auth/Firestore and subscription integrations.
 *
 * All values come from `EXPO_PUBLIC_*` env vars (see `.env.example`). Because
 * CardioSurf ships with clearly-labeled PLACEHOLDER values until the user wires
 * up a real RevenueCat app + Google OAuth client, every consumer must first
 * check the matching `*Configured` flag before touching a native module. This
 * keeps guest/skip/maybe-later paths working in Expo Go and with placeholders.
 */

import { Platform } from 'react-native';

/** A value counts as "real" only if it exists and doesn't look like a placeholder. */
function isReal(value: string | undefined | null): value is string {
  if (!value) return false;
  const v = value.trim();
  if (!v) return false;
  return !/placeholder/i.test(v);
}

// --- RevenueCat -----------------------------------------------------------

const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
/** Platform-agnostic key (e.g. a RevenueCat Test Store key, `test_` prefix). */
const REVENUECAT_UNIFIED_KEY = process.env.EXPO_PUBLIC_REVENUECAT_KEY;

/**
 * Public SDK key for the current runtime, resolved as:
 *   1. the platform key (`appl_` on iOS / `goog_` on Android) when it's real,
 *   2. otherwise the platform-agnostic `EXPO_PUBLIC_REVENUECAT_KEY` (test/prod).
 * Returns null on web/other where the native SDK is unavailable, or when no
 * real (non-placeholder) key is configured.
 */
export const revenueCatApiKey: string | null = (() => {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return null; // web / other → RevenueCat native SDK unavailable
  }
  const platformKey = Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
  if (isReal(platformKey)) return platformKey;
  // Fall back to the unified key so a Test Store key works with no platform keys.
  if (isReal(REVENUECAT_UNIFIED_KEY)) return REVENUECAT_UNIFIED_KEY;
  return null;
})();

/** True when the resolved key is a RevenueCat Test Store key (`test_` prefix). */
export const isRevenueCatTestStoreKey =
  revenueCatApiKey !== null && revenueCatApiKey.startsWith('test_');

/**
 * Entitlement identifier that unlocks CardioSurf Pro. Fully env-driven; defaults
 * to `cardioapp_pro`. This MUST match the identifier created in the RevenueCat
 * dashboard exactly (case + spaces matter).
 */
export const premiumEntitlementId =
  process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT?.trim() || 'cardioapp_pro';

/** True when a usable RevenueCat key exists for this platform (test or prod). */
export const isRevenueCatConfigured = revenueCatApiKey !== null;

// --- Google Sign-In -------------------------------------------------------

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

export const googleWebClientId: string | null = isReal(GOOGLE_WEB_CLIENT_ID)
  ? GOOGLE_WEB_CLIENT_ID
  : null;
export const googleIosClientId: string | null = isReal(GOOGLE_IOS_CLIENT_ID)
  ? GOOGLE_IOS_CLIENT_ID
  : null;

/**
 * Google Sign-In needs, at minimum, a web client id (used on Android and to
 * receive an idToken). Treated as configured only when that real value exists.
 */
export const isGoogleSignInConfigured = googleWebClientId !== null;

// --- Firebase -------------------------------------------------------------

const firebaseValues = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const missingFirebaseConfig = Object.entries(firebaseValues)
  .filter(([, value]) => !isReal(value))
  .map(([key]) => key);

export const isFirebaseConfigured = missingFirebaseConfig.length === 0;

export const firebaseConfig = isFirebaseConfigured
  ? {
      apiKey: firebaseValues.apiKey!,
      authDomain: firebaseValues.authDomain!,
      projectId: firebaseValues.projectId!,
      storageBucket: firebaseValues.storageBucket!,
      messagingSenderId: firebaseValues.messagingSenderId!,
      appId: firebaseValues.appId!,
    }
  : null;

export const firebaseConfigurationError = isFirebaseConfigured
  ? null
  : `Firebase is not configured. Missing EXPO_PUBLIC_FIREBASE_* values: ${missingFirebaseConfig.join(', ')}.`;
