/**
 * Public profile (`profiles/{uid}`), username reservation, and the minimal
 * follow graph (`users/{uid}/following/{targetUid}`).
 *
 * Username lifecycle — decided here, documented in docs/LEADERBOARDS.md:
 *   1. Onboarding picks a handle offline (format + reserved-word checks only)
 *      and stores it in local progress. No account exists yet.
 *   2. On the first authenticated sync, `ensureUsernameReserved` calls the
 *      `reserveUsername` callable. If the handle is taken it retries with a
 *      numeric suffix (up to 3 times) and the caller adopts the reserved
 *      handle. The outcome is cached per uid so it runs once per device.
 *   3. Profile edits call `reserveUsername` synchronously and show "taken".
 *
 * `profiles/{uid}.username` is only writable by the Function (rules), so the
 * client never writes it here — all other public fields are owner-written.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  deleteDoc,
  doc,
  endAt,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAt,
} from 'firebase/firestore';
import { normalizeUsername } from '@shared/scoring/username';
import { isFirebaseConfigured } from './config';
import { getFirebaseDb } from './firebase';
import { MAX_FOLLOWING } from './leaderboards';
import { CallableError, callFunction } from './functionsClient';
import { suffixedUsername } from './username';

const RESERVED_KEY_PREFIX = 'cardiosurf.username.reserved.v1:';

export type PublicProfile = {
  uid: string;
  username: string | null;
  photoURL: string | null;
  level: number;
  badges: string[];
  hudTheme: string | null;
};

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

export function toPublicProfile(uid: string, data: Record<string, unknown> | undefined): PublicProfile {
  return {
    uid,
    username: str(data?.username),
    photoURL: str(data?.photoURL),
    level: Math.max(1, Math.round(num(data?.level, 1))),
    badges: Array.isArray(data?.badges) ? data.badges.filter((b): b is string => typeof b === 'string') : [],
    hudTheme: str(data?.hudTheme),
  };
}

/** Owner-written public fields. Username is deliberately absent (see header). */
export async function writePublicProfile(input: {
  uid: string;
  photoURL: string | null;
  level: number;
  badges: readonly string[];
  hudTheme: string | null;
}): Promise<void> {
  if (!isFirebaseConfigured) return;
  await setDoc(
    doc(getFirebaseDb(), 'profiles', input.uid),
    {
      photoURL: input.photoURL,
      level: input.level,
      badges: [...input.badges],
      hudTheme: input.hudTheme,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function fetchPublicProfile(uid: string): Promise<PublicProfile | null> {
  if (!isFirebaseConfigured) return null;
  try {
    const snapshot = await getDoc(doc(getFirebaseDb(), 'profiles', uid));
    return snapshot.exists() ? toPublicProfile(snapshot.id, snapshot.data()) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Username reservation
// ---------------------------------------------------------------------------

export type ReserveResult =
  | { status: 'reserved'; handle: string }
  | { status: 'taken' }
  | { status: 'invalid'; message: string }
  | { status: 'error'; message: string };

type ReserveResponse = { ok: true; handle: string } | { ok: false; reason: 'taken' | 'invalid'; message: string };

export async function reserveUsername(handle: string): Promise<ReserveResult> {
  try {
    const result = await callFunction<{ handle: string }, ReserveResponse>('reserveUsername', {
      handle: normalizeUsername(handle),
    });
    if (result.ok) return { status: 'reserved', handle: result.handle };
    if (result.reason === 'taken') return { status: 'taken' };
    return { status: 'invalid', message: result.message };
  } catch (error) {
    const code = error instanceof CallableError ? error.code : 'unknown';
    if (code === 'not-configured') return { status: 'error', message: 'Usernames need an internet connection.' };
    return { status: 'error', message: (error as Error).message };
  }
}

async function readReservedHandle(uid: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(RESERVED_KEY_PREFIX + uid);
  } catch {
    return null;
  }
}

async function rememberReservedHandle(uid: string, handle: string): Promise<void> {
  try {
    await AsyncStorage.setItem(RESERVED_KEY_PREFIX + uid, handle);
  } catch {
    // Best-effort cache; a missed write only costs one extra callable later.
  }
}

/**
 * Lazily reserve the locally chosen handle for a signed-in user. Returns the
 * handle that ended up reserved (possibly suffixed), or null when the server
 * could not be reached — callers keep the local handle and try again next
 * sync. Idempotent per (uid, handle) thanks to the local cache.
 */
export async function ensureUsernameReserved(uid: string, handle: string | null): Promise<string | null> {
  const wanted = handle ? normalizeUsername(handle) : '';
  if (!wanted) return null;
  const cached = await readReservedHandle(uid);
  if (cached === wanted) return wanted;

  let candidate = wanted;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await reserveUsername(candidate);
    if (result.status === 'reserved') {
      await rememberReservedHandle(uid, result.handle);
      return result.handle;
    }
    if (result.status !== 'taken') return null;
    candidate = suffixedUsername(wanted, attempt);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Follow graph + username search
// ---------------------------------------------------------------------------

function followingCollection(uid: string) {
  return collection(getFirebaseDb(), 'users', uid, 'following');
}

export async function fetchFollowing(uid: string): Promise<string[]> {
  if (!isFirebaseConfigured) return [];
  try {
    const snapshot = await getDocs(query(followingCollection(uid), limit(MAX_FOLLOWING)));
    return snapshot.docs.map((d) => d.id);
  } catch {
    return [];
  }
}

export async function isFollowing(uid: string, targetUid: string): Promise<boolean> {
  if (!isFirebaseConfigured) return false;
  try {
    const snapshot = await getDoc(doc(followingCollection(uid), targetUid));
    return snapshot.exists();
  } catch {
    return false;
  }
}

export async function followUser(uid: string, targetUid: string): Promise<void> {
  if (!isFirebaseConfigured || uid === targetUid) return;
  // Shape enforced by firestore.rules: exactly {uid, at} with uid == doc id.
  await setDoc(doc(followingCollection(uid), targetUid), { uid: targetUid, at: serverTimestamp() });
}

export async function unfollowUser(uid: string, targetUid: string): Promise<void> {
  if (!isFirebaseConfigured) return;
  await deleteDoc(doc(followingCollection(uid), targetUid));
}

export type UsernameHit = { handle: string; uid: string };

/** Prefix search over `usernames/{handleLower}` (document id range query). */
export async function searchUsernames(prefix: string, max = 20): Promise<UsernameHit[]> {
  const needle = normalizeUsername(prefix);
  if (!isFirebaseConfigured || needle.length < 2) return [];
  try {
    const snapshot = await getDocs(
      query(
        collection(getFirebaseDb(), 'usernames'),
        orderBy('__name__'),
        startAt(needle),
        endAt(`${needle}\uf8ff`),
        limit(max),
      ),
    );
    return snapshot.docs.flatMap((d) => {
      const uid = str(d.data().uid);
      return uid ? [{ handle: d.id, uid }] : [];
    });
  } catch {
    return [];
  }
}
