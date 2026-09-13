/**
 * End-to-end pose pipeline latency: per-frame stamps → per-run percentiles.
 *
 * Stamps (all epoch ms, `Date.now()` domain — the native side converts the
 * camera's host-clock presentation time with a per-frame offset):
 *
 *   captureTs    camera presentation timestamp of the frame
 *   extractedTs  after Vision inference + keypoint extraction (visionQueue)
 *   dispatchTs   right before the event is sent to JS (main thread)
 *   receivedTs   `Date.now()` when JS received the event
 *   classifiedTs after `PoseAnalyzer.process` returned
 *
 * Deltas: inference = extracted − capture (camera queueing + Vision),
 * mainHop = dispatch − extracted, bridge = received − dispatch,
 * analyze = classified − received, total = classified − capture.
 *
 * Nothing here is logged per frame. Samples go into a bounded reservoir and one
 * summary is emitted at run end (see `logPoseLatency` in analytics.ts).
 */

import type { PoseFrame } from '@/lib/poseTracking';

/**
 * A frame older than this on receipt is dropped before it reaches the analyzer
 * (see `frameAgeMs`). 250 ms matches the analyzer's FRAME_GAP_MS: a frame that
 * stale would describe a body position the player has already moved out of.
 */
export const STALE_FRAME_MS = 250;

/** Max samples retained per metric; beyond this, reservoir sampling keeps a uniform subset. */
export const LATENCY_RESERVOIR_CAP = 4000;

export const LATENCY_METRICS = ['inference', 'mainHop', 'bridge', 'analyze', 'total'] as const;
export type LatencyMetric = (typeof LATENCY_METRICS)[number];
export type LatencyDeltas = Record<LatencyMetric, number>;

export type LatencyPercentiles = { p50: number; p95: number; max: number };

export type LatencySummary = {
  frames: number;
  staleFramesDropped: number;
  metrics: Record<LatencyMetric, LatencyPercentiles>;
};

/**
 * Age of a frame on receipt. Negative ages (clock skew between the native
 * offset and `Date.now()`, or a frame stamped in the future) clamp to 0 so skew
 * can never drop frames. Frames without a `captureTs` (older native builds)
 * report age 0 and are never considered stale.
 */
export function frameAgeMs(frame: Pick<PoseFrame, 'captureTs'>, now = Date.now()): number {
  if (typeof frame.captureTs !== 'number' || !Number.isFinite(frame.captureTs)) return 0;
  return Math.max(0, now - frame.captureTs);
}

export function isStaleFrame(frame: Pick<PoseFrame, 'captureTs'>, now = Date.now()): boolean {
  return frameAgeMs(frame, now) > STALE_FRAME_MS;
}

/**
 * Per-frame deltas, or null when the frame lacks the native stamps. Each delta
 * is clamped at 0: individual stamps come from two clocks (host vs. wall) and a
 * sub-millisecond inversion must not produce negative latency.
 */
export function latencyDeltas(frame: PoseFrame, classifiedTs: number): LatencyDeltas | null {
  const { captureTs, extractedTs, dispatchTs, receivedTs } = frame;
  if (
    !isFiniteNumber(captureTs) ||
    !isFiniteNumber(extractedTs) ||
    !isFiniteNumber(dispatchTs) ||
    !isFiniteNumber(receivedTs) ||
    !isFiniteNumber(classifiedTs)
  ) {
    return null;
  }
  return {
    inference: Math.max(0, extractedTs - captureTs),
    mainHop: Math.max(0, dispatchTs - extractedTs),
    bridge: Math.max(0, receivedTs - dispatchTs),
    analyze: Math.max(0, classifiedTs - receivedTs),
    total: Math.max(0, classifiedTs - captureTs),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Nearest-rank percentile over an unsorted sample array (copies before sorting). */
export function percentile(samples: readonly number[], q: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[rank];
}

/**
 * Bounded per-run latency collector. Up to `cap` samples per metric are kept
 * verbatim; after that Algorithm R reservoir sampling keeps a uniform random
 * subset, so memory is fixed and percentiles stay unbiased for long runs.
 */
export class LatencyReservoir {
  private readonly samples: Record<LatencyMetric, number[]>;
  private readonly cap: number;
  private readonly random: () => number;
  private seen = 0;
  private stale = 0;

  constructor(cap = LATENCY_RESERVOIR_CAP, random: () => number = Math.random) {
    this.cap = cap;
    this.random = random;
    this.samples = {
      inference: [],
      mainHop: [],
      bridge: [],
      analyze: [],
      total: [],
    };
  }

  get frames(): number {
    return this.seen;
  }

  get staleFramesDropped(): number {
    return this.stale;
  }

  recordStaleDrop(): void {
    this.stale += 1;
  }

  record(deltas: LatencyDeltas): void {
    this.seen += 1;
    if (this.seen <= this.cap) {
      for (const metric of LATENCY_METRICS) this.samples[metric].push(deltas[metric]);
      return;
    }
    // Replace a random slot with probability cap / seen (same slot for every
    // metric so the per-frame tuples stay aligned).
    const slot = Math.floor(this.random() * this.seen);
    if (slot < this.cap) {
      for (const metric of LATENCY_METRICS) this.samples[metric][slot] = deltas[metric];
    }
  }

  /** Live p50 of the end-to-end total; cheap enough for a dev readout. */
  p50Total(): number {
    return Math.round(percentile(this.samples.total, 0.5));
  }

  summary(): LatencySummary {
    const metrics = {} as Record<LatencyMetric, LatencyPercentiles>;
    for (const metric of LATENCY_METRICS) {
      const values = this.samples[metric];
      metrics[metric] = {
        p50: Math.round(percentile(values, 0.5)),
        p95: Math.round(percentile(values, 0.95)),
        max: values.length ? Math.round(Math.max(...values)) : 0,
      };
    }
    return { frames: this.seen, staleFramesDropped: this.stale, metrics };
  }
}
