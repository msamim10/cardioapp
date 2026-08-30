/**
 * SKAdNetwork conversion-value schema (Phase 3).
 *
 * A single fine-grained conversion value is 6 bits (0–63) and Apple only keeps
 * the HIGHEST value reported during the postback window — reporting a lower one
 * is discarded. So this schema is a strictly monotonic ladder of funnel
 * milestones; `funnelStore.raiseConversionValue` enforces the never-decrease
 * rule persistently across launches.
 *
 * The rungs MUST be ordered the way users actually move through CardioSurf.
 * The paywall is a hard gate presented as the last step of onboarding, right
 * after account creation, so the offer is now seen BEFORE the camera
 * calibration rather than after it: calibration and runs are only reachable
 * once the entitlement is active. Calibration therefore sits above the paywall
 * and the trial, and completed runs above that — runs during the 3-day trial
 * are the best predictor of trial → paid conversion, which makes 5 and 6 the
 * states worth optimizing towards.
 *
 * Ladder (0–7 of the available 0–63):
 *   0  install only, no activity
 *   1  opened / registered, offer not yet seen
 *   2  paywall viewed
 *   3  trial started
 *   4  calibration complete
 *   5  one run completed
 *   6  two or more runs completed
 *   7  paid conversion
 *
 * Monthly has no introductory offer, so a monthly buyer jumps straight from 2
 * to 7 and their calibration/run rungs are never reported. That is the intended
 * trade-off: a paid conversion is the most valuable signal available, and Apple
 * keeps only the highest value.
 *
 * Re-entrant events are safe: the paywall can be viewed again (or a trial
 * restored) after runs have been logged, and `raiseConversionValue` drops those
 * lower rungs instead of regressing the committed value.
 *
 * RECOMMENDED MODE (default): Singular manages conversion values automatically
 * from the standard/custom events we already send, using the conversion model
 * configured in the Singular dashboard. In that mode this module still tracks a
 * local ladder (for the debug funnel) but does NOT call skanUpdateConversionValue
 * — Singular owns the postback. Set `singularConfig.manualSkanConversion = true`
 * to instead drive conversion values from this ladder in code. The dashboard
 * model must mirror the ladder above so both paths agree.
 */

import { isManualSkanConversion, singularSkanUpdateConversionValue } from './singular';
import { raiseConversionValue } from './funnelStore';

export const CONVERSION_STEPS = {
  install: 0,
  opened_offer_unseen: 1,
  paywall_viewed: 2,
  trial_started: 3,
  calibration_complete: 4,
  one_run: 5,
  two_plus_runs: 6,
  paid_conversion: 7,
} as const;

export type ConversionStepName = keyof typeof CONVERSION_STEPS;

/** The ladder in ascending order, with labels for the debug funnel screen. */
export const CONVERSION_LADDER: readonly { value: number; label: string }[] = [
  { value: CONVERSION_STEPS.install, label: 'Install only' },
  { value: CONVERSION_STEPS.opened_offer_unseen, label: 'Opened, offer not seen' },
  { value: CONVERSION_STEPS.paywall_viewed, label: 'Paywall viewed' },
  { value: CONVERSION_STEPS.trial_started, label: 'Trial started' },
  { value: CONVERSION_STEPS.calibration_complete, label: 'Calibration complete' },
  { value: CONVERSION_STEPS.one_run, label: 'One run completed' },
  { value: CONVERSION_STEPS.two_plus_runs, label: 'Two or more runs' },
  { value: CONVERSION_STEPS.paid_conversion, label: 'Paid conversion' },
];

/** Label for a committed conversion value, including values outside the ladder. */
export function describeConversionValue(value: number): string {
  return CONVERSION_LADDER.find((rung) => rung.value === value)?.label ?? `Value ${value}`;
}

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

/**
 * Raise the ladder for a completed run, given the device's lifetime completed-run
 * count from `funnelStore`: the first run is `one_run`, any run after it is
 * `two_plus_runs`. The count is persisted, so the distinction survives relaunches.
 */
export function bumpConversionValueForRunCount(runCount: number): Promise<void> {
  return bumpConversionValue(runCount >= 2 ? 'two_plus_runs' : 'one_run');
}
