import { Alert, Linking } from 'react-native';

/**
 * Single source of truth for the app's legal document URLs.
 *
 * App Store Review Guideline 3.1.2 requires functional links on any screen that
 * presents auto-renewable subscriptions. These are the live pages; the previous
 * `cardiosurf.github.io` addresses still redirect here, but only over plain
 * HTTP, so the canonical HTTPS origin is used directly.
 *
 * The same URLs must ALSO be configured on the RevenueCat dashboard (Paywall
 * footer) so the hosted paywall shows compliant Terms + Privacy links.
 */
export const PRIVACY_POLICY_URL = 'https://cardiosurf.com/privacy.html';
export const TERMS_URL = 'https://cardiosurf.com/terms.html';

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
