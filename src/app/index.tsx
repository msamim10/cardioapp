import { useRouter } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppHeader, ChallengeFeatureCard, InfoPill, MetricCard, ModeTile, NeonScreen, SectionHeader, neon } from '@/components/neon/NeonUi';
import { BottomTabBar } from '@/components/BottomTabBar';
import { useRunnerUiData } from '@/hooks/useRunnerUiData';

export default function HomeScreen() {
  const router = useRouter();
  const { data } = useRunnerUiData();

  return (
    <View style={styles.root}>
      <NeonScreen>
        <AppHeader user={data.user} onActionPress={() => router.push('/settings')} />

        <Pressable
          onPress={() => router.push('/start-run')}
          style={({ pressed }) => [styles.homeHeroCard, pressed && styles.pressed]}
        >
          <Image source={data.homeHeroImage} style={styles.homeHeroImage} resizeMode="cover" />
        </Pressable>

        <View style={styles.quickRow}>
          {data.quickDurations.map((item) => (
            <InfoPill key={item.id} icon={item.icon} accent={item.accent} label={item.label} />
          ))}
        </View>

        <ChallengeFeatureCard challenge={data.dailyChallenge} onPress={() => router.push('/challenges')} />

        <SectionHeader title="Game Modes" actionLabel="View all" onActionPress={() => router.push('/play')} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeList}>
          {data.modes.slice(0, 4).map((mode) => (
            <ModeTile key={mode.id} mode={mode} onPress={() => router.push('/start-run')} />
          ))}
        </ScrollView>

        <SectionHeader title="Your Stats" />
        <View style={styles.statsRow}>
          {data.homeStats.map((metric) => (
            <MetricCard key={metric.id} metric={metric} />
          ))}
        </View>
      </NeonScreen>
      <BottomTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: neon.bg,
  },
  homeHeroCard: {
    width: '100%',
    aspectRatio: 1.6,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: neon.panel,
  },
  homeHeroImage: {
    width: '100%',
    height: '100%',
  },
  quickRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeList: {
    gap: 12,
    paddingRight: 18,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
});
