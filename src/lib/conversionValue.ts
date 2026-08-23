/**
 * SKAdNetwork conversion-value schema (Phase 3).
 *
 * A single fine-grained conversion value is 6 bits (0–63) and Apple only keeps
 * the HIGHEST value reported during the postback window — reporting a lower one
 * is discarded. So this schema is a strictly monotonic ladder of funnel
 * milestones; `funnelStore.raiseConversionValue` enforces the never-decrease
 * rule persistently across launches.
 *
 * Ladder (0–7 of the available 0–63):
 *   0  install only
 *   1  opened, no calibration
 *   2  calibration complete
 *   3  one run
 *   4  two+ runs
 *   5  viewed paywall
 *   6  started trial
 *   7  paid conversion
 *
 * RECOMMENDED MODE (default): Singular manages conversion values automatically
 * from the standard/custom events we already send, using the conversion model
 * configured in the Singular dashboard. In that mode this module still tracks a
 * local ladder (for the debug funnel) but does NOT call skanUpdateConversionValue
 * — Singular owns the postback. Set `singularConfig.manualSkanConversion = true`
 * to instead drive conversion values from this ladder in code.
 */

import { isManualSkanConversion, singularSkanUpdateConversionValue } from './singular';
import { raiseConversionValue } from './funnelStore';

export const CONVERSION_STEPS = {
  install: 0,
  opened_no_calibration: 1,
  calibration_complete: 2,
  one_run: 3,
  two_plus_runs: 4,
  paywall_viewed: 5,
  trial_started: 6,
  paid_conversion: 7,
} as const;

export type ConversionStepName = keyof typeof CONVERSION_STEPS;

/**
 * Raise the funnel's conversion value to (at least) `step`. Monotonic: a lower
 * step is ignored. When the app is in manual SKAN mode and the value actually
 * increased, pushes it to Singular's SKAdNetwork conversion value.
 */
export async function bumpConversionValue(step: ConversionStepName): Promise<void> {
  const value = CONVERSION_STEPS[step];
  const applied = await raiseConversionValue(value);
  if (applied !== null && isManualSkanConversion) {
    singularSkanUpdateConversionValue(applied);
  }
}
