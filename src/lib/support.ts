import Constants from 'expo-constants';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { Platform } from 'react-native';
import type { AuthUser } from './AuthContext';
import { getFirebaseDb } from './firebase';

export const SUPPORT_MESSAGE_MAX_LENGTH = 4000;

export type SupportCategory = 'question' | 'bug' | 'billing' | 'feedback' | 'other';

export const SUPPORT_CATEGORIES: { key: SupportCategory; label: string }[] = [
  { key: 'question', label: 'Question' },
  { key: 'bug', label: 'Problem' },
  { key: 'billing', label: 'Billing' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'other', label: 'Other' },
];

/**
 * Persist a support message to the `supportMessages` collection so the owner can
 * read submissions from the Firestore console. The document shape mirrors the
 * `firestore.rules` create validation: `uid` must equal the caller's auth uid and
 * `status` starts as `'new'`.
 */
export async function submitSupportMessage(input: {
  message: string;
  category: SupportCategory;
  user: AuthUser | null;
}): Promise<void> {
  const db = getFirebaseDb();
  await addDoc(collection(db, 'supportMessages'), {
    message: input.message.trim(),
    category: input.category,
    uid: input.user?.id ?? null,
    email: input.user?.email ?? null,
    displayName: input.user?.name ?? null,
    platform: Platform.OS,
    appVersion: Constants.expoConfig?.version ?? null,
    status: 'new',
    createdAt: serverTimestamp(),
  });
}
