/**
 * App-side entry point for the local `modules/external-display` Expo module.
 *
 * Detection is real on iOS native builds and covers both TV paths: iOS adds a
 * `UIScreen` for AirPlay screen mirroring and wired adapters, and the native
 * AirPlay route picker switches the audio session's output to an AirPlay port.
 * The module relays both as one `connected` flag plus the receiver name. It is
 * `supported: false` in Expo Go, on Android and on web, where callers must fall
 * back to asking the user.
 */
export {
  addExternalDisplayListener,
  getExternalDisplayStatus,
  isExternalDisplayConnected,
  isExternalDisplayMirrored,
  isExternalDisplaySupported,
  useExternalDisplay,
  type ExternalDisplayChangeEvent,
  type ExternalDisplayStatus,
} from '../../modules/external-display';
