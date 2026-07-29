export type AuthGateDestination = 'loading' | 'welcome' | 'create-account' | 'tabs';

export function decideAuthGate(input: {
  hydrated: boolean;
  onboardingCompleted: boolean;
  authenticated: boolean;
}): AuthGateDestination {
  if (!input.hydrated) return 'loading';
  if (input.authenticated && input.onboardingCompleted) return 'tabs';
  if (input.onboardingCompleted) return 'create-account';
  return 'welcome';
}
