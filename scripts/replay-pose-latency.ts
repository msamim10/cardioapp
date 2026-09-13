import assert from 'node:assert/strict';
import {
  frameAgeMs,
  isStaleFrame,
  LATENCY_METRICS,
  LatencyReservoir,
  latencyDeltas,
  percentile,
  STALE_FRAME_MS,
  // @ts-expect-error -- required by Node's type-stripping ESM resolver
} from '../src/lib/poseLatency.ts';
import type { PoseFrame } from '../src/lib/poseTracking';

function stampedFrame(captureTs: number, offsets: Partial<Record<'extracted' | 'dispatch' | 'received', number>> = {}): PoseFrame {
  const { extracted = 60, dispatch = 65, received = 80 } = offsets;
  return {
    origin: 'native',
    keypoints: [],
    sourceWidth: 720,
    sourceHeight: 1280,
    timestamp: captureTs + dispatch,
    captureTs,
    extractedTs: captureTs + extracted,
    dispatchTs: captureTs + dispatch,
    receivedTs: captureTs + received,
  };
}

// Staleness: age from captureTs; negative ages clamp to 0; missing stamps never stale.
assert.equal(STALE_FRAME_MS, 250);
assert.equal(frameAgeMs({ captureTs: 1_000 }, 1_200), 200);
assert.equal(frameAgeMs({ captureTs: 1_000 }, 900), 0, 'clock skew must not yield negative age');
assert.equal(frameAgeMs({}, 1_000), 0);
assert.equal(isStaleFrame({ captureTs: 1_000 }, 1_250), false, 'exactly 250 ms is not stale');
assert.equal(isStaleFrame({ captureTs: 1_000 }, 1_251), true);
assert.equal(isStaleFrame({ captureTs: 5_000 }, 1_000), false, 'future-stamped frame is not stale');
assert.equal(isStaleFrame({}, 10_000_000), false, 'old native builds without stamps are never dropped');

// Deltas: one per pipeline stage plus the total; clamped at zero.
{
  const frame = stampedFrame(10_000);
  const deltas = latencyDeltas(frame, 10_000 + 84);
  assert.deepEqual(deltas, { inference: 60, mainHop: 5, bridge: 15, analyze: 4, total: 84 });
  const inverted = latencyDeltas(stampedFrame(10_000, { extracted: 60, dispatch: 59 }), 10_084);
  assert.equal(inverted?.mainHop, 0, 'sub-ms clock inversion clamps to 0');
  assert.equal(latencyDeltas({ ...frame, captureTs: undefined }, 10_084), null);
  assert.equal(latencyDeltas({ ...frame, receivedTs: undefined }, 10_084), null);
}

// Percentiles: nearest-rank.
assert.equal(percentile([], 0.5), 0);
assert.equal(percentile([7], 0.95), 7);
assert.equal(percentile([5, 1, 3, 2, 4], 0.5), 3);
assert.equal(percentile([5, 1, 3, 2, 4], 0.95), 5);
assert.equal(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 0.95), 95);

// Reservoir: exact below the cap, bounded above it, summary ints per metric.
{
  const reservoir = new LatencyReservoir();
  for (let i = 1; i <= 100; i++) {
    reservoir.record({ inference: i, mainHop: 1, bridge: 2, analyze: 3, total: i + 6 });
  }
  reservoir.recordStaleDrop();
  reservoir.recordStaleDrop();
  const summary = reservoir.summary();
  assert.equal(summary.frames, 100);
  assert.equal(summary.staleFramesDropped, 2);
  assert.deepEqual(summary.metrics.inference, { p50: 50, p95: 95, max: 100 });
  assert.deepEqual(summary.metrics.total, { p50: 56, p95: 101, max: 106 });
  assert.deepEqual(summary.metrics.bridge, { p50: 2, p95: 2, max: 2 });
  assert.equal(reservoir.p50Total(), 56);
  for (const metric of LATENCY_METRICS) {
    for (const value of Object.values(summary.metrics[metric])) {
      assert.ok(Number.isInteger(value), `${metric} percentiles must be ints`);
    }
  }
}

// Above the cap memory stays bounded and the sample remains representative.
{
  let seed = 42;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const cap = 200;
  const reservoir = new LatencyReservoir(cap, random);
  for (let i = 0; i < 20_000; i++) {
    const v = i % 1_000; // uniform 0..999
    reservoir.record({ inference: v, mainHop: v, bridge: v, analyze: v, total: v });
  }
  const summary = reservoir.summary();
  assert.equal(summary.frames, 20_000);
  assert.ok(Math.abs(summary.metrics.total.p50 - 500) < 120, `p50 ${summary.metrics.total.p50} should be near 500`);
  assert.ok(summary.metrics.total.p95 > 850, `p95 ${summary.metrics.total.p95} should be near 950`);
  assert.ok(summary.metrics.total.max <= 999);
}

// Empty reservoir summarizes to zeros (the analytics event is skipped at 0 frames).
{
  const summary = new LatencyReservoir().summary();
  assert.equal(summary.frames, 0);
  assert.deepEqual(summary.metrics.total, { p50: 0, p95: 0, max: 0 });
}

console.log(
  'Pose latency replay passed: staleness threshold + skew clamp, stage deltas, nearest-rank percentiles, bounded reservoir, int summary',
);
