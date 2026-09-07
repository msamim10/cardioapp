export type AuthGateDestination =
  | 'loading'
  | 'welcome'
  | 'create-account'
  | 'resume'
  | 'tabs';

/**
 * Where the root navigator should send the user given the persisted state.
 *
 * `resume` is the post-account onboarding path: the account exists but the
 * first-run ceremony (plan → recap → calibration → offer → run) has not been
 * finished, and a checkpoint says how far it got. The caller routes to that
 * checkpoint instead of the welcome screen, so an app kill mid-way never
 * strands a signed-in user at the top of the questionnaire.
 */
export function decideAuthGate(input: {
  hydrated: boolean;
  onboardingCompleted: boolean;
  authenticated: boolean;
  checkpoint?: string | null;
}): AuthGateDestination {
  if (!input.hydrated) return 'loading';
  if (input.authenticated && input.onboardingCompleted) return 'tabs';
  if (input.onboardingCompleted) return 'create-account';
  if (input.authenticated && input.checkpoint) return 'resume';
  return 'welcome';
}
