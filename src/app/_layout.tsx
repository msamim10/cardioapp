import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadProfile } from '@/lib/storage';

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    loadProfile().then((p) => {
      if (!p.hasSeenOnboarding) {
        router.replace('/onboarding');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0a0e14' },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding/index" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="community" options={{ animation: 'fade' }} />
        <Stack.Screen
          name="workout"
          options={{
            gestureEnabled: false,
            animation: 'fade',
          }}
        />
        <Stack.Screen name="summary" options={{ gestureEnabled: false }} />
        <Stack.Screen name="settings" />
      </Stack>
    </SafeAreaProvider>
  );
}
