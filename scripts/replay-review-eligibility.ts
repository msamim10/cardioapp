import assert from 'node:assert/strict';
// @ts-expect-error -- Node type-stripping requires the source extension.
import { isStoreReviewEligible, REVIEW_RUN_MILESTONE } from '../src/lib/reviewEligibility.ts';

// The prompt fires on the second completed run. The onboarding first run is
// recorded like any other, so the first normal run after onboarding qualifies.
assert.equal(REVIEW_RUN_MILESTONE, 2);

assert.equal(
  isStoreReviewEligible({
    completedRunCount: 1,
    alreadyRequested: false,
    supported: true,
  }),
  false,
);

assert.equal(
  isStoreReviewEligible({
    completedRunCount: 2,
    alreadyRequested: false,
    supported: true,
  }),
  true,
);

assert.equal(
  isStoreReviewEligible({
    completedRunCount: 3,
    alreadyRequested: false,
    supported: true,
  }),
  true,
);

assert.equal(
  isStoreReviewEligible({
    completedRunCount: 2,
    alreadyRequested: true,
    supported: true,
  }),
  false,
);

assert.equal(
  isStoreReviewEligible({
    completedRunCount: 2,
    alreadyRequested: false,
    supported: false,
  }),
  false,
);

console.log('Review eligibility replay passed: milestone, persistence, and support');
