import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';
import { Platform } from 'react-native';
import {
  firebaseConfig,
  firebaseConfigurationError,
} from './config';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let firestore: Firestore | null = null;

function requireConfig() {
  if (!firebaseConfig) {
    throw new Error(firebaseConfigurationError ?? 'Firebase is not configured.');
  }
  return firebaseConfig;
}

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  const config = requireConfig();
  app = getApps().length ? getApp() : initializeApp(config);
  return app;
}

export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  const firebaseApp = getFirebaseApp();
  if (Platform.OS === 'web') {
    auth = getAuth(firebaseApp);
    return auth;
  }
  try {
    // Metro resolves Firebase's React Native entrypoint, which includes this
    // helper even though the package's default TypeScript condition is web.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rnAuth = require('firebase/auth') as {
      getReactNativePersistence: (storage: typeof AsyncStorage) => never;
    };
    auth = initializeAuth(firebaseApp, {
      persistence: rnAuth.getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Fast Refresh can initialize Auth before this module state is restored.
    auth = getAuth(firebaseApp);
  }
  return auth;
}

export function getFirebaseDb(): Firestore {
  if (firestore) return firestore;
  const firebaseApp = getFirebaseApp();
  if (Platform.OS === 'web') {
    firestore = getFirestore(firebaseApp);
    return firestore;
  }
  try {
    firestore = initializeFirestore(firebaseApp, {
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    firestore = getFirestore(firebaseApp);
  }
  return firestore;
}
