import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_WEIGHT_KG, STORAGE_KEYS } from './constants';
import type { Session, UserProfile } from './types';

export async function loadSessions(): Promise<Session[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.sessions);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Session[];
    if (!Array.isArray(parsed)) return [];
    return parsed.sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

export async function saveSession(session: Session): Promise<void> {
  const existing = await loadSessions();
  const next = [session, ...existing].slice(0, 200);
  await AsyncStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(next));
}

export async function clearSessions(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEYS.sessions);
}

export async function loadProfile(): Promise<UserProfile> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.profile);
    if (!raw) return { weightKg: DEFAULT_WEIGHT_KG };
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    return {
      weightKg:
        typeof parsed.weightKg === 'number' && parsed.weightKg > 0
          ? parsed.weightKg
          : DEFAULT_WEIGHT_KG,
    };
  } catch {
    return { weightKg: DEFAULT_WEIGHT_KG };
  }
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile));
}

export function summarizeSessions(sessions: Session[]) {
  const totalSec = sessions.reduce((acc, s) => acc + s.durationSec, 0);
  const totalCalories = sessions.reduce((acc, s) => acc + s.estimatedCalories, 0);
  return {
    count: sessions.length,
    totalSec,
    totalCalories,
  };
}
