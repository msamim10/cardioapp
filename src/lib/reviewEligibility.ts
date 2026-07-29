export const REVIEW_REQUESTED_STORAGE_KEY = 'cardiosurf.storeReview.requested.v1';
export const REVIEW_RUN_MILESTONE = 3;

export type ReviewEligibility = {
  completedRunCount: number;
  alreadyRequested: boolean;
  supported: boolean;
};

export function isStoreReviewEligible({
  completedRunCount,
  alreadyRequested,
  supported,
}: ReviewEligibility): boolean {
  return (
    Number.isFinite(completedRunCount) &&
    completedRunCount >= REVIEW_RUN_MILESTONE &&
    !alreadyRequested &&
    supported
  );
}
