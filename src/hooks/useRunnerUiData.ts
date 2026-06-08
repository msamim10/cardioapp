import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { buildRunnerUiData, type RunnerUiData } from '@/lib/run-ui-data';
import {
  computeStreak,
  loadProfile,
  loadSessions,
  summarizeSessions,
} from '@/lib/storage';
import type { Session, UserProfile } from '@/lib/types';

export type RunnerUiState = {
  data: RunnerUiData;
  profile: UserProfile;
  sessions: Session[];
  isLoading: boolean;
};

export function useRunnerUiData(): RunnerUiState {
  const [state, setState] = useState<RunnerUiState>(() => {
    const profile: UserProfile = { weightKg: 70 };
    const sessions: Session[] = [];
    return {
      data: buildRunnerUiData({
        profile,
        summary: summarizeSessions(sessions),
        streakDays: computeStreak(sessions),
      }),
      profile,
      sessions,
      isLoading: true,
    };
  });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([loadProfile(), loadSessions()]).then(([profile, sessions]) => {
        if (cancelled) return;
        setState({
          data: buildRunnerUiData({
            profile,
            summary: summarizeSessions(sessions),
            streakDays: computeStreak(sessions),
          }),
          profile,
          sessions,
          isLoading: false,
        });
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return state;
}
