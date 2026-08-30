import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { OnboardingProvider, useOnboarding } from '@/lib/OnboardingContext';
import { ProgressProvider, useProgress } from '@/lib/ProgressContext';
import { SubscriptionProvider } from '@/lib/SubscriptionContext';
import { initAnalytics } from '@/lib/analytics';
import { decideAuthGate } from '@/lib/authGate';
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

function RootNavigator() {
  const { hydrated: onboardingHydrated, completed, answers } = useOnboarding();
  const { hydrated: authHydrated, user } = useAuth();
  const { hydrated: progressHydrated, streak } = useProgress();
  const segments = useSegments();
  const router = useRouter();

  // Wait for all persisted contexts to hydrate from AsyncStorage before
  // redirecting or rendering, otherwise we'd flash/loop while auth, onboarding,
  // or progress state is still unknown.
  const hydrated = onboardingHydrated && authHydrated && progressHydrated;
  const inOnboarding = segments[0] === '(onboarding)';
  const onCreateAccount = inOnboarding && segments[1] === 'create-account';
  const destination = decideAuthGate({
    hydrated,
    onboardingCompleted: completed,
    authenticated: user !== null,
  });
  const routeMatchesGate =
    destination === 'loading' ||
    (destination === 'tabs' && !inOnboarding) ||
    (destination === 'create-account' && onCreateAccount) ||
    (destination === 'welcome' && inOnboarding);

  // Tabs require both a completed onboarding flow and Firebase user. Legacy
  // installs that completed local onboarding are sent to account creation.
  useEffect(() => {
    if (destination === 'loading') return;
    if (destination === 'tabs' && inOnboarding) {
      router.replace('/(tabs)');
    } else if (destination === 'create-account' && !onCreateAccount) {
      router.replace('/(onboarding)/create-account');
    } else if (destination === 'welcome' && !inOnboarding) {
      router.replace('/(onboarding)/welcome');
    }
  }, [destination, inOnboarding, onCreateAccount, router]);

  // Reschedule local reminders on cold start (and whenever the opt-in, weekly
  // goal, or streak changes) so recurring notifications reflect the latest
  // schedule and streak copy. Cheap: cancel + reschedule only on those changes,
  // and a hard no-op on web / older builds without the native module.
  const remindersOn = answers.reminders;
  const daysPerWeek = answers.daysPerWeek;
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
      await scheduleWeeklyReminders({ daysPerWeek, streak, enabled: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, remindersOn, daysPerWeek, streak]);

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
      <Stack.Screen name="faq" options={{ presentation: 'card' }} />
      <Stack.Screen name="edit-email" options={{ presentation: 'card' }} />
      <Stack.Screen name="support" options={{ presentation: 'card' }} />
      <Stack.Screen name="paywall" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen
        name="preflight"
        options={{ animation: 'fade', gestureEnabled: false }}
      />
      <Stack.Screen name="workout" options={{ animation: 'fade', gestureEnabled: false }} />
      <Stack.Screen name="summary" options={{ animation: 'fade', gestureEnabled: false }} />
      {__DEV__ ? (
        <Stack.Screen name="debug-funnel" options={{ presentation: 'card' }} />
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
