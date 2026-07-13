import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenTitle } from '@/components/ui';
import { ModeCard } from '@/components/ModeCard';
import { modes } from '@/lib/gameData';
import { colors, spacing } from '@/theme';

export default function LevelsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: 120 }]}
      showsVerticalScrollIndicator={false}
    >
      <ScreenTitle eyebrow="Pick your world" title="Levels" />
      <View style={styles.grid}>
        {modes.map((mode) => (
          <View key={mode.id} style={styles.cell}>
            <ModeCard mode={mode} wide onPress={() => router.push(`/level/${mode.id}`)} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  cell: {
    width: '47.5%',
    flexGrow: 1,
  },
});
