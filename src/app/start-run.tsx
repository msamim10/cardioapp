import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CroppedArtworkCard, GradientButton, IconBadge, InfoPill, MoveCard, NeonScreen, Panel, ProgressBar, ReadinessCard, SectionHeader, accentColor, neon } from '@/components/neon/NeonUi';
import { useRunnerUiData } from '@/hooks/useRunnerUiData';
import { levelLabel } from '@/lib/run-ui-data';

export default function StartRunScreen() {
  const router = useRouter();
  const { data } = useRunnerUiData();
  const mode = data.featuredMode;
  const challenge = data.dailyChallenge;
  const startRun = (scene: 'city-builder' | 'current') => {
    router.push({
      pathname: '/workout',
      params: { scene },
    });
  };

  return (
    <View style={styles.root}>
      <NeonScreen contentStyle={styles.screenContent}>
        <View style={styles.topNav}>
          <Pressable style={styles.navButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={29} color={neon.blue} />
          </Pressable>
          <Text style={styles.navTitle}>Start Run</Text>
          <Pressable style={styles.navButton}>
            <Ionicons name="musical-notes" size={28} color={neon.purple} />
          </Pressable>
        </View>

        <CroppedArtworkCard image={mode.image} minHeight={224} imagePosition="top center">
          <View style={styles.selectedWrap}>
            <MaterialCommunityIcons name="crown" size={18} color={neon.pink} />
            <Text style={styles.selected}>SELECTED MODE</Text>
          </View>
          <View style={styles.infoRow}>
            <InfoPill icon="timer" accent="pink" label={`${mode.durationMin} min`} compact />
            <InfoPill icon="bolt" accent="lime" label={levelLabel(mode.level)} compact />
            <InfoPill icon="fire" accent="orange" label={mode.calorieRange} compact />
          </View>
        </CroppedArtworkCard>

        <SectionHeader title="Moves" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moveList}>
          {data.moves.map((move) => (
            <MoveCard key={move.id} move={move} compact />
          ))}
        </ScrollView>

        <SectionHeader title="Get Ready" />
        <View style={styles.readyGrid}>
          {data.readiness.map((item) => (
            <ReadinessCard key={item.id} item={item} compact />
          ))}
        </View>

        <Panel style={styles.rewardPanel}>
          <View style={styles.rewardCoin}>
            <IconBadge kind="coin" accent="orange" size={58} />
          </View>
          <View style={styles.rewardTextWrap}>
            <Text style={styles.rewardLabel}>REWARD</Text>
            <Text style={styles.rewardTitle}>+{mode.rewardCoins} coins</Text>
            <Text style={styles.rewardSub}>Finish the run to claim.</Text>
          </View>
          <View style={styles.rewardProgress}>
            <Text style={styles.progressTitle}>DAILY CHALLENGE PROGRESS</Text>
            <ProgressBar
              current={challenge.progress}
              target={challenge.target}
              accent="lime"
              label={`${challenge.progress} / ${challenge.target}`}
            />
            <Text style={styles.rewardSub}>{challenge.target - challenge.progress} more to unlock tomorrow's bonus.</Text>
          </View>
        </Panel>

        <View style={styles.countdown}>
          <IconBadge kind="timer" accent="pink" size={32} />
          <Text style={styles.countdownText}>
            Countdown starts in <Text style={{ color: accentColor('orange') }}>3... 2... 1...</Text>
          </Text>
        </View>

        <SectionHeader title="Choose Scene" />
        <View style={styles.sceneOptions}>
          <Panel style={styles.scenePanel}>
            <View style={styles.sceneIconWrap}>
              <IconBadge kind="home" accent="cyan" size={48} />
            </View>
            <View style={styles.sceneTextWrap}>
              <Text style={styles.sceneEyebrow}>NEW SCENE</Text>
              <Text style={styles.sceneTitle}>City Builder</Text>
              <Text style={styles.sceneSub}>
                Endless city runner built from the City Builder Bits model pack — real
                buildings, cars, and street props.
              </Text>
            </View>
            <GradientButton
              label="START CITY BUILDER"
              icon="runner"
              onPress={() => startRun('city-builder')}
            />
          </Panel>

          <Panel style={styles.scenePanel}>
            <View style={styles.sceneIconWrap}>
              <IconBadge kind="runner" accent="purple" size={48} />
            </View>
            <View style={styles.sceneTextWrap}>
              <Text style={styles.sceneEyebrow}>CURRENT SCENE</Text>
              <Text style={styles.sceneTitle}>Classic Runner</Text>
              <Text style={styles.sceneSub}>
                Current lightweight endless-runner track without the City Builder Bits model set.
              </Text>
            </View>
            <GradientButton
              label="START CURRENT"
              icon="runner"
              onPress={() => startRun('current')}
            />
          </Panel>
        </View>
      </NeonScreen>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: neon.bg,
  },
  screenContent: {
    gap: 15,
    paddingTop: 10,
  },
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: neon.border,
  },
  navTitle: {
    color: neon.text,
    fontSize: 25,
    fontWeight: '900',
  },
  selectedWrap: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: 'rgba(3,7,18,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(255,43,194,0.55)',
  },
  selected: {
    color: neon.pink,
    fontSize: 13,
    fontWeight: '900',
  },
  infoRow: {
    flexDirection: 'row',
    gap: 6,
  },
  moveList: {
    gap: 10,
    paddingRight: 18,
  },
  readyGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  rewardPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 13,
  },
  rewardCoin: {
    width: 60,
    alignItems: 'center',
  },
  rewardTextWrap: {
    flex: 0.95,
    gap: 3,
  },
  rewardLabel: {
    color: neon.pink,
    fontSize: 12,
    fontWeight: '900',
  },
  rewardTitle: {
    color: '#ffd800',
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '900',
  },
  rewardSub: {
    color: neon.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  rewardProgress: {
    flex: 1.4,
    gap: 6,
  },
  progressTitle: {
    color: neon.text,
    fontSize: 12,
    fontWeight: '900',
  },
  countdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  countdownText: {
    color: neon.pink,
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '900',
  },
  sceneOptions: {
    gap: 12,
  },
  scenePanel: {
    gap: 12,
    padding: 14,
  },
  sceneIconWrap: {
    alignSelf: 'flex-start',
  },
  sceneTextWrap: {
    gap: 4,
  },
  sceneEyebrow: {
    color: neon.lime,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  sceneTitle: {
    color: neon.text,
    fontSize: 22,
    fontWeight: '900',
  },
  sceneSub: {
    color: neon.muted,
    fontSize: 13,
    lineHeight: 18,
  },
});
