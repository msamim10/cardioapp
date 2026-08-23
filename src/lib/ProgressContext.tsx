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
import { logRunComplete } from '@/lib/analytics';
import { useAuth } from '@/lib/AuthContext';
import { readCloudProgress, syncCloudProgress } from '@/lib/firestoreSync';
import { useOnboarding } from '@/lib/OnboardingContext';
import {
  aggregateLifetime,
  normalizeActionCounts,
  type ActionCounts,
} from '@/lib/progressAggregation';
import {
  advanceSimulatedCohort,
  buildClassData,
  caloriesForRun,
  campaignClassKeyForCompletion,
  CLASS_ORDER,
  classForMover,
  computeStreaks,
  ensureFullRosters,
  generateCohort,
  isClassKey,
  levelFromXp,
  normalizeSimulatedCohort,
  rewardForRun,
  rollAllRosters,
  startOfWeek,
  type ClassData,
  type ClassKey,
  type CohortMember,
  type LevelProgress,
} from '@/lib/progression';
import {
  mergeRuns,
  newerState,
  normalizeRunRecord,
  type RunRecord,
} from '@/lib/progressSync';

/**
 * Real, persisted running progress — now organized around difficulty CLASSES.
 *
 * Mirrors OnboardingContext/AuthContext: a Provider + `useProgress()` hook, a
 * `hydrated` flag, and AsyncStorage persistence. Everything the UI shows
 * (streak, coins, XP, calories, class rosters, rank) is derived from a few
 * stored things: the completed runs, the per-class map rosters, the mock
 * leaderboard cohorts, and the user's active class.
 */

const STORAGE_KEY = 'cardiosurf.progress.v2';
const DEFAULT_WEEKLY_GOAL = 4;

export type { RunRecord } from '@/lib/progressSync';

/** A run that has started (from the pre-run screen) but not yet been recorded. */
export type ActiveRun = {
  runId: string;
  levelId: string;
  durationMin: number;
  /** Set only when the run was opened from a mode campaign path. */
  classKey?: ClassKey;
  startedAt: number;
};

type ClassRosters = Record<ClassKey, string[]>;
type ClassCohorts = Record<ClassKey, CohortMember[]>;

type PersistedShape = {
  runs: RunRecord[];
  activeClass: ClassKey | null;
  rosters: ClassRosters | null;
  cohorts: ClassCohorts | null;
  activeRun: ActiveRun | null;
  /** Claimed leaderboard handle (from the onboarding username step). */
  username: string | null;
  /** Last local mutation to cloud-restorable state (activeRun is device-local). */
  stateUpdatedAt: number;
};

type ProgressContextValue = {
  hydrated: boolean;
  runs: RunRecord[];
  activeClass: ClassKey;
  activeRun: ActiveRun | null;
  syncStatus: 'local' | 'syncing' | 'synced' | 'error';

  /** Claimed leaderboard handle, or null before it's set in onboarding. */
  username: string | null;
  /** Persist the claimed handle — becomes the user's leaderboard identity. */
  setUsername: (name: string) => void;

  totalRuns: number;
  totalMinutes: number;
  totalCalories: number;
  totalObstacles: number;
  coins: number;
  xp: number;
  levelProgress: LevelProgress;
  streak: number;
  longestStreak: number;

  runsThisWeek: number;
  weeklyGoal: number;

  completedLevelIds: Set<string>;
  isLevelCompleted: (levelId: string) => boolean;
  completionCount: (levelId: string) => number;

  /** Per-class view model (roster, maps, calories, rank, leaderboard). */
  classData: (classKey: ClassKey) => ClassData;
  activeClassData: ClassData;
  /** Next incomplete map id in the active class campaign, or null when finished. */
  nextLevelId: string | null;
  /** Best (lowest) leaderboard rank across all classes. */
  bestRank: number | null;

  setActiveClass: (c: ClassKey) => void;
  /** Advance simulated competitors/entrants in a class and persist the cohort. */
  advanceLiveCompetition: (classKey?: ClassKey) => void;
  /** Mark a run as in-flight before launching the player. */
  startRun: (run: { runId?: string; levelId: string; durationMin: number; classKey?: ClassKey }) => void;
  /**
   * Drop an in-flight run without recording progress. Used when the player
   * backs out / exits early so the active campaign step is not cleared.
   */
  abandonRun: (runId?: string) => void;
  /**
   * Record a verified finished-to-end completion. Requires `finishedToEnd`
   * and a matching active run id. Campaign unlocks only when the active run
   * carried an explicit classKey.
   */
  recordRun: (completion: {
    runId: string;
    elapsedSeconds: number;
    actionCounts: ActionCounts;
    poseScore: number;
    /** Must be true — only play-to-end (or equivalent) may set this. */
    finishedToEnd: boolean;
  }) => RunRecord | null;
  /** Wipe all progress — used by the dev reset in Profile. */
  resetProgress: () => Promise<void>;
};

const ProgressContext = createContext<ProgressContextValue | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const { answers } = useOnboarding();
  const { user } = useAuth();

  const [hydrated, setHydrated] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [activeClass, setActiveClassState] = useState<ClassKey | null>(null);
  const [rosters, setRosters] = useState<ClassRosters | null>(null);
  const [cohorts, setCohorts] = useState<ClassCohorts | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [username, setUsernameState] = useState<string | null>(null);
  const [stateUpdatedAt, setStateUpdatedAt] = useState(0);
  const [syncStatus, setSyncStatus] = useState<ProgressContextValue['syncStatus']>('local');

  const persist = useCallback((next: PersistedShape) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const stateRef = useRef({
    runs,
    activeClass,
    rosters,
    cohorts,
    activeRun,
    username,
    stateUpdatedAt,
  });
  stateRef.current = {
    runs,
    activeClass,
    rosters,
    cohorts,
    activeRun,
    username,
    stateUpdatedAt,
  };

  const snapshot = useCallback(
    (over: Partial<PersistedShape> = {}): PersistedShape => ({
      runs: stateRef.current.runs,
      activeClass: stateRef.current.activeClass,
      rosters: stateRef.current.rosters,
      cohorts: stateRef.current.cohorts,
      activeRun: stateRef.current.activeRun,
      username: stateRef.current.username,
      stateUpdatedAt: stateRef.current.stateUpdatedAt,
      ...over,
    }),
    []
  );

  useEffect(() => {
    let active = true;
    (async () => {
      let loaded: Partial<PersistedShape> = {};
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) loaded = JSON.parse(raw) as Partial<PersistedShape>;
      } catch {
        // Corrupt/missing storage → start fresh but still let the app run.
      }
      if (!active) return;

      const nextRuns = Array.isArray(loaded.runs)
        ? loaded.runs
            .map((run, index) => normalizeRunRecord(run, index))
            .filter((run): run is RunRecord => run !== null)
        : [];
      const runsChanged = JSON.stringify(loaded.runs ?? []) !== JSON.stringify(nextRuns);
      // Roster + cohort are generated once and then persisted so they're stable.
      // Legacy short (4–5 map) rosters are expanded to the full map pool in place.
      const nextRosters = ensureFullRosters(loaded.rosters);
      const rostersChanged =
        !loaded.rosters || JSON.stringify(loaded.rosters) !== JSON.stringify(nextRosters);
      const loadedCohorts = loaded.cohorts;
      const nextCohorts: ClassCohorts = {
        beginner: loadedCohorts?.beginner
          ? normalizeSimulatedCohort('beginner', loadedCohorts.beginner)
          : generateCohort('beginner'),
        intermediate: loadedCohorts?.intermediate
          ? normalizeSimulatedCohort('intermediate', loadedCohorts.intermediate)
          : generateCohort('intermediate'),
        hard: loadedCohorts?.hard
          ? normalizeSimulatedCohort('hard', loadedCohorts.hard)
          : generateCohort('hard'),
      };
      const cohortsChanged =
        !loadedCohorts || JSON.stringify(loadedCohorts) !== JSON.stringify(nextCohorts);

      setRuns(nextRuns);
      setRosters(nextRosters);
      setCohorts(nextCohorts);
      setActiveClassState(loaded.activeClass ?? null);
      const loadedActiveRun = loaded.activeRun;
      const nextActiveRun =
        loadedActiveRun &&
        typeof loadedActiveRun.levelId === 'string' &&
        Number.isFinite(loadedActiveRun.startedAt)
          ? {
              runId:
                typeof loadedActiveRun.runId === 'string' && loadedActiveRun.runId
                  ? loadedActiveRun.runId
                  : `legacy-active:${loadedActiveRun.startedAt}:${loadedActiveRun.levelId}`,
              levelId: loadedActiveRun.levelId,
              durationMin: Number.isFinite(loadedActiveRun.durationMin)
                ? loadedActiveRun.durationMin
                : 0,
              startedAt: loadedActiveRun.startedAt,
              ...(isClassKey(loadedActiveRun.classKey)
                ? { classKey: loadedActiveRun.classKey }
                : {}),
            }
          : null;
      setActiveRun(nextActiveRun);
      setUsernameState(loaded.username ?? null);
      const nextStateUpdatedAt =
        typeof loaded.stateUpdatedAt === 'number' && Number.isFinite(loaded.stateUpdatedAt)
          ? loaded.stateUpdatedAt
          : 0;
      setStateUpdatedAt(nextStateUpdatedAt);
      setHydrated(true);

      if (
        !loaded.rosters ||
        rostersChanged ||
        cohortsChanged ||
        runsChanged ||
        loaded.activeRun !== nextActiveRun
      ) {
        persist({
          runs: nextRuns,
          activeClass: loaded.activeClass ?? null,
          rosters: nextRosters,
          cohorts: nextCohorts,
          activeRun: nextActiveRun,
          username: loaded.username ?? null,
          stateUpdatedAt: nextStateUpdatedAt,
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [persist]);

  const cloudReadyUid = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      cloudReadyUid.current = null;
      setSyncStatus('local');
      return;
    }
    if (cloudReadyUid.current === user.id) return;

    let active = true;
    setSyncStatus('syncing');
    (async () => {
      try {
        const cloud = await readCloudProgress(user.id);
        if (!active) return;
        const current = stateRef.current;
        const mergedRuns = mergeRuns(current.runs, cloud.runs);
        const localState = {
          activeClass: current.activeClass,
          rosters: current.rosters,
          cohorts: current.cohorts,
          username: current.username,
          stateUpdatedAt: current.stateUpdatedAt,
        };
        const cloudState =
          cloud.state &&
          typeof cloud.state.stateUpdatedAt === 'number' &&
          Number.isFinite(cloud.state.stateUpdatedAt)
            ? {
                activeClass: CLASS_ORDER.includes(cloud.state.activeClass as ClassKey)
                  ? (cloud.state.activeClass as ClassKey)
                  : null,
                rosters:
                  cloud.state.rosters && typeof cloud.state.rosters === 'object'
                    ? ensureFullRosters(cloud.state.rosters as ClassRosters)
                    : null,
                cohorts:
                  cloud.state.cohorts && typeof cloud.state.cohorts === 'object'
                    ? (cloud.state.cohorts as ClassCohorts)
                    : null,
                username:
                  typeof cloud.state.username === 'string' ? cloud.state.username : null,
                stateUpdatedAt: cloud.state.stateUpdatedAt,
              }
            : null;
        const selected = newerState(localState, cloudState);

        const selectedRosters = ensureFullRosters(selected.rosters);
        const selectedState = { ...selected, rosters: selectedRosters };
        setRuns(mergedRuns);
        setActiveClassState(selected.activeClass);
        setRosters(selectedRosters);
        setCohorts(selected.cohorts);
        setUsernameState(selected.username);
        setStateUpdatedAt(selected.stateUpdatedAt);
        persist({
          runs: mergedRuns,
          activeClass: selected.activeClass,
          rosters: selectedRosters,
          cohorts: selected.cohorts,
          activeRun: current.activeRun,
          username: selected.username,
          stateUpdatedAt: selected.stateUpdatedAt,
        });
        cloudReadyUid.current = user.id;
        await syncCloudProgress({
          user,
          username: selected.username,
          runs: mergedRuns,
          state: selectedState,
        });
        if (active) setSyncStatus('synced');
      } catch (error) {
        console.warn('[progress] Initial Firestore sync failed:', error);
        if (active) {
          // A later local mutation or app launch retries; local progress remains authoritative.
          cloudReadyUid.current = user.id;
          setSyncStatus('error');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [hydrated, persist, user]);

  useEffect(() => {
    if (!hydrated || !user || cloudReadyUid.current !== user.id) return;
    const timer = setTimeout(async () => {
      const current = stateRef.current;
      setSyncStatus('syncing');
      try {
        await syncCloudProgress({
          user,
          username: current.username,
          runs: current.runs,
          state: {
            activeClass: current.activeClass,
            rosters: current.rosters,
            cohorts: current.cohorts,
            username: current.username,
            stateUpdatedAt: current.stateUpdatedAt,
          },
        });
        setSyncStatus('synced');
      } catch (error) {
        console.warn('[progress] Firestore sync failed:', error);
        setSyncStatus('error');
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [
    activeClass,
    cohorts,
    hydrated,
    rosters,
    runs,
    stateUpdatedAt,
    username,
    user,
  ]);

  // Seed the active class from onboarding once hydrated, if never chosen.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!hydrated || seededRef.current) return;
    seededRef.current = true;
    if (stateRef.current.activeClass === null) {
      const seeded = classForMover(answers.mover);
      const updatedAt = Date.now();
      setActiveClassState(seeded);
      setStateUpdatedAt(updatedAt);
      persist(snapshot({ activeClass: seeded, stateUpdatedAt: updatedAt }));
    }
  }, [hydrated, answers.mover, persist, snapshot]);

  const effectiveClass: ClassKey = activeClass ?? 'beginner';

  const setActiveClass = useCallback<ProgressContextValue['setActiveClass']>(
    (c) => {
      const updatedAt = Date.now();
      setActiveClassState(c);
      setStateUpdatedAt(updatedAt);
      persist(snapshot({ activeClass: c, stateUpdatedAt: updatedAt }));
    },
    [persist, snapshot]
  );

  const advanceLiveCompetition = useCallback<ProgressContextValue['advanceLiveCompetition']>(
    (classKey) => {
      const currentCohorts = stateRef.current.cohorts;
      if (!currentCohorts) return;

      const key = classKey ?? stateRef.current.activeClass ?? 'beginner';
      const userCalories = stateRef.current.runs
        .filter((run) => run.classKey === key)
        .reduce((sum, run) => sum + run.calories, 0);
      const nextCohorts: ClassCohorts = {
        ...currentCohorts,
        [key]: advanceSimulatedCohort(key, currentCohorts[key], userCalories),
      };
      const updatedAt = Date.now();
      setCohorts(nextCohorts);
      setStateUpdatedAt(updatedAt);
      persist(snapshot({ cohorts: nextCohorts, stateUpdatedAt: updatedAt }));
    },
    [persist, snapshot]
  );

  const startRun = useCallback<ProgressContextValue['startRun']>(
    ({ runId, levelId, durationMin, classKey }) => {
      // Only an explicit campaign classKey is stored. Do not fall back to
      // activeClass — that would attribute Recommended / Featured / Popular
      // plays as mode-path unlocks.
      const campaignClass = isClassKey(classKey) ? classKey : undefined;
      const next: ActiveRun = {
        runId:
          runId ??
          `${levelId}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`,
        levelId,
        durationMin,
        ...(campaignClass ? { classKey: campaignClass } : {}),
        startedAt: Date.now(),
      };
      setActiveRun(next);
      persist(snapshot({ activeRun: next }));
    },
    [persist, snapshot]
  );

  const abandonRun = useCallback<ProgressContextValue['abandonRun']>(
    (runId) => {
      const pending = stateRef.current.activeRun;
      if (!pending) return;
      if (runId && pending.runId !== runId) return;
      stateRef.current = { ...stateRef.current, activeRun: null };
      setActiveRun(null);
      persist(snapshot({ activeRun: null }));
    },
    [persist, snapshot]
  );

  const recordRun = useCallback<ProgressContextValue['recordRun']>(
    (completion) => {
      const pending = stateRef.current.activeRun;
      if (!pending || completion.runId !== pending.runId) {
        return null;
      }

      // Early exit / incomplete summary: clear the in-flight run and never
      // persist a campaign completion (or any run record).
      if (!completion.finishedToEnd) {
        stateRef.current = { ...stateRef.current, activeRun: null };
        setActiveRun(null);
        persist(snapshot({ activeRun: null }));
        return null;
      }

      if (!Number.isFinite(completion.elapsedSeconds) || completion.elapsedSeconds <= 0) {
        return null;
      }

      const durationMin = completion.elapsedSeconds / 60;
      // Campaign unlock attribution: finished-to-end + explicit classKey only.
      const campaignClass = campaignClassKeyForCompletion(pending.classKey, true);
      // Rewards still need a difficulty band; casual runs use activeClass for
      // XP/coins/calories math only and omit classKey from the persisted record.
      const rewardClass = campaignClass ?? stateRef.current.activeClass ?? 'beginner';
      const { coins, xp } = rewardForRun(durationMin, rewardClass);
      const calories = caloriesForRun(durationMin, rewardClass);
      const record: RunRecord = {
        runId: pending.runId,
        levelId: pending.levelId,
        durationMin,
        at: Date.now(),
        coins,
        xp,
        calories,
        ...(campaignClass ? { classKey: campaignClass } : {}),
        actionCounts: normalizeActionCounts(completion.actionCounts),
        poseScore:
          Number.isFinite(completion.poseScore) && completion.poseScore > 0
            ? completion.poseScore
            : 0,
      };

      const nextRuns = [...stateRef.current.runs, record];
      const updatedAt = Date.now();
      // Close the completion gate synchronously so duplicate native events or
      // a rapid summary remount cannot append the same active run twice.
      stateRef.current = {
        ...stateRef.current,
        runs: nextRuns,
        activeRun: null,
        stateUpdatedAt: updatedAt,
      };
      setRuns(nextRuns);
      setActiveRun(null);
      setStateUpdatedAt(updatedAt);
      persist(snapshot({ runs: nextRuns, activeRun: null, stateUpdatedAt: updatedAt }));
      // Fire the run_complete / first_run_complete analytics from the single
      // authoritative completion gate (attributes: duration + score).
      logRunComplete({ durationMin: record.durationMin, score: record.poseScore });
      return record;
    },
    [persist, snapshot]
  );

  const setUsername = useCallback<ProgressContextValue['setUsername']>(
    (name) => {
      const updatedAt = Date.now();
      setUsernameState(name);
      setStateUpdatedAt(updatedAt);
      persist(snapshot({ username: name, stateUpdatedAt: updatedAt }));
    },
    [persist, snapshot]
  );

  const resetProgress = useCallback(async () => {
    const freshRosters = rollAllRosters();
    const freshCohorts: ClassCohorts = {
      beginner: generateCohort('beginner'),
      intermediate: generateCohort('intermediate'),
      hard: generateCohort('hard'),
    };
    setRuns([]);
    setActiveRun(null);
    setActiveClassState(null);
    setRosters(freshRosters);
    setCohorts(freshCohorts);
    setUsernameState(null);
    setStateUpdatedAt(0);
    setSyncStatus('local');
    seededRef.current = false;
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  // The claimed handle is the user's leaderboard identity; fall back to their
  // account name (or "You") before a handle has been claimed.
  const leaderboardName = useMemo(
    () => username || user?.name?.split(' ')[0] || 'You',
    [username, user?.name]
  );

  const derived = useMemo(() => {
    const lifetime = aggregateLifetime(runs);
    const totalRuns = lifetime.runs;
    const totalMinutes = lifetime.minutes;
    const totalCalories = lifetime.calories;
    const coins = runs.reduce((sum, r) => sum + r.coins, 0);
    const xp = runs.reduce((sum, r) => sum + r.xp, 0);
    const levelProgress = levelFromXp(xp);
    const { current, longest } = computeStreaks(runs.map((r) => r.at));

    const weekStart = startOfWeek();
    const runsThisWeek = runs.filter((r) => r.at >= weekStart).length;

    const completedLevelIds = new Set(runs.map((r) => r.levelId));

    const safeRosters: ClassRosters = rosters ?? { beginner: [], intermediate: [], hard: [] };
    const safeCohorts: ClassCohorts = cohorts ?? { beginner: [], intermediate: [], hard: [] };

    const classDataMap = {} as Record<ClassKey, ClassData>;
    for (const key of CLASS_ORDER) {
      classDataMap[key] = buildClassData(
        key,
        safeRosters[key],
        safeCohorts[key],
        runs,
        leaderboardName
      );
    }

    const ranked = CLASS_ORDER.map((k) => classDataMap[k]).filter((c) => c.runs > 0);
    const bestRank = ranked.length ? Math.min(...ranked.map((c) => c.rank)) : null;

    return {
      totalRuns,
      totalMinutes,
      totalCalories,
      totalObstacles: lifetime.obstacles,
      coins,
      xp,
      levelProgress,
      streak: current,
      longestStreak: longest,
      runsThisWeek,
      completedLevelIds,
      classDataMap,
      bestRank,
    };
  }, [runs, rosters, cohorts, leaderboardName]);

  const weeklyGoal = answers.daysPerWeek ?? DEFAULT_WEEKLY_GOAL;

  const isLevelCompleted = useCallback(
    (levelId: string) => derived.completedLevelIds.has(levelId),
    [derived.completedLevelIds]
  );
  const completionCount = useCallback(
    (levelId: string) => runs.reduce((n, r) => (r.levelId === levelId ? n + 1 : n), 0),
    [runs]
  );

  const classData = useCallback(
    (classKey: ClassKey) => derived.classDataMap[classKey],
    [derived.classDataMap]
  );
  const activeClassData = derived.classDataMap[effectiveClass];
  const nextLevelId = activeClassData.nextLevelId;

  const value = useMemo<ProgressContextValue>(
    () => ({
      hydrated,
      runs,
      activeClass: effectiveClass,
      activeRun,
      syncStatus,
      username,
      setUsername,
      totalRuns: derived.totalRuns,
      totalMinutes: derived.totalMinutes,
      totalCalories: derived.totalCalories,
      totalObstacles: derived.totalObstacles,
      coins: derived.coins,
      xp: derived.xp,
      levelProgress: derived.levelProgress,
      streak: derived.streak,
      longestStreak: derived.longestStreak,
      runsThisWeek: derived.runsThisWeek,
      weeklyGoal,
      completedLevelIds: derived.completedLevelIds,
      isLevelCompleted,
      completionCount,
      classData,
      activeClassData,
      nextLevelId,
      bestRank: derived.bestRank,
      setActiveClass,
      advanceLiveCompetition,
      startRun,
      abandonRun,
      recordRun,
      resetProgress,
    }),
    [
      hydrated,
      runs,
      effectiveClass,
      activeRun,
      syncStatus,
      username,
      setUsername,
      derived,
      weeklyGoal,
      isLevelCompleted,
      completionCount,
      classData,
      activeClassData,
      nextLevelId,
      setActiveClass,
      advanceLiveCompetition,
      startRun,
      abandonRun,
      recordRun,
      resetProgress,
    ]
  );

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress() {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error('useProgress must be used within a ProgressProvider');
  return ctx;
}
