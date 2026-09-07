import { Stack } from 'expo-router';
import { colors } from '@/theme';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
        gestureEnabled: false,
      }}
    >
      <Stack.Screen name="welcome" />
      <Stack.Screen name="attribution" />
      <Stack.Screen name="gameplay-showcase" />
      <Stack.Screen name="questions" />
      <Stack.Screen name="how-you-play" />
      <Stack.Screen name="where-you-play" />
      <Stack.Screen name="pick-first-run" />
      <Stack.Screen name="username" />
      <Stack.Screen name="goal" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="create-account" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="plan" options={{ animation: 'fade' }} />
      <Stack.Screen name="make-it-real" />
      <Stack.Screen name="signin" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}
