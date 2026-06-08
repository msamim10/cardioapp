import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { AppHeader, ChallengeFeatureCard, ChallengeRow, IconBadge, NeonScreen, Panel, ProgressBar, accentColor, neon } from '@/components/neon/NeonUi';
import { BottomTabBar } from '@/components/BottomTabBar';
import { useRunnerUiData } from '@/hooks/useRunnerUiData';

type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const tabs: { label: string; icon: MaterialIconName }[] = [
  { label: 'Daily', icon: 'calendar-month' },
  { label: 'Weekly', icon: 'calendar-week' },
  { label: 'Events', icon: 'star' },
  { label: 'Friends', icon: 'account-group' },
];

export default function ChallengesScreen() {
  const router = useRouter();
  const { data } = useRunnerUiData();

  return (
    <View style={styles.root}>
      <NeonScreen contentStyle={styles.screenContent}>
        <AppHeader user={data.user} onActionPress={() => router.push('/settings')} />

        <View style={styles.titleBlock}>
          <MaterialCommunityIcons name="crown-outline" size={36} color="#ffd800" style={styles.titleCrown} />
          <MaterialCommunityIcons name="trophy-outline" size={78} color={neon.purple} style={styles.titleTrophy} />
          <MaterialCommunityIcons name="emoticon-dead-outline" size={42} color={neon.lime} style={styles.titleSmile} />
          <Text style={styles.title}>CHALLENGES</Text>
          <Text style={styles.subtitle}>Complete missions, earn rewards</Text>
        </View>

        <View style={styles.tabs}>
          {tabs.map((tab, index) => (
            <View key={tab.label} style={[styles.tab, index === 0 && styles.tabActive]}>
              <MaterialCommunityIcons
                name={tab.icon}
                size={18}
                color={index === 0 ? neon.pink : neon.muted}
              />
              <Text style={[styles.tabText, index === 0 && styles.tabTextActive]}>{tab.label}</Text>
            </View>
          ))}
        </View>

        <ChallengeFeatureCard challenge={data.dailyChallenge} />

        <View style={styles.challengeList}>
          {data.challenges.map((challenge) => (
            <ChallengeRow key={challenge.id} challenge={challenge} />
          ))}
        </View>

        <Panel style={styles.eventPanel}>
          <View style={styles.eventLeft}>
            <View style={styles.eventCrownBox}>
              <MaterialCommunityIcons name="crown" size={72} color="#ffd800" />
            </View>
            <View>
              <Text style={styles.eventKicker}>EVENT CHALLENGE</Text>
              <Text style={styles.eventTitle}>WEEKEND CROWN RUSH</Text>
              <Text style={styles.eventSub}>Score big. Climb higher. Earn epic rewards.</Text>
              <View style={styles.eventTimer}>
                <IconBadge kind="timer" accent="pink" size={26} />
                <Text style={styles.eventTimerText}>Ends in 2d 18h</Text>
              </View>
            </View>
          </View>
          <View style={styles.runners}>
            <Text style={styles.runnersTitle}>TOP RUNNERS</Text>
            {['ArjunX', 'NeonDev', 'Speedy93'].map((name, index) => (
              <View key={name} style={styles.runnerRow}>
                <Text style={styles.runnerRank}>{index + 1}</Text>
                <Text style={styles.runnerName}>{name}</Text>
              </View>
            ))}
          </View>
        </Panel>

        <Panel style={styles.chestPanel}>
          <View style={styles.chestHeader}>
            <View style={styles.chestIcon}>
              <MaterialCommunityIcons name="treasure-chest" size={42} color="#ffd800" />
            </View>
            <View style={styles.chestCopy}>
              <Text style={styles.chestTitle}>DAILY CHALLENGE CHEST</Text>
              <Text style={styles.chestSub}>Complete today's challenges to unlock.</Text>
            </View>
          </View>
          <View style={styles.chestTrack}>
            <View style={styles.chestLine} />
            {[3, 6, 6, 9, 12].map((value, index) => (
              <View key={`${value}-${index}`} style={styles.chestStep}>
                <MaterialCommunityIcons
                  name="treasure-chest"
                  size={index === 0 ? 30 : 24}
                  color={index === 0 ? neon.lime : index === 4 ? '#ffd800' : neon.purple}
                />
              </View>
            ))}
          </View>
          <View style={styles.milestoneRow}>
            {[3, 6, 9, 12].map((value) => (
              <Text key={value} style={[styles.milestone, value === 3 && { color: accentColor('lime') }]}>
                {value}
              </Text>
            ))}
          </View>
        </Panel>
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
  screenContent: {
    gap: 14,
  },
  titleBlock: {
    minHeight: 120,
    justifyContent: 'center',
    marginTop: -2,
  },
  title: {
    color: neon.text,
    fontSize: 46,
    lineHeight: 54,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 0,
    textShadowColor: 'rgba(255,43,194,0.75)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  subtitle: {
    color: neon.muted,
    fontSize: 17,
    fontWeight: '700',
    marginLeft: 56,
    marginTop: -5,
  },
  titleCrown: {
    position: 'absolute',
    left: 1,
    top: 20,
    transform: [{ rotate: '-16deg' }],
  },
  titleTrophy: {
    position: 'absolute',
    right: 34,
    top: 9,
    textShadowColor: 'rgba(141,53,255,0.45)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  titleSmile: {
    position: 'absolute',
    right: 92,
    bottom: 20,
  },
  tabs: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 17,
    backgroundColor: 'rgba(17,22,41,0.82)',
    borderWidth: 1,
    borderColor: neon.border,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
  },
  tabActive: {
    backgroundColor: 'rgba(255,43,194,0.16)',
    borderWidth: 1,
    borderColor: neon.pink,
  },
  tabText: {
    color: neon.muted,
    fontSize: 14,
    fontWeight: '900',
  },
  tabTextActive: {
    color: neon.text,
  },
  challengeList: {
    gap: 10,
  },
  eventPanel: {
    flexDirection: 'row',
    gap: 14,
    borderColor: 'rgba(255,43,194,0.65)',
    backgroundColor: 'rgba(74,12,119,0.54)',
  },
  eventLeft: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minWidth: 0,
  },
  eventCrownBox: {
    width: 92,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(255,122,16,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,43,194,0.36)',
  },
  eventKicker: {
    color: neon.pink,
    fontSize: 12,
    fontWeight: '900',
  },
  eventTitle: {
    color: neon.text,
    fontSize: 22,
    fontWeight: '900',
    fontStyle: 'italic',
  },
  eventSub: {
    color: neon.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  eventTimer: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  eventTimerText: {
    color: neon.pink,
    fontWeight: '900',
  },
  runners: {
    width: 120,
    gap: 6,
    borderLeftWidth: 1,
    borderLeftColor: neon.border,
    paddingLeft: 12,
  },
  runnersTitle: {
    color: neon.pink,
    fontSize: 12,
    fontWeight: '900',
  },
  runnerRow: {
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
  },
  runnerRank: {
    width: 22,
    height: 22,
    borderRadius: 11,
    color: neon.bg,
    backgroundColor: '#ffd800',
    textAlign: 'center',
    fontWeight: '900',
  },
  runnerName: {
    color: neon.text,
    fontSize: 12,
    fontWeight: '800',
  },
  chestPanel: {
    gap: 14,
    borderColor: 'rgba(255,43,194,0.65)',
    backgroundColor: 'rgba(66,12,110,0.44)',
  },
  chestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chestCopy: {
    flex: 1,
  },
  chestIcon: {
    width: 58,
    height: 58,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,122,16,0.12)',
  },
  chestTitle: {
    color: '#ffd800',
    fontSize: 15,
    fontWeight: '900',
  },
  chestSub: {
    color: neon.muted,
    fontSize: 13,
  },
  chestTrack: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  chestLine: {
    position: 'absolute',
    left: 24,
    right: 24,
    height: 4,
    borderRadius: 999,
    backgroundColor: neon.purple,
  },
  chestStep: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(9,13,29,0.86)',
  },
  milestoneRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  milestone: {
    color: neon.muted,
    fontSize: 12,
    fontWeight: '900',
  },
});
