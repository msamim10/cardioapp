import {
  AppleAuthenticationScope,
  isAvailableAsync as isAppleAvailableAsync,
  signInAsync as appleSignInAsync,
} from 'expo-apple-authentication';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  OAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  verifyBeforeUpdateEmail,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import { requireOptionalNativeModule } from 'expo-modules-core';
import {
  collection,
  doc,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  firebaseConfigurationError,
  googleIosClientId,
  googleWebClientId,
  isFirebaseConfigured,
  isGoogleSignInConfigured,
} from './config';
import { getFirebaseAuth, getFirebaseDb } from './firebase';
import {
  appleCredentialParams,
  googleSignInPayload,
  inspectAppleTokenClaims,
  isAccountCollision,
  randomNonceFromBytes,
  socialAuthErrorMessage,
} from './authProviders';

export type AuthProviderKind = 'google' | 'apple' | 'email';

export type AuthUser = {
  id: string;
  provider: AuthProviderKind;
  /** Every sign-in method linked to this account (e.g. an email account that
   * also linked Google). Used to decide whether the email is editable here. */
  providers: AuthProviderKind[];
  /** True only for guest/anonymous Firebase sessions. */
  isGuest: boolean;
  /** True when a password provider is linked and the user is not a guest, i.e.
   * the email is owned by us (not federated) and can be changed in-app. */
  canChangeEmail: boolean;
  email: string | null;
  name: string | null;
  photo: string | null;
};

/**
 * Outcome of an email-change attempt. `verifyBeforeUpdateEmail` sends a link to
 * the NEW address and only swaps the email after the user confirms it, so
 * `verification-sent` does not mean the email has changed yet.
 */
export type UpdateEmailResult =
  | { status: 'verification-sent'; email: string }
  | { status: 'requires-password' }
  | { status: 'not-allowed'; message: string }
  | { status: 'error'; error: unknown; message: string };

export type SignInResult =
  | { status: 'signed-in'; user: AuthUser }
  | { status: 'cancelled' }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; error: unknown; message: string };

type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');

function getGoogleSignin(): GoogleSigninModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-google-signin/google-signin');
  } catch {
    return null;
  }
}

let googleConfigured = false;
let pendingGoogleCredential: AuthCredential | null = null;

function ensureGoogleConfigured(mod: GoogleSigninModule): boolean {
  if (!isGoogleSignInConfigured) return false;
  if (!googleConfigured) {
    mod.GoogleSignin.configure({
      webClientId: googleWebClientId ?? undefined,
      iosClientId: googleIosClientId ?? undefined,
      scopes: ['openid', 'profile', 'email'],
    });
    googleConfigured = true;
  }
  return true;
}

/**
 * Sign in with a social credential, only *linking* it when we're upgrading an
 * anonymous session.
 *
 * Firebase persists the signed-in user via AsyncStorage (see `firebase.ts`), so
 * `auth.currentUser` is frequently already set for a returning tester who
 * re-enters onboarding (e.g. after the dev "reset onboarding", which clears
 * local onboarding but not the Firebase session). Blindly calling
 * `linkWithCredential` in that case throws `auth/provider-already-linked`
 * because the account already owns that provider. Linking is only meaningful to
 * promote a genuinely anonymous user; otherwise (and as a fallback when the
 * credential already maps to a real account) we sign in with the credential,
 * which resolves to the account it belongs to.
 */
async function signInWithSocialCredential(
  auth: ReturnType<typeof getFirebaseAuth>,
  credential: AuthCredential,
) {
  const current = auth.currentUser;
  if (current?.isAnonymous) {
    try {
      return await linkWithCredential(current, credential);
    } catch (error) {
      const code = authErrorCode(error);
      const alreadyReal =
        code === 'auth/provider-already-linked' ||
        code === 'auth/credential-already-in-use' ||
        code === 'auth/email-already-in-use';
      if (!alreadyReal) throw error;
    }
  }
  return signInWithCredential(auth, credential);
}

function providerFor(user: User): AuthProviderKind {
  if (user.providerData.some(({ providerId }) => providerId === 'google.com')) return 'google';
  if (user.providerData.some(({ providerId }) => providerId === 'apple.com')) return 'apple';
  return 'email';
}

function providerKindsFor(user: User): AuthProviderKind[] {
  const kinds = new Set<AuthProviderKind>();
  for (const { providerId } of user.providerData) {
    if (providerId === 'google.com') kinds.add('google');
    else if (providerId === 'apple.com') kinds.add('apple');
    else if (providerId === 'password') kinds.add('email');
  }
  return [...kinds];
}

function toAuthUser(user: User): AuthUser {
  const providers = providerKindsFor(user);
  return {
    id: user.uid,
    provider: providerFor(user),
    providers,
    isGuest: user.isAnonymous,
    canChangeEmail: !user.isAnonymous && providers.includes('email'),
    email: user.email,
    name: user.displayName,
    photo: user.photoURL,
  };
}

export function updateEmailErrorMessage(error: unknown): string {
  const code = authErrorCode(error);
  switch (code) {
    case 'auth/email-already-in-use':
      return 'That email is already used by another account.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/user-mismatch':
      return 'That password is incorrect. Try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Check your connection and try again.';
    case 'auth/requires-recent-login':
      return 'For your security, sign in again, then retry.';
    case 'auth/operation-not-allowed':
      return 'Changing email is not enabled for this account.';
    default:
      return 'Could not update your email. Please try again.';
  }
}

function authErrorCode(error: unknown): string {
  return (error as { code?: string })?.code ?? 'unknown';
}

function logAuthFailure(provider: AuthProviderKind, stage: string, error: unknown): void {
  if (__DEV__) {
    // Never log credentials, tokens, email addresses, or provider error payloads.
    console.warn('[auth] sign-in failed', {
      provider,
      stage,
      code: authErrorCode(error),
    });
  }
}

export function authErrorMessage(error: unknown): string {
  const code = authErrorCode(error);
  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account already exists for this email. Try signing in.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'The email or password is incorrect.';
    case 'auth/weak-password':
      return 'Use a password with at least 6 characters.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/network-request-failed':
      return 'Check your connection and try again.';
    case 'auth/requires-recent-login':
      return 'Please sign out, sign in again, then retry account deletion.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled in Firebase yet.';
    default:
      return error instanceof Error ? error.message : 'Authentication failed. Please try again.';
  }
}

function unavailableResult(): SignInResult {
  return {
    status: 'unavailable',
    message: firebaseConfigurationError ?? 'Firebase is unavailable in this build.',
  };
}

const APPLE_CRYPTO_UNAVAILABLE_MESSAGE =
  'Apple Sign-In requires the latest development build. Install it and try again.';

function isExpoCryptoUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ExpoCrypto|expo-crypto|native module/i.test(message);
}

type ExpoCryptoModule = typeof import('expo-crypto');

async function randomNonce(crypto: ExpoCryptoModule): Promise<string> {
  const bytes = await crypto.getRandomBytesAsync(32);
  return randomNonceFromBytes(bytes);
}

type AuthContextValue = {
  hydrated: boolean;
  configured: boolean;
  configurationError: string | null;
  user: AuthUser | null;
  signInWithGoogle: () => Promise<SignInResult>;
  signInWithApple: () => Promise<SignInResult>;
  signUpWithEmail: (email: string, password: string, name?: string) => Promise<SignInResult>;
  signInWithEmail: (email: string, password: string) => Promise<SignInResult>;
  resetPassword: (email: string) => Promise<void>;
  updateUserEmail: (newEmail: string, currentPassword?: string) => Promise<UpdateEmailResult>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setHydrated(true);
      return;
    }
    return onAuthStateChanged(getFirebaseAuth(), (next) => {
      setUser(next ? toAuthUser(next) : null);
      setHydrated(true);
    });
  }, []);

  const finish = useCallback((firebaseUser: User): SignInResult => {
    const next = toAuthUser(firebaseUser);
    setUser(next);
    return { status: 'signed-in', user: next };
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<SignInResult> => {
    if (!isFirebaseConfigured) return unavailableResult();
    const mod = getGoogleSignin();
    if (!mod || !ensureGoogleConfigured(mod)) {
      return { status: 'unavailable', message: 'Google Sign-In is not configured in this build.' };
    }
    let stage = 'native-availability';
    let googleCredential: AuthCredential | null = null;
    try {
      await mod.GoogleSignin.hasPlayServices();
      stage = 'native-sign-in';
      const response = await mod.GoogleSignin.signIn();
      if (!mod.isSuccessResponse(response)) return { status: 'cancelled' };
      const google = googleSignInPayload(response);
      stage = 'token';
      if (!google?.idToken) {
        const error = { code: 'google/missing-id-token' };
        logAuthFailure('google', stage, error);
        return {
          status: 'error',
          error,
          message: 'Google Sign-In did not return a usable identity. Please try again.',
        };
      }
      const auth = getFirebaseAuth();
      const credential = GoogleAuthProvider.credential(google.idToken);
      googleCredential = credential;
      stage = 'firebase-sign-in';
      const result = await signInWithSocialCredential(auth, credential);
      return finish(result.user);
    } catch (error) {
      const code = authErrorCode(error);
      if (code === mod.statusCodes.SIGN_IN_CANCELLED || /cancel/i.test(code ?? '')) {
        return { status: 'cancelled' };
      }
      if (isAccountCollision(error) && googleCredential) {
        pendingGoogleCredential = googleCredential;
      }
      logAuthFailure('google', stage, error);
      return { status: 'error', error, message: socialAuthErrorMessage(error, 'google') };
    }
  }, [finish]);

  const signInWithApple = useCallback(async (): Promise<SignInResult> => {
    if (!isFirebaseConfigured) return unavailableResult();
    let stage = 'native-availability';
    try {
      if (!(await isAppleAvailableAsync())) {
        return { status: 'unavailable', message: 'Apple Sign-In is unavailable on this device.' };
      }
      if (requireOptionalNativeModule('ExpoCrypto') === null) {
        return { status: 'unavailable', message: APPLE_CRYPTO_UNAVAILABLE_MESSAGE };
      }
      let crypto: ExpoCryptoModule;
      try {
        stage = 'crypto-load';
        crypto = await import('expo-crypto');
      } catch (error) {
        if (isExpoCryptoUnavailable(error)) {
          return { status: 'unavailable', message: APPLE_CRYPTO_UNAVAILABLE_MESSAGE };
        }
        throw error;
      }

      let rawNonce: string;
      let hashedNonce: string;
      try {
        stage = 'nonce';
        rawNonce = await randomNonce(crypto);
        hashedNonce = await crypto.digestStringAsync(
          crypto.CryptoDigestAlgorithm.SHA256,
          rawNonce
        );
      } catch (error) {
        if (isExpoCryptoUnavailable(error)) {
          return { status: 'unavailable', message: APPLE_CRYPTO_UNAVAILABLE_MESSAGE };
        }
        throw error;
      }
      stage = 'native-sign-in';
      const apple = await appleSignInAsync({
        requestedScopes: [AppleAuthenticationScope.FULL_NAME, AppleAuthenticationScope.EMAIL],
        nonce: hashedNonce,
      });
      if (__DEV__ && apple.identityToken) {
        // Claims only: never log the token, subject, email, name, or authorization code.
        console.info(
          '[auth] Apple token claims',
          inspectAppleTokenClaims(apple.identityToken, hashedNonce)
        );
      }
      const provider = new OAuthProvider('apple.com');
      const auth = getFirebaseAuth();
      const credential = provider.credential(appleCredentialParams(apple.identityToken, rawNonce));
      stage = 'firebase-sign-in';
      const result = await signInWithSocialCredential(auth, credential);
      if (!result.user.displayName && apple.fullName?.givenName) {
        const displayName = [apple.fullName.givenName, apple.fullName.familyName]
          .filter(Boolean)
          .join(' ');
        await updateProfile(result.user, { displayName });
      }
      return finish(result.user);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') {
        return { status: 'cancelled' };
      }
      logAuthFailure('apple', stage, error);
      return { status: 'error', error, message: socialAuthErrorMessage(error, 'apple') };
    }
  }, [finish]);

  const signUpWithEmail = useCallback(
    async (email: string, password: string, name?: string): Promise<SignInResult> => {
      if (!isFirebaseConfigured) return unavailableResult();
      try {
        const result = await createUserWithEmailAndPassword(
          getFirebaseAuth(),
          email.trim(),
          password
        );
        if (name?.trim()) await updateProfile(result.user, { displayName: name.trim() });
        return finish(result.user);
      } catch (error) {
        return { status: 'error', error, message: authErrorMessage(error) };
      }
    },
    [finish]
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      if (!isFirebaseConfigured) return unavailableResult();
      try {
        const result = await signInWithEmailAndPassword(
          getFirebaseAuth(),
          email.trim(),
          password
        );
        if (pendingGoogleCredential) {
          const credential = pendingGoogleCredential;
          pendingGoogleCredential = null;
          try {
            const linked = await linkWithCredential(result.user, credential);
            return finish(linked.user);
          } catch (error) {
            logAuthFailure('google', 'account-link', error);
            return { status: 'error', error, message: socialAuthErrorMessage(error, 'google') };
          }
        }
        return finish(result.user);
      } catch (error) {
        return { status: 'error', error, message: authErrorMessage(error) };
      }
    },
    [finish]
  );

  const resetPassword = useCallback(async (email: string) => {
    if (!isFirebaseConfigured) throw new Error(firebaseConfigurationError ?? 'Firebase unavailable.');
    await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
  }, []);

  const updateUserEmail = useCallback(
    async (newEmail: string, currentPassword?: string): Promise<UpdateEmailResult> => {
      if (!isFirebaseConfigured) {
        return {
          status: 'not-allowed',
          message: firebaseConfigurationError ?? 'Firebase is unavailable in this build.',
        };
      }
      const firebaseUser = getFirebaseAuth().currentUser;
      if (!firebaseUser) {
        return { status: 'not-allowed', message: 'No signed-in account.' };
      }
      if (firebaseUser.isAnonymous) {
        return {
          status: 'not-allowed',
          message: 'Create an account first to set an email address.',
        };
      }
      const kinds = providerKindsFor(firebaseUser);
      if (!kinds.includes('email')) {
        // Federated-only accounts (Apple/Google) get their email from the
        // provider; changing it here would desync from the identity provider.
        const managedBy = kinds.includes('apple') ? 'Apple' : 'Google';
        return {
          status: 'not-allowed',
          message: `Your email is managed by ${managedBy} and can\u2019t be changed here.`,
        };
      }
      const trimmed = newEmail.trim();
      try {
        // Reauthenticate up front when a password is supplied so that the
        // security-sensitive email change is guaranteed a recent login.
        if (currentPassword && firebaseUser.email) {
          const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
          await reauthenticateWithCredential(firebaseUser, credential);
        }
        // Sends a verification link to the NEW address. The email only updates
        // on Firebase once the user clicks that link, so we never write the
        // unverified address to Firestore here (it syncs on the next refresh).
        await verifyBeforeUpdateEmail(firebaseUser, trimmed);
        return { status: 'verification-sent', email: trimmed };
      } catch (error) {
        if (authErrorCode(error) === 'auth/requires-recent-login' && !currentPassword) {
          return { status: 'requires-password' };
        }
        return { status: 'error', error, message: updateEmailErrorMessage(error) };
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    const google = getGoogleSignin();
    if (google && googleConfigured) await google.GoogleSignin.signOut().catch(() => {});
    if (isFirebaseConfigured) await firebaseSignOut(getFirebaseAuth());
  }, []);

  const deleteAccount = useCallback(async () => {
    const firebaseUser = getFirebaseAuth().currentUser;
    if (!firebaseUser) throw new Error('No signed-in account.');
    const db = getFirebaseDb();
    // Security rules permit only this user's documents. Cleanup is best-effort;
    // Auth deletion still proceeds if a transient Firestore delete fails.
    try {
      const runs = await getDocs(collection(db, 'users', firebaseUser.uid, 'runs'));
      const batch = writeBatch(db);
      runs.forEach((run) => batch.delete(run.ref));
      batch.delete(doc(db, 'users', firebaseUser.uid, 'progress', 'state'));
      batch.delete(doc(db, 'users', firebaseUser.uid));
      await batch.commit();
    } catch (error) {
      console.warn('[auth] Firestore account cleanup failed:', error);
    }
    await deleteUser(firebaseUser);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      hydrated,
      configured: isFirebaseConfigured,
      configurationError: firebaseConfigurationError,
      user,
      signInWithGoogle,
      signInWithApple,
      signUpWithEmail,
      signInWithEmail,
      resetPassword,
      updateUserEmail,
      signOut,
      deleteAccount,
    }),
    [
      hydrated,
      user,
      signInWithGoogle,
      signInWithApple,
      signUpWithEmail,
      signInWithEmail,
      resetPassword,
      updateUserEmail,
      signOut,
      deleteAccount,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
