import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppHeader, CroppedArtworkCard, GradientButton, IconBadge, ModeTile, NeonScreen, RecommendedRunRow, SectionHeader, accentColor, neon } from '@/components/neon/NeonUi';
import { BottomTabBar } from '@/components/BottomTabBar';
import { useRunnerUiData } from '@/hooks/useRunnerUiData';
import { levelLabel } from '@/lib/run-ui-data';

export default function PlayScreen() {
  const router = useRouter();
  const { data } = useRunnerUiData();
  const featured = data.featuredMode;
  const featuredMeta = [
    { key: 'duration', icon: 'timer', accent: 'pink', label: `${featured.durationMin} min` },
    { key: 'calories', icon: 'fire', accent: 'orange', label: featured.calorieRange },
    { key: 'level', icon: 'bolt', accent: 'lime', label: levelLabel(featured.level) },
  ] as const;

  return (
    <View style={styles.root}>
      <NeonScreen contentStyle={styles.playContent}>
        <AppHeader user={data.user} action="search" onActionPress={() => undefined} />

        <View style={styles.titleBlock}>
          <MaterialCommunityIcons name="crown-outline" size={31} color={neon.pink} style={styles.titleCrown} />
          <MaterialCommunityIcons name="emoticon-dead-outline" size={62} color={neon.lime} style={styles.titleSmile} />
          <Text style={styles.pageTitle}>PLAY</Text>
          <Text style={styles.subtitle}>Choose your next run</Text>
        </View>

        <CroppedArtworkCard image={featured.image} minHeight={236} imagePosition="left center">
          <View style={styles.featuredTopRow}>
            <Text style={styles.kicker}>FEATURED MAP</Text>
            <View style={styles.hotPick}>
              <IconBadge kind="fire" accent="orange" size={22} />
              <Text style={styles.hotPickText}>HOT PICK</Text>
            </View>
          </View>
          <View style={styles.featuredControls}>
            <View style={styles.featuredMetaStack}>
              {featuredMeta.map((item) => (
                <View key={item.key} style={styles.featuredMetaLine}>
                  <IconBadge kind={item.icon} accent={item.accent} size={18} />
                  <Text style={styles.featuredMetaText} numberOfLines={1} adjustsFontSizeToFit>
                    {item.label}
                  </Text>
                </View>
              ))}
            </View>
            <View style={styles.featuredButton}>
              <GradientButton label="PLAY NOW" icon="runner" compact onPress={() => router.push('/start-run')} />
            </View>
          </View>
        </CroppedArtworkCard>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {['Beginner', 'Fat Burn', 'Endless', '5 min', '10 min'].map((label, index) => (
            <View key={label} style={styles.filterChip}>
              <IconBadge
                kind={index === 1 ? 'fire' : index === 2 ? 'play' : index > 2 ? 'timer' : 'bolt'}
                accent={index === 1 ? 'orange' : index === 2 ? 'pink' : index > 2 ? 'cyan' : 'lime'}
                size={24}
              />
              <Text style={styles.filterLabel}>{label}</Text>
            </View>
          ))}
        </ScrollView>

        <SectionHeader title="Maps & Modes" actionLabel="View all" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeList}>
          {data.modes.map((mode) => (
            <ModeTile key={mode.id} mode={mode} compact onPress={() => router.push('/start-run')} />
          ))}
        </ScrollView>

        <SectionHeader title="Recommended For You" />
        <View style={styles.runList}>
          {data.recommendedRuns.map((mode) => (
            <RecommendedRunRow key={mode.id} mode={mode} onPress={() => router.push('/start-run')} />
          ))}
        </View>

        <View style={styles.quickStart}>
          <LinearGradient
            colors={['rgba(69,10,116,0.96)', 'rgba(34,8,71,0.94)', 'rgba(8,13,31,0.96)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.quickStartInner}
          >
            <Text style={styles.quickArrowGhost} numberOfLines={1}>
              &gt;&gt;&gt;
            </Text>
            <View style={styles.quickIcon}>
              <Ionicons name="flash" size={32} color={accentColor('lime')} />
            </View>
            <View style={styles.quickCopy}>
              <Text style={styles.quickTitle} numberOfLines={1} adjustsFontSizeToFit>
                QUICK START
              </Text>
              <Text style={styles.quickSub} numberOfLines={2}>
                Random map, 5 min run. Get moving now.
              </Text>
            </View>
            <Pressable onPress={() => router.push('/start-run')} style={({ pressed }) => [styles.quickButtonWrap, pressed && styles.pressed]}>
              <LinearGradient
                colors={['#ff7a16', '#ff23bc']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.quickButton}
              >
                <Text style={styles.quickButtonText} numberOfLines={1} adjustsFontSizeToFit>
                  START RUN
                </Text>
                <Text style={styles.quickButtonArrow}>&gt;&gt;</Text>
              </LinearGradient>
            </Pressable>
          </LinearGradient>
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
  playContent: {
    paddingTop: 8,
    gap: 14,
  },
  titleBlock: {
    minHeight: 92,
    justifyContent: 'center',
    marginTop: -4,
  },
  pageTitle: {
    color: neon.text,
    fontSize: 51,
    lineHeight: 58,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 0,
    textShadowColor: 'rgba(255,43,194,0.7)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  subtitle: {
    color: neon.text,
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 58,
    marginTop: -12,
  },
  titleCrown: {
    position: 'absolute',
    left: -2,
    top: 14,
    transform: [{ rotate: '-15deg' }],
  },
  titleSmile: {
    position: 'absolute',
    right: 28,
    top: 7,
    textShadowColor: 'rgba(185,255,0,0.3)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  featuredTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  kicker: {
    color: neon.lime,
    fontSize: 12,
    fontWeight: '900',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: 'rgba(3,7,18,0.68)',
  },
  hotPick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,43,194,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  hotPickText: {
    color: neon.text,
    fontSize: 11,
    fontWeight: '900',
  },
  featuredControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginHorizontal: -16,
    marginBottom: -16,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: 'rgba(3,7,18,0.9)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,43,194,0.5)',
  },
  featuredMetaStack: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  featuredMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  featuredMetaText: {
    flex: 1,
    minWidth: 0,
    color: neon.text,
    fontSize: 11,
    fontWeight: '900',
  },
  featuredButton: {
    width: '48%',
    minWidth: 156,
    maxWidth: 174,
    flexShrink: 0,
  },
  filterRow: {
    gap: 10,
    paddingRight: 18,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: neon.border,
    backgroundColor: 'rgba(17,22,41,0.82)',
  },
  filterLabel: {
    color: neon.text,
    fontSize: 14,
    fontWeight: '900',
  },
  modeList: {
    gap: 8,
    paddingRight: 18,
  },
  runList: {
    gap: 10,
  },
  quickStart: {
    minHeight: 78,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,43,194,0.8)',
    backgroundColor: neon.panel,
  },
  quickStartInner: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  quickIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(185,255,0,0.78)',
    backgroundColor: 'rgba(185,255,0,0.12)',
    zIndex: 1,
  },
  quickCopy: {
    flex: 1,
    minWidth: 96,
    zIndex: 1,
  },
  quickTitle: {
    color: neon.lime,
    fontSize: 17,
    lineHeight: 20,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 0,
  },
  quickSub: {
    color: neon.text,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
  },
  quickArrowGhost: {
    position: 'absolute',
    left: '35%',
    top: 8,
    color: 'rgba(185,255,0,0.13)',
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 0,
  },
  quickButtonWrap: {
    width: 146,
    flexShrink: 0,
    zIndex: 1,
  },
  quickButton: {
    minHeight: 48,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.34)',
    boxShadow: '0 8px 20px rgba(255,35,188,0.35)',
  },
  quickButtonText: {
    flexShrink: 1,
    color: neon.text,
    fontSize: 17,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 0,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  quickButtonArrow: {
    color: neon.text,
    fontSize: 18,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
});
