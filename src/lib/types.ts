export type GoalVibe = 'sweat' | 'streak' | 'zone' | 'compete';
export type FitnessLevel = 'beginner' | 'intermediate' | 'advanced' | 'elite';

export type Session = {
  id: string;
  startedAt: number;
  durationSec: number;
  estimatedCalories: number;
  coins?: number;
};

export type UserProfile = {
  weightKg: number;
  name?: string;
  vibe?: GoalVibe;
  level?: FitnessLevel;
  goalMinutes?: number;
  hasSeenOnboarding?: boolean;
  totalCoins?: number;
};
