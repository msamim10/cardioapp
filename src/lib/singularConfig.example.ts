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
  /**
   * WHO reports the canonical Singular conversion events, `sng_start_trial` and
   * `sng_subscribe`. Exactly one source may own them, or Singular counts the
   * same purchase twice. See `analytics.ts` for how each mode behaves.
   *
   *  - 'client' (DEFAULT): this app sends them, with revenue, from the Singular
   *    SDK. Required for Singular accounts created on or after 2026-07-15:
   *    those accounts use Singular's Event API v2 / Singular Device ID (SDID),
   *    which RevenueCat's integration does not support, so RevenueCat delivers
   *    nothing at all. Singular also documents SDID as incompatible with
   *    third-party forwarders (RevenueCat, Adapty) outright.
   *  - 'revenuecat': the RevenueCat → Singular server integration owns them, and
   *    this app emits only the non-revenue `client_*` diagnostics. Correct for
   *    older (v1/IDFA) Singular accounts where that integration works, and the
   *    mode to switch to if RevenueCat ever ships v2 + SDID support.
   *
   * Switch modes BEFORE enabling the RevenueCat integration, never after.
   */
  revenueSource: process.env.EXPO_PUBLIC_SINGULAR_REVENUE_SOURCE ?? 'client',
  /**
   * Whether a trial start carries a revenue amount (only applies when
   * `revenueSource` is 'client').
   *
   *  - 'none' (DEFAULT): send `sng_start_trial` as a plain event. This is what
   *    Singular's own subscription guide prescribes, and what RevenueCat's
   *    integration does (amt: 0) — a trial has produced no money yet, and the
   *    conversion reports the real amount when it happens.
   *  - 'price': send `sng_start_trial` as a revenue event worth the product's
   *    full price. Singular treats any event carrying an amount as a revenue
   *    event, so this is what makes trial starts biddable as revenue in ad
   *    networks — at the cost of booking revenue that may never arrive, and of
   *    counting a converting trial's price twice (once here, once at
   *    `sng_subscribe`). Only set this if an ad network requires it.
   */
  trialStartRevenue: process.env.EXPO_PUBLIC_SINGULAR_TRIAL_START_REVENUE ?? 'none',
};
