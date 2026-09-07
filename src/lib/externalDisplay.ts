/**
 * App-side entry point for the local `modules/external-display` Expo module.
 *
 * Detection is real on iOS native builds: iOS adds a `UIScreen` for AirPlay
 * screen mirroring and wired adapters, and the module relays connect and
 * disconnect notifications. It is `supported: false` in Expo Go, on Android and
 * on web, where callers must fall back to asking the user.
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
