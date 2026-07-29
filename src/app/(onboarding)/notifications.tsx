import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton, MascotRunner, OnboardingTopBar } from '@/components/ui';
import { ensureNotificationPermission, scheduleWeeklyReminders } from '@/lib/notifications';
import { useOnboarding } from '@/lib/OnboardingContext';
import { useProgress } from '@/lib/ProgressContext';
import { accentColor, colors, font, radius, spacing } from '@/theme';

/**
 * Notifications opt-in.
 *
 * On "Continue" we request OS permission via `expo-notifications` (a native
 * module, guarded to no-op on web / older dev builds). The real result is
 * persisted to `answers.reminders`, and when granted we immediately schedule the
 * local weekly workout + streak reminders from the collected weekly goal and the
 * current streak. The root layout reschedules on every launch to keep the streak
 * copy fresh. Scheduling local notifications requires a new dev/native build.
 */

const BENEFITS: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; accent: 'lime' | 'violet' | 'orange' }[] = [
  { icon: 'alarm', title: 'Run reminders', sub: 'A nudge on your goal days so you never miss', accent: 'lime' },
  { icon: 'gift', title: 'Reward alerts', sub: "Know the moment you've earned coins & badges", accent: 'violet' },
  { icon: 'flame', title: 'Streak protection', sub: 'Stay on track before your streak slips', accent: 'orange' },
];

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { answers, setAnswer } = useOnboarding();
  const { streak } = useProgress();
  const [busy, setBusy] = useState(false);

  // The route is new in this working tree, so the generated typed-route cache
  // may not include it until Metro next restarts.
  const goNext = () => router.push('/(onboarding)/gameplay-showcase' as Href);

  const onEnable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await ensureNotificationPermission();
      // Record intent even when the native module is unavailable so the choice
      // is honored once notifications are wired up in a dev build.
      setAnswer('reminders', result !== 'denied');
      if (result === 'granted') {
        await scheduleWeeklyReminders({
          daysPerWeek: answers.daysPerWeek,
          streak,
          enabled: true,
        });
      }
    } finally {
      setBusy(false);
      goNext();
    }
  };

  const onSkip = () => {
    setAnswer('reminders', false);
    goNext();
  };

  return (
    <View style={styles.root}>
      <OnboardingTopBar progress={0.72} topInset={insets.top} onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.mascotWrap}>
          <MascotRunner size={140} />
        </View>
        <Text style={styles.title}>Never miss a run</Text>
        <Text style={styles.sub}>Get nudged about your runs, rewards, and streaks.</Text>

        <View style={styles.list}>
          {BENEFITS.map((b) => (
            <View key={b.title} style={styles.row}>
              <View style={styles.rowLead}>
                <Ionicons name={b.icon} size={22} color={accentColor[b.accent]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{b.title}</Text>
                <Text style={styles.rowSub}>{b.sub}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable onPress={onSkip} hitSlop={8} style={styles.skipRow}>
          <Text style={styles.skipText}>Maybe later</Text>
        </Pressable>
        <GradientButton label="CONTINUE" icon="notifications" accent="lime" onPress={onEnable} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  mascotWrap: { alignItems: 'center', marginBottom: spacing.md },
  title: { color: colors.text, fontSize: 30, fontWeight: font.black, letterSpacing: -0.6, textAlign: 'center' },
  sub: {
    color: colors.textDim,
    fontSize: 15,
    fontWeight: font.medium,
    marginTop: spacing.sm,
    lineHeight: 21,
    textAlign: 'center',
  },
  list: { gap: spacing.md, marginTop: spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowLead: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: font.bold },
  rowSub: { color: colors.textDim, fontSize: 13, fontWeight: font.medium, marginTop: 2, lineHeight: 18 },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  skipRow: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  skipText: { color: colors.textDim, fontSize: 15, fontWeight: font.bold, textDecorationLine: 'underline' },
});
