import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ConfettiBurst,
  GradientButton,
  LeaderboardClimb,
  Mascot,
  OnboardingTopBar,
  type ClimbRow,
} from '@/components/ui';
import { useProgress } from '@/lib/ProgressContext';
import { sampleRivalHandles } from '@/lib/username';
import { colors, font, spacing } from '@/theme';

// Aspirational preview values for the finale. Fictional rivals only. // simulated until backend
const PREVIEW_XP = [9120, 8430, 7980, 7210, 6540, 5890, 5230];

export default function ClimbScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { username } = useProgress();
  const [celebrate, setCelebrate] = useState(false);

  const handle = username ?? 'you';

  // Final order (index 0 = #1 = the user); the component animates the user's row
  // up from the bottom and every rival leapfrogs down a slot.
  const rows = useMemo<ClimbRow[]>(() => {
    const rivals = sampleRivalHandles(PREVIEW_XP.length - 1);
    const userRow: ClimbRow = { handle, value: `${PREVIEW_XP[0].toLocaleString()} XP`, isUser: true };
    const rivalRows: ClimbRow[] = rivals.map((h, i) => ({
      handle: h,
      value: `${PREVIEW_XP[i + 1].toLocaleString()} XP`,
    }));
    return [userRow, ...rivalRows];
  }, [handle]);

  return (
    <View style={styles.root}>
      <OnboardingTopBar progress={0.5} topInset={insets.top} onBack={() => router.back()} />
      <View style={styles.content}>
        <Text style={styles.title}>Climb the leaderboard</Text>
        <Text style={styles.sub}>Every run pushes you up the ranks. Here&apos;s the view from the top.</Text>

        <View style={styles.board}>
          <LeaderboardClimb
            rows={rows}
            onArrive={() => setCelebrate(true)}
            userAvatar={<Mascot variant="avatar" size={34} />}
          />
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <GradientButton
          label="LET'S GO"
          icon="rocket"
          accent="lime"
          onPress={() => router.push('/(onboarding)/goal')}
        />
      </View>

      <ConfettiBurst trigger={celebrate} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  title: { color: colors.text, fontSize: 32, fontWeight: font.black, letterSpacing: -0.7, lineHeight: 37 },
  sub: { color: colors.textDim, fontSize: 15, fontWeight: font.medium, marginTop: spacing.sm, lineHeight: 21 },
  board: { marginTop: spacing.xl },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
