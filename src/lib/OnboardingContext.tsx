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

type PersistedShape = {
  answers: OnboardingAnswers;
  completed: boolean;
};

type OnboardingContextValue = {
  /** True once the persisted state has been read from disk. */
  hydrated: boolean;
  /** Whether the user has finished the first-launch flow. */
  completed: boolean;
  answers: OnboardingAnswers;
  setAnswer: <K extends keyof OnboardingAnswers>(key: K, value: OnboardingAnswers[K]) => void;
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
  const stateRef = useRef({ answers, completed });
  stateRef.current = { answers, completed };

  const setAnswer = useCallback<OnboardingContextValue['setAnswer']>(
    (key, value) => {
      setAnswers((prev) => {
        const next = { ...prev, [key]: value } as OnboardingAnswers;
        persist({ answers: next, completed: stateRef.current.completed });
        return next;
      });
    },
    [persist]
  );

  const completeOnboarding = useCallback(() => {
    setCompleted(true);
    persist({ answers: stateRef.current.answers, completed: true });
  }, [persist]);

  const reopenWelcome = useCallback(() => {
    setCompleted(false);
    persist({ answers: stateRef.current.answers, completed: false });
  }, [persist]);

  const resetOnboarding = useCallback(async () => {
    setCompleted(false);
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
      setAnswer,
      completeOnboarding,
      reopenWelcome,
      resetOnboarding,
    }),
    [hydrated, completed, answers, setAnswer, completeOnboarding, reopenWelcome, resetOnboarding]
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
