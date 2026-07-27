import { Alert, Linking } from 'react-native';

/**
 * Single source of truth for the app's legal document URLs.
 *
 * These are PLACEHOLDER URLs under the app's own domain. They MUST be replaced
 * with the real hosted Privacy Policy / Terms of Use (EULA) pages before App
 * Store submission — App Store Review Guideline 3.1.2 requires functional links
 * on any screen that presents auto-renewable subscriptions.
 *
 * The same URLs must ALSO be configured on the RevenueCat dashboard (Paywall
 * footer) so the hosted paywall shows compliant Terms + Privacy links.
 */
export const PRIVACY_POLICY_URL = 'https://msamim10.github.io/cardioapp/privacy.html';
export const TERMS_URL = 'https://msamim10.github.io/cardioapp/terms.html';

/** Opens a legal URL with a graceful fallback alert if it can't be opened. */
export async function openLegalUrl(url: string): Promise<void> {
  const opened = await Linking.openURL(url).then(
    () => true,
    () => false
  );
  if (!opened) {
    Alert.alert('Couldn\u2019t open link', 'Please try again later.');
  }
}
