import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  defaultAnswers,
  type OnboardingAnswers,
} from '@/lib/onboarding';

/**
 * Lightweight local onboarding state.
 *
 * Answers + the "completed" flag are persisted to AsyncStorage
 * (@react-native-async-storage/async-storage is already a project dependency)
 * so a returning user skips straight into the app. No backend involved.
 */

const STORAGE_KEY = 'cardiosurf.onboarding.v1';

/**
 * Post-account onboarding screens the flow can resume at after an app kill.
 * Only steps AFTER account creation are checkpointed: before that the answers
 * alone are enough to re-walk the short questionnaire, and after it the user
 * has a real account that must not be stranded on the welcome screen.
 */
export type OnboardingCheckpoint = 'plan' | 'make-it-real' | 'first-run-ready';

export const ONBOARDING_CHECKPOINTS: readonly OnboardingCheckpoint[] = [
  'plan',
  'make-it-real',
  'first-run-ready',
];

export function isOnboardingCheckpoint(value: unknown): value is OnboardingCheckpoint {
  return (
    typeof value === 'string' &&
    (ONBOARDING_CHECKPOINTS as readonly string[]).includes(value)
  );
}

type PersistedShape = {
  answers: OnboardingAnswers;
  completed: boolean;
  checkpoint: OnboardingCheckpoint | null;
};

type OnboardingContextValue = {
  /** True once the persisted state has been read from disk. */
  hydrated: boolean;
  /** Whether the user has finished the first-launch flow. */
  completed: boolean;
  answers: OnboardingAnswers;
  /** Furthest post-account step reached, or null. Cleared on completion. */
  checkpoint: OnboardingCheckpoint | null;
  setAnswer: <K extends keyof OnboardingAnswers>(key: K, value: OnboardingAnswers[K]) => void;
  /** Persist the furthest post-account step so a killed app resumes there. */
  setCheckpoint: (checkpoint: OnboardingCheckpoint | null) => void;
  /** Marks onboarding done and persists. */
  completeOnboarding: () => void;
  /** Return to Welcome after logout while preserving answers and progress. */
  reopenWelcome: () => void;
  /** Clears everything — used by the dev reset in Profile. */
  resetOnboarding: () => Promise<void>;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [answers, setAnswers] = useState<OnboardingAnswers>(defaultAnswers);
  const [checkpoint, setCheckpointState] = useState<OnboardingCheckpoint | null>(null);

  // Hydrate persisted state once on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (active && raw) {
          const parsed = JSON.parse(raw) as Partial<PersistedShape>;
          if (parsed.answers) setAnswers({ ...defaultAnswers, ...parsed.answers });
          if (parsed.completed) setCompleted(true);
          if (!parsed.completed && isOnboardingCheckpoint(parsed.checkpoint)) {
            setCheckpointState(parsed.checkpoint);
          }
        }
      } catch {
        // Corrupt/missing storage → fall back to defaults, still let the app run.
      } finally {
        if (active) setHydrated(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Persist whenever answers or completion change (after hydration).
  const persist = useCallback((next: PersistedShape) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  // Keep latest values in a ref so persistence helpers always see fresh state.
  const stateRef = useRef({ answers, completed, checkpoint });
  stateRef.current = { answers, completed, checkpoint };

  const setAnswer = useCallback<OnboardingContextValue['setAnswer']>(
    (key, value) => {
      setAnswers((prev) => {
        const next = { ...prev, [key]: value } as OnboardingAnswers;
        persist({
          answers: next,
          completed: stateRef.current.completed,
          checkpoint: stateRef.current.checkpoint,
        });
        return next;
      });
    },
    [persist]
  );

  const setCheckpoint = useCallback<OnboardingContextValue['setCheckpoint']>(
    (next) => {
      if (stateRef.current.checkpoint === next) return;
      stateRef.current = { ...stateRef.current, checkpoint: next };
      setCheckpointState(next);
      persist({
        answers: stateRef.current.answers,
        completed: stateRef.current.completed,
        checkpoint: next,
      });
    },
    [persist]
  );

  const completeOnboarding = useCallback(() => {
    stateRef.current = { ...stateRef.current, completed: true, checkpoint: null };
    setCompleted(true);
    setCheckpointState(null);
    persist({ answers: stateRef.current.answers, completed: true, checkpoint: null });
  }, [persist]);

  const reopenWelcome = useCallback(() => {
    stateRef.current = { ...stateRef.current, completed: false, checkpoint: null };
    setCompleted(false);
    setCheckpointState(null);
    persist({ answers: stateRef.current.answers, completed: false, checkpoint: null });
  }, [persist]);

  const resetOnboarding = useCallback(async () => {
    setCompleted(false);
    setCheckpointState(null);
    setAnswers(defaultAnswers);
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      hydrated,
      completed,
      answers,
      checkpoint,
      setAnswer,
      setCheckpoint,
      completeOnboarding,
      reopenWelcome,
      resetOnboarding,
    }),
    [
      hydrated,
      completed,
      answers,
      checkpoint,
      setAnswer,
      setCheckpoint,
      completeOnboarding,
      reopenWelcome,
      resetOnboarding,
    ]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return ctx;
}
