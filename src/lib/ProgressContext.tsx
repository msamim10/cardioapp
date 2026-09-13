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
import { hasBeatmap } from '@/lib/beatmapRegistry';
import { getDailyChallenge, isDailyChallengeCompleted } from '@/lib/dailyRecommendations';
import { readCloudProgress, syncCloudProgress } from '@/lib/firestoreSync';
import { modes } from '@/lib/gameData';
import { isHudThemeId } from '@/lib/hudThemes';
import { clampLevel, legacyLevelFor, levelBadges, MIN_LEVEL, progressWithinLevel } from '@/lib/levels';
import { useOnboarding } from '@/lib/OnboardingContext';
import { ensureUsernameReserved, writePublicProfile } from '@/lib/profileSync';
import {
  aggregateLifetime,
  normalizeActionCounts,
  type ActionCounts,
} from '@/lib/progressAggregation';
import {
  buildClassData,
  caloriesForRun,
  campaignClassKeyForCompletion,
  CLASS_ORDER,
  classForMover,
  computeStreaksWithFreeze,
  ensureFullRosters,
  isClassKey,
  rewardForRunPerformance,
  rollAllRosters,
  startOfWeek,
  type ClassData,
  type ClassKey,
  type LevelProgress,
  type StreakInfo,
} from '@/lib/progression';
import { INTENSITY_META, isIntensityKey, type IntensityKey } from '@/lib/playSetup';
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
 * (streak, coins, XP, calories, class rosters) is derived from a few stored
 * things: the completed runs, the per-class map rosters, and the user's
 * active class. Leaderboards are server-side (`leaderboards.ts`); the legacy
 * `cohorts` field of older stores/cloud docs is read and ignored, never
 * written.
 */

const STORAGE_KEY = 'cardiosurf.progress.v2';
const DEFAULT_WEEKLY_GOAL = 4;

/** Non-negative integer from an optional completion count. */
const wholeCount = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export type { RunRecord } from '@/lib/progressSync';

/** A run that has started (from the pre-run screen) but not yet been recorded. */
export type ActiveRun = {
  runId: string;
  levelId: string;
  durationMin: number;
  /** Set only when the run was opened from a mode campaign path. */
  classKey?: ClassKey;
  /** Per-run intensity chosen on the level screen; scales the calorie estimate. */
  intensity?: IntensityKey;
  startedAt: number;
};

type ClassRosters = Record<ClassKey, string[]>;

export type RunCompletion = {
  runId: string;
  elapsedSeconds: number;
  actionCounts: ActionCounts;
  poseScore: number;
  /** Must be true — only play-to-end (or equivalent) may set this. */
  finishedToEnd: boolean;
  /** Cue-scoring performance; omitted/zero for free-scoring runs. */
  hasBeatmap?: boolean;
  perfectCount?: number;
  goodCount?: number;
  missCount?: number;
  maxCombo?: number;
  /** (perfect + 0.5·good) / cues judged, 0–1. */
  accuracy?: number;
  /** Pose pipeline latency for the run, forwarded to analytics only. */
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  staleFramesDropped?: number;
};

type PersistedShape = {
  runs: RunRecord[];
  activeClass: ClassKey | null;
  rosters: ClassRosters | null;
  /** Legacy simulated-leaderboard cohorts: tolerated on read, never written. */
  cohorts?: unknown;
  activeRun: ActiveRun | null;
  /** Claimed leaderboard handle (from the onboarding username step). */
  username: string | null;
  /** Chosen HUD palette id (`hudThemes.ts`); null = default. Unlock is re-derived from level. */
  hudTheme: string | null;
  /**
   * Level shown by the old flat 500-XP curve at the moment this install first
   * ran the 1–50 curve. Displayed level = max(curve level, floor) so the switch
   * never visibly demotes anyone. Computed once, then only ever raised.
   */
  legacyLevelFloor: number;
  /** Last local mutation to cloud-restorable state (activeRun is device-local). */
  stateUpdatedAt: number;
};

/** Total persisted XP — the single input to the level curve. */
const totalXp = (runs: readonly RunRecord[]): number => runs.reduce((sum, r) => sum + r.xp, 0);

/** Legacy floor from storage/cloud, or null when that writer predates the curve. */
const readLegacyFloor = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? clampLevel(value) : null;

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
  /** Effective level (1–50, legacy floor applied) with in-level progress. */
  levelProgress: LevelProgress;
  legacyLevelFloor: number;
  /** Chosen HUD palette id (may be locked on this device — resolve via `resolveHudTheme`). */
  hudThemeId: string | null;
  setHudTheme: (id: string | null) => void;
  streak: number;
  longestStreak: number;
  /** Freeze-aware streak detail (ran today, freeze used/available this week). */
  streakInfo: StreakInfo;

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

  setActiveClass: (c: ClassKey) => void;
  /** Mark a run as in-flight before launching the player. */
  startRun: (run: {
    runId?: string;
    levelId: string;
    durationMin: number;
    classKey?: ClassKey;
    intensity?: IntensityKey;
  }) => void;
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
  recordRun: (completion: RunCompletion) => RunRecord | null;
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
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [username, setUsernameState] = useState<string | null>(null);
  const [hudTheme, setHudThemeState] = useState<string | null>(null);
  const [legacyLevelFloor, setLegacyLevelFloor] = useState<number>(MIN_LEVEL);
  const [stateUpdatedAt, setStateUpdatedAt] = useState(0);
  const [syncStatus, setSyncStatus] = useState<ProgressContextValue['syncStatus']>('local');

  const persist = useCallback((next: PersistedShape) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const stateRef = useRef({
    runs,
    activeClass,
    rosters,
    activeRun,
    username,
    hudTheme,
    legacyLevelFloor,
    stateUpdatedAt,
  });
  stateRef.current = {
    runs,
    activeClass,
    rosters,
    activeRun,
    username,
    hudTheme,
    legacyLevelFloor,
    stateUpdatedAt,
  };

  // Read through a ref so the cloud-sync effects need not re-run on every
  // questionnaire change; the attribution answer predates account creation, so
  // it is already in place when the first sync fires after login.
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const snapshot = useCallback(
    (over: Partial<PersistedShape> = {}): PersistedShape => ({
      runs: stateRef.current.runs,
      activeClass: stateRef.current.activeClass,
      rosters: stateRef.current.rosters,
      activeRun: stateRef.current.activeRun,
      username: stateRef.current.username,
      hudTheme: stateRef.current.hudTheme,
      legacyLevelFloor: stateRef.current.legacyLevelFloor,
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
      // Rosters are generated once and then persisted so they're stable.
      // Legacy short (4–5 map) rosters are expanded to the full map pool in place.
      const nextRosters = ensureFullRosters(loaded.rosters);
      const rostersChanged =
        !loaded.rosters || JSON.stringify(loaded.rosters) !== JSON.stringify(nextRosters);
      // Stores written by the simulated-leaderboard era carry `cohorts`; drop
      // the field on the next persist (nothing reads it any more).
      const hadLegacyCohorts = loaded.cohorts !== undefined;

      setRuns(nextRuns);
      setRosters(nextRosters);
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
              ...(isIntensityKey(loadedActiveRun.intensity)
                ? { intensity: loadedActiveRun.intensity }
                : {}),
            }
          : null;
      setActiveRun(nextActiveRun);
      setUsernameState(loaded.username ?? null);
      const nextHudTheme = isHudThemeId(loaded.hudTheme) ? loaded.hudTheme : null;
      setHudThemeState(nextHudTheme);
      // Grandfather the level curve switch exactly once: storage written before
      // the curve has no floor, so freeze the OLD formula's level for this XP.
      // A fresh install has no runs → floor 1 (no effect).
      const storedFloor = readLegacyFloor(loaded.legacyLevelFloor);
      const nextFloor = storedFloor ?? legacyLevelFor(totalXp(nextRuns));
      setLegacyLevelFloor(nextFloor);
      const nextStateUpdatedAt =
        typeof loaded.stateUpdatedAt === 'number' && Number.isFinite(loaded.stateUpdatedAt)
          ? loaded.stateUpdatedAt
          : 0;
      setStateUpdatedAt(nextStateUpdatedAt);
      setHydrated(true);

      if (
        !loaded.rosters ||
        rostersChanged ||
        hadLegacyCohorts ||
        runsChanged ||
        storedFloor === null ||
        loaded.hudTheme !== nextHudTheme ||
        loaded.activeRun !== nextActiveRun
      ) {
        persist({
          runs: nextRuns,
          activeClass: loaded.activeClass ?? null,
          rosters: nextRosters,
          activeRun: nextActiveRun,
          username: loaded.username ?? null,
          hudTheme: nextHudTheme,
          legacyLevelFloor: nextFloor,
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
          username: current.username,
          hudTheme: current.hudTheme,
          legacyLevelFloor: current.legacyLevelFloor,
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
                username:
                  typeof cloud.state.username === 'string' ? cloud.state.username : null,
                hudTheme: isHudThemeId(cloud.state.hudTheme) ? cloud.state.hudTheme : null,
                // Cloud state written before the curve carries no floor: those
                // runs were earned under the flat formula, so grandfather them
                // from the merged XP. Curve-era cloud state carries its floor.
                legacyLevelFloor:
                  readLegacyFloor(cloud.state.legacyLevelFloor) ?? legacyLevelFor(totalXp(mergedRuns)),
                stateUpdatedAt: cloud.state.stateUpdatedAt,
              }
            : null;
        const selected = newerState(localState, cloudState);

        const selectedRosters = ensureFullRosters(selected.rosters);
        // The floor only ever rises: take the higher of both devices' floors.
        const selectedFloor = Math.max(
          localState.legacyLevelFloor,
          cloudState?.legacyLevelFloor ?? MIN_LEVEL
        );
        const selectedState = { ...selected, rosters: selectedRosters, legacyLevelFloor: selectedFloor };
        setRuns(mergedRuns);
        setActiveClassState(selected.activeClass);
        setRosters(selectedRosters);
        setUsernameState(selected.username);
        setHudThemeState(selected.hudTheme);
        setLegacyLevelFloor(selectedFloor);
        setStateUpdatedAt(selected.stateUpdatedAt);
        persist({
          runs: mergedRuns,
          activeClass: selected.activeClass,
          rosters: selectedRosters,
          activeRun: current.activeRun,
          username: selected.username,
          hudTheme: selected.hudTheme,
          legacyLevelFloor: selectedFloor,
          stateUpdatedAt: selected.stateUpdatedAt,
        });
        cloudReadyUid.current = user.id;
        await syncCloudProgress({
          user,
          username: selected.username,
          runs: mergedRuns,
          state: selectedState,
          acquisitionSource: answersRef.current.attribution,
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
            username: current.username,
            hudTheme: current.hudTheme,
            legacyLevelFloor: current.legacyLevelFloor,
            stateUpdatedAt: current.stateUpdatedAt,
          },
          acquisitionSource: answersRef.current.attribution,
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
    hudTheme,
    hydrated,
    legacyLevelFloor,
    rosters,
    runs,
    stateUpdatedAt,
    username,
    user,
  ]);

  // Public profile (`profiles/{uid}`): the leaderboard-facing fields, written
  // whenever they change. Username is reserved through the Function instead.
  const publicLevel = progressWithinLevel(totalXp(runs), legacyLevelFloor).level;
  const publicBadges = levelBadges(publicLevel)
    .filter((b) => b.unlocked)
    .map((b) => b.badge.id)
    .join(',');
  useEffect(() => {
    if (!hydrated || !user || cloudReadyUid.current !== user.id) return;
    const timer = setTimeout(() => {
      writePublicProfile({
        uid: user.id,
        photoURL: user.photo,
        level: publicLevel,
        badges: publicBadges ? publicBadges.split(',') : [],
        hudTheme,
      }).catch((error) => console.warn('[progress] Public profile sync failed:', error));
    }, 1200);
    return () => clearTimeout(timer);
    // syncStatus re-runs this once the initial cloud sync has finished.
  }, [hudTheme, hydrated, publicBadges, publicLevel, syncStatus, user]);

  // Lazy username reservation: onboarding chose the handle offline; claim it
  // server-side once signed in. A taken handle comes back suffixed and the
  // local handle follows it so the leaderboard identity is the reserved one.
  const reservingRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated || !user || !username || cloudReadyUid.current !== user.id) return;
    const key = `${user.id}:${username}`;
    if (reservingRef.current === key) return;
    reservingRef.current = key;
    ensureUsernameReserved(user.id, username).then((reserved) => {
      // Ignore late results if the user or handle changed meanwhile.
      if (reservingRef.current !== key || !reserved || reserved === stateRef.current.username) return;
      const updatedAt = Date.now();
      setUsernameState(reserved);
      setStateUpdatedAt(updatedAt);
      persist(snapshot({ username: reserved, stateUpdatedAt: updatedAt }));
    });
  }, [hydrated, persist, snapshot, syncStatus, user, username]);

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

  const startRun = useCallback<ProgressContextValue['startRun']>(
    ({ runId, levelId, durationMin, classKey, intensity }) => {
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
        ...(isIntensityKey(intensity) ? { intensity } : {}),
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
      // XP/coins = class-driven base (duration × class multiplier) scaled by
      // performance: accuracy against the beatmap (or move activity without
      // one) and max combo. Intensity still scales only the burn estimate, so
      // a playback-rate toggle cannot inflate the leaderboard economy — but
      // standing still now earns the 30% floor rather than the full base.
      const actionCounts = normalizeActionCounts(completion.actionCounts);
      const totalMoves = Object.values(actionCounts).reduce((sum, n) => sum + n, 0);
      const cuedRun = completion.hasBeatmap === true;
      const perfectCount = wholeCount(completion.perfectCount);
      const goodCount = wholeCount(completion.goodCount);
      const missCount = wholeCount(completion.missCount);
      const maxCombo = wholeCount(completion.maxCombo);
      const accuracy = cuedRun
        ? Math.min(1, Math.max(0, Number.isFinite(completion.accuracy) ? completion.accuracy! : 0))
        : 0;
      // Daily challenge: +25% XP on the run that first completes today's
      // designated level (casual or campaign). Later same-day runs on it, and
      // every other level, pay the plain performance-scaled reward.
      const completedAt = Date.now();
      const challenge = getDailyChallenge(modes, new Date(completedAt), hasBeatmap);
      const isDailyChallengeRun =
        challenge !== null &&
        challenge.mode.id === pending.levelId &&
        !isDailyChallengeCompleted(stateRef.current.runs, challenge);
      const reward = rewardForRunPerformance({
        durationMin,
        classKey: rewardClass,
        accuracy,
        maxCombo,
        hasBeatmap: cuedRun,
        movesPerMin: durationMin > 0 ? totalMoves / durationMin : 0,
        dailyChallenge: isDailyChallengeRun,
      });
      const { coins, xp } = reward.total;
      const effort = pending.intensity ? INTENSITY_META[pending.intensity].effort : 1;
      const calories = caloriesForRun(durationMin, rewardClass, effort);
      const record: RunRecord = {
        runId: pending.runId,
        levelId: pending.levelId,
        durationMin,
        at: completedAt,
        coins,
        xp,
        calories,
        ...(campaignClass ? { classKey: campaignClass } : {}),
        actionCounts,
        poseScore:
          Number.isFinite(completion.poseScore) && completion.poseScore > 0
            ? completion.poseScore
            : 0,
        perfectCount,
        goodCount,
        missCount,
        maxCombo,
        accuracy,
        rewardBreakdown: {
          base: reward.base,
          accuracyFactor: reward.accuracyFactor,
          comboFactor: reward.comboFactor,
          xpBonusFactor: reward.xpBonusFactor,
        },
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
      // authoritative completion gate (duration, score, performance, rewards,
      // and the run's pose latency when the native build stamped frames).
      logRunComplete({
        durationMin: record.durationMin,
        score: record.poseScore,
        accuracy: record.accuracy,
        maxCombo: record.maxCombo,
        perfect: record.perfectCount,
        good: record.goodCount,
        miss: record.missCount,
        hasBeatmap: cuedRun,
        coins: record.coins,
        xp: record.xp,
        latencyP50Ms: completion.latencyP50Ms,
        latencyP95Ms: completion.latencyP95Ms,
        staleFramesDropped: completion.staleFramesDropped,
      });
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

  const setHudTheme = useCallback<ProgressContextValue['setHudTheme']>(
    (id) => {
      const next = isHudThemeId(id) ? id : null;
      const updatedAt = Date.now();
      setHudThemeState(next);
      setStateUpdatedAt(updatedAt);
      persist(snapshot({ hudTheme: next, stateUpdatedAt: updatedAt }));
    },
    [persist, snapshot]
  );

  const resetProgress = useCallback(async () => {
    const freshRosters = rollAllRosters();
    setRuns([]);
    setActiveRun(null);
    setActiveClassState(null);
    setRosters(freshRosters);
    setUsernameState(null);
    setHudThemeState(null);
    setLegacyLevelFloor(MIN_LEVEL);
    setStateUpdatedAt(0);
    setSyncStatus('local');
    seededRef.current = false;
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const derived = useMemo(() => {
    const lifetime = aggregateLifetime(runs);
    const totalRuns = lifetime.runs;
    const totalMinutes = lifetime.minutes;
    const totalCalories = lifetime.calories;
    const coins = runs.reduce((sum, r) => sum + r.coins, 0);
    const xp = totalXp(runs);
    const levelProgress = progressWithinLevel(xp, legacyLevelFloor);
    const streakInfo = computeStreaksWithFreeze(runs.map((r) => r.at));

    const weekStart = startOfWeek();
    const runsThisWeek = runs.filter((r) => r.at >= weekStart).length;

    const completedLevelIds = new Set(runs.map((r) => r.levelId));

    const safeRosters: ClassRosters = rosters ?? { beginner: [], intermediate: [], hard: [] };

    // Campaign gates read the EFFECTIVE level (floor applied) and the live
    // beatmap registry — levels without a beatmap auto-pass the skill gate.
    const gate = { playerLevel: levelProgress.level, hasBeatmap };
    const classDataMap = {} as Record<ClassKey, ClassData>;
    for (const key of CLASS_ORDER) {
      classDataMap[key] = buildClassData(key, safeRosters[key], runs, gate);
    }

    return {
      totalRuns,
      totalMinutes,
      totalCalories,
      totalObstacles: lifetime.obstacles,
      coins,
      xp,
      levelProgress,
      streak: streakInfo.current,
      longestStreak: streakInfo.longest,
      streakInfo,
      runsThisWeek,
      completedLevelIds,
      classDataMap,
    };
  }, [runs, rosters, legacyLevelFloor]);

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
      legacyLevelFloor,
      hudThemeId: hudTheme,
      setHudTheme,
      streak: derived.streak,
      longestStreak: derived.longestStreak,
      streakInfo: derived.streakInfo,
      runsThisWeek: derived.runsThisWeek,
      weeklyGoal,
      completedLevelIds: derived.completedLevelIds,
      isLevelCompleted,
      completionCount,
      classData,
      activeClassData,
      nextLevelId,
      setActiveClass,
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
      legacyLevelFloor,
      hudTheme,
      setHudTheme,
      derived,
      weeklyGoal,
      isLevelCompleted,
      completionCount,
      classData,
      activeClassData,
      nextLevelId,
      setActiveClass,
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
