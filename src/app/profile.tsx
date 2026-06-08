import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CoinPill, IconBadge, NeonScreen, Panel, ProgressBar, accentColor, neon } from '@/components/neon/NeonUi';
import { BottomTabBar } from '@/components/BottomTabBar';
import { useRunnerUiData } from '@/hooks/useRunnerUiData';
import type { Achievement, RunMode, UiAccent, UiIconKind } from '@/lib/run-ui-data';
import { percent } from '@/lib/run-ui-data';

export default function ProfileScreen() {
  const router = useRouter();
  const { data } = useRunnerUiData();
  const user = data.user;

  return (
    <View style={styles.root}>
      <NeonScreen contentStyle={styles.screenContent}>
        <View style={styles.topRow}>
          <View style={styles.streakPill}>
            <IconBadge kind="fire" accent="orange" size={30} />
            <Text style={styles.streakText}>{user.streakDays} DAY STREAK</Text>
          </View>
          <CoinPill coins={user.coins} />
          <Pressable style={styles.settingsCircle} onPress={() => router.push('/settings')}>
            <MaterialCommunityIcons name="cog" size={28} color={neon.text} />
          </Pressable>
        </View>

        <View style={styles.profileHero}>
          <ExpoImage source={data.homeHeroImage} style={styles.heroImage} contentFit="cover" contentPosition="top center" />
          <LinearGradient
            colors={['rgba(3,7,18,0.16)', 'rgba(3,7,18,0.56)', 'rgba(3,7,18,0.98)']}
            locations={[0, 0.45, 1]}
            style={styles.heroShade}
          />

          <View style={styles.profileMain}>
            <View style={styles.avatarWrap}>
              <ExpoImage source={user.avatarImage} style={styles.profileAvatar} contentFit="cover" contentPosition="center" />
              <Pressable style={styles.editButton} onPress={() => router.push('/settings')}>
                <MaterialCommunityIcons name="pencil" size={18} color={neon.text} />
              </Pressable>
            </View>

            <View style={styles.profileCopy}>
              <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit>
                {user.name}
              </Text>
              <View style={styles.levelLine}>
                <Text style={styles.levelBadge}>Lv. {user.level}</Text>
                <Text style={styles.xpText}>
                  {user.xp.toLocaleString()} / {user.nextLevelXp.toLocaleString()} XP
                </Text>
              </View>
              <ProgressBar current={user.xp} target={user.nextLevelXp} accent="purple" />
              <View style={styles.titleLine}>
                <MaterialCommunityIcons name="crown" size={21} color={neon.lime} />
                <Text style={styles.runnerTitle}>{user.title}</Text>
              </View>
              <Text style={styles.bio}>Run hard. Stay neon. Keep moving.</Text>
            </View>
          </View>

          <View style={styles.socialStrip}>
            <ProfileNumber label="Followers" value={user.followers} icon="users" accent="pink" />
            <View style={styles.socialDivider} />
            <ProfileNumber label="Following" value={user.following} icon="users" accent="cyan" />
            <View style={styles.socialDivider} />
            <ProfileNumber label="Total Runs" value={user.totalRuns} icon="shoe" accent="lime" />
          </View>
        </View>

        <Panel style={styles.badgesPanel}>
          <ProfileSectionTitle title="My Badges" icon="trophy" actionLabel="View all" />
          <View style={styles.badgeRow}>
            {data.badges.map((badge) => (
              <BadgeCard key={badge.id} badge={badge} />
            ))}
          </View>
        </Panel>

        <Panel style={styles.goalSection}>
          <ProfileSectionTitle title="Workout Goals" icon="timer" actionLabel="View progress" />
          <View style={styles.goalRow}>
            {data.workoutGoals.map((goal) => (
              <WorkoutGoalCard key={goal.id} goal={goal} />
            ))}
          </View>
        </Panel>

        <Panel style={styles.favoriteSection}>
          <ProfileSectionTitle title="Favorite Modes" icon="trophy" actionLabel="View all" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.favoriteRail}>
            {[data.featuredMode, ...data.modes.slice(0, 3)].map((mode) => (
              <FavoriteModeCard key={mode.id} mode={mode} onPress={() => router.push('/start-run')} />
            ))}
          </ScrollView>
        </Panel>

        <Panel style={styles.settingsPanel}>
          <ProfileSectionTitle title="Settings" icon="settings" />
          <View style={styles.settingList}>
            {data.settings.map((item) => (
              <Pressable key={item.id} style={styles.settingRow} onPress={() => router.push('/settings')}>
                <IconBadge kind={item.icon} accent="blue" size={30} />
                <Text style={styles.settingLabel}>{item.label}</Text>
                <MaterialCommunityIcons name="chevron-right" size={24} color={neon.muted} />
              </Pressable>
            ))}
          </View>
        </Panel>
      </NeonScreen>
      <BottomTabBar />
    </View>
  );
}

function ProfileSectionTitle({
  title,
  icon,
  actionLabel,
}: {
  title: string;
  icon: UiIconKind;
  actionLabel?: string;
}) {
  return (
    <View style={styles.sectionTitleRow}>
      <View style={styles.sectionName}>
        <IconBadge kind={icon} accent="pink" size={28} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {actionLabel ? (
        <Text style={styles.sectionAction}>
          {actionLabel} <MaterialCommunityIcons name="chevron-right" size={16} />
        </Text>
      ) : null}
    </View>
  );
}

function ProfileNumber({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: 'users' | 'shoe';
  accent: UiAccent;
}) {
  return (
    <View style={styles.profileNumber}>
      <IconBadge kind={icon} accent={accent} size={30} />
      <View>
        <Text style={styles.profileNumberValue}>{value}</Text>
        <Text style={styles.profileNumberLabel}>{label}</Text>
      </View>
    </View>
  );
}

function BadgeCard({ badge }: { badge: Achievement }) {
  const color = accentColor(badge.accent);

  return (
    <View style={[styles.badgeCard, { borderColor: `${color}66` }]}>
      <LinearGradient colors={[`${color}33`, 'rgba(17,22,41,0.2)']} style={styles.badgeIconGlow}>
        <IconBadge kind={badge.icon} accent={badge.accent} size={48} />
      </LinearGradient>
      <Text style={[styles.badgeTitle, { color }]} numberOfLines={2}>
        {badge.title}
      </Text>
      <Text style={styles.badgeSub} numberOfLines={1}>
        {badge.subtitle}
      </Text>
      {badge.completed ? <IconBadge kind="check" accent="lime" size={22} /> : null}
    </View>
  );
}

function WorkoutGoalCard({ goal }: { goal: Achievement }) {
  const color = accentColor(goal.accent);
  const current = goal.progress ?? 0;
  const target = goal.target ?? 1;
  const filledSegments = Math.round(percent(current, target) * 5);

  return (
    <View style={[styles.goalCard, { borderColor: `${color}77` }]}>
      <View style={[styles.goalIcon, { borderColor: color, backgroundColor: `${color}1f` }]}>
        <IconBadge kind={goal.icon} accent={goal.accent} size={48} />
      </View>
      <View style={styles.goalCopy}>
        <Text style={styles.goalTitle}>{goal.title}</Text>
        <Text style={styles.goalValue}>
          {current}
          <Text style={styles.goalTarget}> / {target}</Text>
        </Text>
        <Text style={[styles.goalStatus, { color }]}>{goal.subtitle}</Text>
      </View>
      <View style={styles.goalSegments}>
        {Array.from({ length: 5 }).map((_, index) => (
          <View key={index} style={[styles.goalSegment, { backgroundColor: index < filledSegments ? color : 'rgba(255,255,255,0.14)' }]} />
        ))}
      </View>
      {goal.completed ? (
        <View style={[styles.goalCheck, { backgroundColor: color }]}>
          <MaterialCommunityIcons name="check" size={18} color={neon.bg} />
        </View>
      ) : null}
    </View>
  );
}

function FavoriteModeCard({ mode, onPress }: { mode: RunMode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.favoriteCard, pressed && styles.pressed]}>
      <ExpoImage
        source={mode.image}
        style={styles.favoriteImage}
        contentFit="cover"
        contentPosition={mode.imagePosition ?? 'center'}
      />
      <LinearGradient colors={['rgba(3,7,18,0.02)', 'rgba(3,7,18,0.78)']} style={styles.favoriteShade} />
      {!mode.imageHasText ? (
        <Text style={styles.favoriteTitle} numberOfLines={2}>
          {mode.title}
        </Text>
      ) : null}
      <View style={styles.favoriteHeart}>
        <MaterialCommunityIcons name="heart" size={18} color={neon.pink} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: neon.bg,
  },
  screenContent: {
    gap: 16,
    paddingTop: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  streakPill: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,122,16,0.65)',
    backgroundColor: 'rgba(255,122,16,0.08)',
  },
  streakText: {
    color: neon.text,
    fontSize: 13,
    fontWeight: '900',
  },
  settingsCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: neon.border,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  profileHero: {
    minHeight: 270,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1.2,
    borderColor: 'rgba(141,53,255,0.55)',
    backgroundColor: neon.panel,
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  heroShade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  profileMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    paddingBottom: 8,
  },
  avatarWrap: {
    width: 122,
    height: 122,
  },
  profileAvatar: {
    width: 122,
    height: 122,
    borderRadius: 61,
    borderWidth: 4,
    borderColor: neon.purple,
    backgroundColor: neon.panel2,
  },
  editButton: {
    position: 'absolute',
    right: -4,
    bottom: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: neon.border,
    backgroundColor: 'rgba(9,13,29,0.94)',
  },
  profileCopy: {
    flex: 1,
    minWidth: 0,
    gap: 7,
  },
  name: {
    color: neon.text,
    fontSize: 32,
    fontWeight: '900',
  },
  levelLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  levelBadge: {
    color: neon.text,
    fontSize: 14,
    fontWeight: '900',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(141,53,255,0.42)',
    borderWidth: 1,
    borderColor: neon.purple,
  },
  xpText: {
    flexShrink: 1,
    color: neon.text,
    fontSize: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  runnerTitle: {
    color: neon.lime,
    fontSize: 18,
    fontWeight: '900',
  },
  bio: {
    color: neon.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  socialStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 18,
  },
  socialDivider: {
    width: 1,
    height: 34,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  profileNumber: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minWidth: 0,
  },
  profileNumberValue: {
    color: neon.text,
    fontSize: 19,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  profileNumberLabel: {
    color: neon.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  badgesPanel: {
    gap: 13,
    borderColor: 'rgba(255,43,194,0.45)',
  },
  goalSection: {
    gap: 13,
  },
  favoriteSection: {
    gap: 13,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  sectionTitle: {
    color: neon.text,
    fontSize: 17,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  sectionAction: {
    color: neon.pink,
    fontSize: 13,
    fontWeight: '900',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  badgeCard: {
    flex: 1,
    minHeight: 136,
    alignItems: 'center',
    gap: 5,
    padding: 7,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(17,22,41,0.72)',
  },
  badgeIconGlow: {
    width: 58,
    height: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeTitle: {
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '900',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  badgeSub: {
    color: neon.muted,
    fontSize: 10,
    textAlign: 'center',
  },
  goalRow: {
    flexDirection: 'row',
    gap: 10,
  },
  goalCard: {
    flex: 1,
    minHeight: 146,
    padding: 10,
    borderRadius: 16,
    borderWidth: 1.2,
    backgroundColor: 'rgba(17,22,41,0.78)',
    overflow: 'hidden',
  },
  goalIcon: {
    position: 'absolute',
    left: 10,
    top: 12,
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.2,
  },
  goalCopy: {
    paddingLeft: 78,
    gap: 1,
  },
  goalTitle: {
    color: neon.text,
    fontSize: 13,
    fontWeight: '900',
  },
  goalValue: {
    color: neon.text,
    fontSize: 26,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  goalTarget: {
    color: neon.muted,
    fontSize: 18,
  },
  goalStatus: {
    fontSize: 12,
    fontWeight: '900',
  },
  goalSegments: {
    position: 'absolute',
    left: 10,
    right: 42,
    bottom: 14,
    flexDirection: 'row',
    gap: 4,
  },
  goalSegment: {
    flex: 1,
    height: 10,
    borderRadius: 999,
  },
  goalCheck: {
    position: 'absolute',
    right: 10,
    bottom: 7,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favoriteRail: {
    gap: 9,
    paddingRight: 18,
  },
  favoriteCard: {
    width: 112,
    height: 104,
    borderRadius: 13,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(141,53,255,0.75)',
    backgroundColor: neon.panel2,
  },
  favoriteImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  favoriteShade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  favoriteTitle: {
    position: 'absolute',
    left: 8,
    right: 28,
    bottom: 8,
    color: neon.text,
    fontSize: 12,
    fontWeight: '900',
  },
  favoriteHeart: {
    position: 'absolute',
    right: 7,
    bottom: 7,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(3,7,18,0.72)',
  },
  settingsPanel: {
    gap: 9,
  },
  settingList: {
    gap: 0,
  },
  settingRow: {
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  settingLabel: {
    flex: 1,
    color: neon.text,
    fontSize: 14,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
});
