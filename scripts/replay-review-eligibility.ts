import assert from 'node:assert/strict';
// @ts-expect-error -- Node type-stripping requires the source extension.
import { isStoreReviewEligible } from '../src/lib/reviewEligibility.ts';

assert.equal(
  isStoreReviewEligible({
    completedRunCount: 2,
    alreadyRequested: false,
    supported: true,
  }),
  false,
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
    completedRunCount: 3,
    alreadyRequested: true,
    supported: true,
  }),
  false,
);

assert.equal(
  isStoreReviewEligible({
    completedRunCount: 3,
    alreadyRequested: false,
    supported: false,
  }),
  false,
);

console.log('Review eligibility replay passed: milestone, persistence, and support');
