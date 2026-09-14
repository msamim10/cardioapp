import * as Linking from 'expo-linking';
import { type Href, Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import {
  OnboardingProvider,
  useOnboarding,
  type OnboardingCheckpoint,
} from '@/lib/OnboardingContext';
import { ProgressProvider, useProgress } from '@/lib/ProgressContext';
import { SubscriptionProvider } from '@/lib/SubscriptionContext';
import { initAnalytics } from '@/lib/analytics';
import { decideAuthGate } from '@/lib/authGate';
import { hydrateBeatmapCache, refreshAllBeatmaps } from '@/lib/beatmapRegistry';
import { hydrateBoardCache } from '@/lib/boardCache';
import { modes } from '@/lib/gameData';
import { challengeHref, parseChallengeLink } from '@/lib/challengeLinks';
import { stashPendingDeepLink, takePendingDeepLink } from '@/lib/pendingDeepLink';
import {
  cancelAllReminders,
  getNotificationPermission,
  initNotificationHandler,
  scheduleWeeklyReminders,
} from '@/lib/notifications';
import { colors } from '@/theme';

export default function RootLayout() {
  // Initialize attribution + analytics once at launch. Singular holds the
  // install/session event until the ATT prompt is answered (shown at the end of
  // onboarding, in AccountAuthScreen), so this is safe to call before ATT.
  useEffect(() => {
    initAnalytics();
    void hydrateBeatmapCache();
    void hydrateBoardCache();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <SubscriptionProvider>
          <OnboardingProvider>
            <ProgressProvider>
              <RootNavigator />
            </ProgressProvider>
          </OnboardingProvider>
        </SubscriptionProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * Routes outside the `(onboarding)` group that the first-run ceremony passes
 * through before onboarding is marked complete: calibration, the "first run is
 * ready" offer screen, and the run itself. The gate must treat them as part of
 * onboarding, or it would bounce the user back to welcome mid-ceremony.
 */
const FIRST_RUN_ROUTES = new Set(['preflight', 'first-run-ready', 'workout', 'summary']);

const CHECKPOINT_ROUTES: Record<OnboardingCheckpoint, Href> = {
  plan: '/(onboarding)/plan',
  'make-it-real': '/(onboarding)/make-it-real' as Href,
  'first-run-ready': '/first-run-ready' as Href,
};

function RootNavigator() {
  const { hydrated: onboardingHydrated, completed, answers, checkpoint } = useOnboarding();
  const { hydrated: authHydrated, user } = useAuth();
  const { hydrated: progressHydrated, streak, streakInfo } = useProgress();
  const segments = useSegments();
  const router = useRouter();

  // Wait for all persisted contexts to hydrate from AsyncStorage before
  // redirecting or rendering, otherwise we'd flash/loop while auth, onboarding,
  // or progress state is still unknown.
  const hydrated = onboardingHydrated && authHydrated && progressHydrated;
  const inOnboarding = segments[0] === '(onboarding)';
  const inOnboardingFlow = inOnboarding || FIRST_RUN_ROUTES.has(segments[0] ?? '');
  const onCreateAccount = inOnboarding && segments[1] === 'create-account';
  const destination = decideAuthGate({
    hydrated,
    onboardingCompleted: completed,
    authenticated: user !== null,
    checkpoint,
  });
  const routeMatchesGate =
    destination === 'loading' ||
    (destination === 'tabs' && !inOnboarding) ||
    (destination === 'create-account' && onCreateAccount) ||
    (destination === 'welcome' && inOnboardingFlow) ||
    (destination === 'resume' && inOnboardingFlow);

  // Charts (consensus beatmaps) are mirrored locally; refresh the mirror once
  // per sign-in when any level's copy is past its TTL. Reads need a user.
  const uid = user?.id ?? null;
  useEffect(() => {
    if (!uid) return;
    void refreshAllBeatmaps(modes.map((mode) => mode.id));
  }, [uid]);

  // Latest URL the app was opened with (cold start or while running). When a
  // gate redirect below fires, a challenge/level link in flight is stashed and
  // replayed once the gate settles on tabs — otherwise `router.replace` would
  // silently drop it.
  const incomingUrl = Linking.useURL();
  const incomingUrlRef = useRef<string | null>(null);
  incomingUrlRef.current = incomingUrl;
  const stashIncomingLink = () => stashPendingDeepLink(parseChallengeLink(incomingUrlRef.current));

  // Tabs require both a completed onboarding flow and Firebase user. Legacy
  // installs that completed local onboarding are sent to account creation. A
  // signed-in user with a first-run checkpoint resumes there after a kill.
  useEffect(() => {
    if (destination === 'loading') return;
    if (destination === 'tabs' && inOnboarding) {
      router.replace('/(tabs)');
    } else if (destination === 'create-account' && !onCreateAccount) {
      stashIncomingLink();
      router.replace('/(onboarding)/create-account');
    } else if (destination === 'resume' && !inOnboardingFlow) {
      stashIncomingLink();
      router.replace(CHECKPOINT_ROUTES[checkpoint ?? 'plan']);
    } else if (destination === 'welcome' && !inOnboardingFlow) {
      stashIncomingLink();
      router.replace('/(onboarding)/welcome');
    }
  }, [checkpoint, destination, inOnboarding, inOnboardingFlow, onCreateAccount, router]);

  // Replay a stashed deep link once the user is through the gate and on tabs.
  useEffect(() => {
    if (destination !== 'tabs' || inOnboarding) return;
    // Take inside the timeout so a cancelled tick leaves the link stashed.
    const timer = setTimeout(() => {
      const link = takePendingDeepLink();
      if (link) router.push(challengeHref(link));
    }, 250);
    return () => clearTimeout(timer);
  }, [destination, inOnboarding, router]);

  // Reschedule local reminders on cold start (and whenever the opt-in, weekly
  // goal, streak, today's-run state, or freeze availability changes) so
  // recurring notifications reflect the latest schedule and streak copy. Cheap:
  // cancel + reschedule only on those changes, and a hard no-op on web / older
  // builds without the native module. Local notifications only — no push.
  const remindersOn = answers.reminders;
  const daysPerWeek = answers.daysPerWeek;
  const ranToday = streakInfo.ranToday;
  const freezeAvailable = streakInfo.freezeAvailable;
  useEffect(() => {
    if (!hydrated) return;
    initNotificationHandler();
    let cancelled = false;
    (async () => {
      if (!remindersOn) {
        await cancelAllReminders();
        return;
      }
      const permission = await getNotificationPermission();
      if (cancelled) return;
      if (permission !== 'granted') {
        await cancelAllReminders();
        return;
      }
      await scheduleWeeklyReminders({
        daysPerWeek,
        streak,
        ranToday,
        freezeAvailable,
        enabled: true,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, remindersOn, daysPerWeek, streak, ranToday, freezeAvailable]);

  // The themed loading state covers the stack while a redirect settles, so
  // neither the welcome screen nor the tabs flash for the wrong completion
  // state. It has to be an overlay rather than a replacement: unmounting the
  // navigator leaves the redirect above with nothing to dispatch to, and
  // react-navigation drops the action ("was not handled by any navigator"),
  // which stranded the app on this spinner at the end of onboarding.
  return (
    <View style={styles.root}>
      <RootStack />
      {!routeMatchesGate ? (
        <View style={styles.gateOverlay}>
          <ActivityIndicator color={colors.lime} />
        </View>
      ) : null}
    </View>
  );
}

function RootStack() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="(onboarding)" options={{ animation: 'fade' }} />
      <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      <Stack.Screen
        name="modes/index"
        options={{ presentation: 'card', animation: 'slide_from_right' }}
      />
      <Stack.Screen name="level/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="l/[id]" options={{ animation: 'none' }} />
      <Stack.Screen name="leaderboard/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="clip/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="runner/[uid]" options={{ presentation: 'card' }} />
      <Stack.Screen name="find-friends" options={{ presentation: 'card' }} />
      <Stack.Screen name="edit-username" options={{ presentation: 'card' }} />
      <Stack.Screen name="faq" options={{ presentation: 'card' }} />
      <Stack.Screen name="edit-email" options={{ presentation: 'card' }} />
      <Stack.Screen name="support" options={{ presentation: 'card' }} />
      <Stack.Screen name="paywall" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen
        name="preflight"
        options={{ animation: 'fade', gestureEnabled: false }}
      />
      <Stack.Screen
        name="first-run-ready"
        options={{ animation: 'fade', gestureEnabled: false }}
      />
      <Stack.Screen name="workout" options={{ animation: 'fade', gestureEnabled: false }} />
      <Stack.Screen name="summary" options={{ animation: 'fade', gestureEnabled: false }} />
      {__DEV__ ? (
        <>
          <Stack.Screen name="debug-funnel" options={{ presentation: 'card' }} />
          <Stack.Screen name="dev-beatmap" options={{ presentation: 'card' }} />
        </>
      ) : null}
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  gateOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
