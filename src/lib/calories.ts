import { DEFAULT_MET } from './constants';

/**
 * MET-based calorie estimate.
 * caloriesPerMin = (MET * 3.5 * weightKg) / 200
 */
export function caloriesPerMinute(weightKg: number, met: number = DEFAULT_MET): number {
  return (met * 3.5 * weightKg) / 200;
}

export function estimateCalories(
  weightKg: number,
  durationSec: number,
  met: number = DEFAULT_MET,
): number {
  return (caloriesPerMinute(weightKg, met) * durationSec) / 60;
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export function formatLongDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
