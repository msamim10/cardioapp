/**
 * Singular SDK credentials — TEMPLATE (committed, safe to share).
 *
 * SETUP (do this once per clone):
 *   cp src/lib/singularConfig.example.ts src/lib/singularConfig.ts
 * The real `singularConfig.ts` is GITIGNORED so keys are never committed.
 *
 * You can supply keys two ways (env is preferred for CI / EAS secrets):
 *   1. Set EXPO_PUBLIC_SINGULAR_SDK_KEY / EXPO_PUBLIC_SINGULAR_SDK_SECRET in
 *      your `.env` (see `.env.example`) — the file below reads them.
 *   2. Or paste the literal values into `singularConfig.ts` (still gitignored).
 *
 * Where to find them: Singular dashboard → Developer Tools → SDK Keys.
 * The SDK Key + SDK Secret are CLIENT SDK credentials (embedded in the app);
 * they are NOT server/admin secrets, but must still never be committed.
 */

export const singularConfig = {
  /** Singular SDK Key. */
  sdkKey: process.env.EXPO_PUBLIC_SINGULAR_SDK_KEY ?? 'PLACEHOLDER_SINGULAR_SDK_KEY',
  /** Singular SDK Secret. */
  sdkSecret: process.env.EXPO_PUBLIC_SINGULAR_SDK_SECRET ?? 'PLACEHOLDER_SINGULAR_SDK_SECRET',
  /**
   * SKAdNetwork conversion-value management (see conversionValue.ts / Phase 3).
   *  - false (RECOMMENDED): Singular manages conversion values automatically
   *    from the events we send, using the conversion model configured in the
   *    Singular dashboard (Attribution → SKAdNetwork → Conversion Model).
   *  - true: this app updates conversion values IN CODE via our local 0–7
   *    schema. Requires Singular to be inited with manual SKAN management.
   */
  manualSkanConversion: false,
};
