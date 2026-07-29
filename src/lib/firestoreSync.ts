import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import type { AuthUser } from './AuthContext';
import { getFirebaseDb } from './firebase';
import { normalizeRunRecord, type RunRecord } from './progressSync';

export type CloudProgressState = {
  activeClass: unknown;
  rosters: unknown;
  cohorts: unknown;
  username: string | null;
  stateUpdatedAt: number;
};

export async function readCloudProgress(uid: string): Promise<{
  state: CloudProgressState | null;
  runs: RunRecord[];
}> {
  const db = getFirebaseDb();
  const [stateSnapshot, runSnapshots] = await Promise.all([
    getDoc(doc(db, 'users', uid, 'progress', 'state')),
    getDocs(collection(db, 'users', uid, 'runs')),
  ]);
  const runs = runSnapshots.docs
    .map((snapshot, index) => normalizeRunRecord(snapshot.data(), index))
    .filter((run): run is RunRecord => run !== null);
  return {
    state: stateSnapshot.exists() ? (stateSnapshot.data() as CloudProgressState) : null,
    runs,
  };
}

export async function syncCloudProgress(input: {
  user: AuthUser;
  username: string | null;
  runs: RunRecord[];
  state: CloudProgressState;
}): Promise<void> {
  const db = getFirebaseDb();
  await setDoc(
    doc(db, 'users', input.user.id),
    {
      email: input.user.email,
      displayName: input.user.name,
      photoURL: input.user.photo,
      username: input.username,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await setDoc(doc(db, 'users', input.user.id, 'progress', 'state'), input.state, {
    merge: true,
  });

  // Batched idempotent upserts make retries safe and avoid duplicate runs.
  for (let offset = 0; offset < input.runs.length; offset += 450) {
    const batch = writeBatch(db);
    for (const run of input.runs.slice(offset, offset + 450)) {
      batch.set(doc(db, 'users', input.user.id, 'runs', run.runId), run, { merge: true });
    }
    await batch.commit();
  }
}
