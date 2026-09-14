import Ionicons from '@expo/vector-icons/Ionicons';
import * as Device from 'expo-device';
import { Image } from 'expo-image';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RECORD_RUNS_BLURB } from '@/components/RunSettingsSheet';
import { Mascot, SectionHeader } from '@/components/ui';
import { logRunRecordingEnabled } from '@/lib/analytics';
import { useAuth } from '@/lib/AuthContext';
import { listClips, toFileUri, type Clip } from '@/lib/clipsLibrary';
import {
  loadCalibrationProfile,
  requestCalibrationGuidance,
  type CalibrationProfile,
} from '@/lib/calibrationProfile';
import { describeSeedBoards, seedBoardsNow } from '@/lib/functionsClient';
import { getMode, type IconName } from '@/lib/gameData';
import { DEFAULT_HUD_THEME_ID, hudThemeOptions, resolveHudTheme } from '@/lib/hudThemes';
import { loadPlaySetup, saveCalibrationBaseline, saveRecordRun, saveVoicePrompts } from '@/lib/playSetup';
import { isRunRecordingAvailable } from '@/lib/runRecording';
import { describeChartRebuild, fetchIsAdmin, rebuildChartsNow } from '@/lib/leaderboards';
import { levelBadges, nextRewardLevel } from '@/lib/levels';
import { useOnboarding } from '@/lib/OnboardingContext';
import { useProgress } from '@/lib/ProgressContext';
import { useSubscription } from '@/lib/SubscriptionContext';
import { requestSubscriptionAccess } from '@/lib/subscriptionAccess';
import { CLASS_ORDER } from '@/lib/progression';
import { PRIVACY_POLICY_URL, TERMS_URL, openLegalUrl } from '@/lib/legal';
import { colors, font, metric, radius, spacing } from '@/theme';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reopenWelcome } = useOnboarding();
  const { user, signOut, deleteAccount } = useAuth();
  const { isPremium, presentCustomerCenter, presentPaywall, restore } = useSubscription();
  const [restoring, setRestoring] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationProfile | null>(null);
  // "Record my runs" (default off) + the clips it produced. Re-read on focus so
  // a clip composed on the summary, or deleted on its own screen, shows up.
  const [recordRun, setRecordRun] = useState(false);
  // Spoken camera-check prompts ("Step back", "Hold still"), default on.
  const [voicePrompts, setVoicePrompts] = useState(true);
  const [clips, setClips] = useState<Clip[]>([]);
  const recordingDeviceCapable = Platform.OS === 'ios' && Device.isDevice && isRunRecordingAvailable;
  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadPlaySetup().then((setup) => {
        if (!active) return;
        setRecordRun(setup.recordRun);
        setVoicePrompts(setup.voicePrompts);
      });
      setClips(listClips());
      return () => {
        active = false;
      };
    }, []),
  );
  const handleRecordRunChange = useCallback((next: boolean) => {
    setRecordRun(next);
    void saveRecordRun(next);
    if (next) logRunRecordingEnabled();
  }, []);
  const handleVoicePromptsChange = useCallback((next: boolean) => {
    setVoicePrompts(next);
    void saveVoicePrompts(next);
  }, []);
  // Chart admin (owner): `admins/{uid}` exists. The callable re-checks server-side.
  const [isAdmin, setIsAdmin] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const uid = user?.id ?? null;
  useEffect(() => {
    let active = true;
    fetchIsAdmin(uid).then((admin) => {
      if (active) setIsAdmin(admin);
    });
    return () => {
      active = false;
    };
  }, [uid]);
  const forceRebuildCharts = useCallback(() => {
    if (rebuilding) return;
    setRebuilding(true);
    rebuildChartsNow()
      .then((levels) => Alert.alert('Charts rebuilt', describeChartRebuild(levels)))
      .catch((error: unknown) => Alert.alert('Rebuild failed', (error as Error).message))
      .finally(() => setRebuilding(false));
  }, [rebuilding]);
  const [seeding, setSeeding] = useState(false);
  const forceSeedBoards = useCallback(() => {
    if (seeding) return;
    setSeeding(true);
    seedBoardsNow()
      .then((result) => Alert.alert('Boards seeded', describeSeedBoards(result)))
      .catch((error: unknown) => Alert.alert('Seed failed', (error as Error).message))
      .finally(() => setSeeding(false));
  }, [seeding]);

  useEffect(() => {
    let active = true;
    loadCalibrationProfile()
      .then((profile) => {
        if (active) setCalibration(profile);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const calibrationStatus =
    calibration === null
      ? 'Checking…'
      : calibration.guidanceRequested
        ? 'Re-centers on your next run'
        : calibration.completedCount === 0
          ? 'Runs automatically on your first workout'
          : `Set up ${calibration.completedCount === 1 ? 'once' : `${calibration.completedCount} times`} · tap to re-center on your next run`;

  // Re-center: forget the once-per-session baseline so the next run does the
  // full three-second hold again, and re-arm the guided instructions.
  const handleRecalibrate = useCallback(() => {
    void saveCalibrationBaseline(null).catch(() => {});
    requestCalibrationGuidance()
      .then((profile) => setCalibration(profile))
      .catch(() => {});
    Alert.alert(
      'Re-center on your next run',
      'Your next run starts with the three-second camera check again.',
    );
  }, []);
  const {
    classData,
    longestStreak,
    totalRuns,
    coins,
    completedLevelIds,
    username,
    syncStatus,
    levelProgress,
    hudThemeId,
    setHudTheme,
  } = useProgress();

  const firstName = user?.name?.split(' ')[0] || username || 'Runner';
  const handle = username ? `@${username}` : user?.email ?? '@runner';
  const anyClassComplete = CLASS_ORDER.some((k) => classData(k).allComplete);

  // Level rewards derive from the effective level every render — nothing persisted.
  const level = levelProgress.level;
  const rewardBadges = levelBadges(level);
  const rewardBadgesEarned = rewardBadges.filter((b) => b.unlocked).length;
  const nextReward = nextRewardLevel(level);
  const themeOptions = hudThemeOptions(level);
  const activeTheme = resolveHudTheme(hudThemeId, level);

  const badges = [
    { icon: 'footsteps' as const, label: 'First Run', earned: totalRuns >= 1 },
    { icon: 'flame' as const, label: '7-Day', earned: longestStreak >= 7 },
    { icon: 'map' as const, label: 'Explorer', earned: completedLevelIds.size >= 6 },
    { icon: 'logo-bitcoin' as const, label: 'Coin 1K', earned: coins >= 1000 },
    { icon: 'trophy' as const, label: 'Class Clear', earned: anyClassComplete },
    { icon: 'star' as const, label: 'Premium', earned: isPremium },
  ];
  const earnedCount = badges.filter((b) => b.earned).length;

  const handleLogout = () => {
    Alert.alert(
      'Log out of CardioSurf?',
      'This removes the connected account from this device. Your local progress stays here.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            reopenWelcome();
            router.replace('/(onboarding)/welcome');
          },
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your cloud account and synced data. Local workout data on this device is not erased.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
              reopenWelcome();
              router.replace('/(onboarding)/welcome');
            } catch (error) {
              const code = (error as { code?: string })?.code;
              Alert.alert(
                'Could not delete account',
                code === 'auth/requires-recent-login'
                  ? 'For your security, log out and sign in again before deleting your account.'
                  : 'Your account was not deleted. Check your connection and try again.'
              );
            }
          },
        },
      ]
    );
  };

  const handleManageSubscription = async () => {
    const opened = await presentCustomerCenter();
    if (!opened) {
      Alert.alert(
        'Subscriptions unavailable',
        'Subscription management needs a development build with RevenueCat configured. It\u2019s not available in Expo Go.'
      );
    }
  };

  const handleUpgrade = async () => {
    await requestSubscriptionAccess(presentPaywall, router, { ifNeeded: true });
  };

  // Guideline 3.1.2 wants restore reachable from account settings, not only from
  // inside a paywall — the path a subscriber on a new device actually looks for.
  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const premium = await restore();
      if (premium === true) {
        Alert.alert('Subscription restored', 'CardioSurf Pro is active on this device.');
      } else if (premium === null) {
        Alert.alert(
          'Subscriptions unavailable',
          'Restoring needs a development build with RevenueCat configured. It\u2019s not available in Expo Go.'
        );
      } else {
        Alert.alert('Nothing to restore', 'No previous purchases were found for this Apple ID.');
      }
    } finally {
      setRestoring(false);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: spacing.md }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Mascot variant="avatar" size={84} />
        </View>
        <Text style={styles.name}>{firstName}</Text>
        <Text style={styles.handle}>{handle}</Text>
        <Text style={styles.sync}>
          {syncStatus === 'synced'
            ? 'Progress synced'
            : syncStatus === 'syncing'
              ? 'Syncing progress…'
              : syncStatus === 'error'
                ? 'Saved locally · sync will retry'
                : 'Saved on this device'}
        </Text>
      </View>

      {/* Badges */}
      <View style={styles.section}>
        <SectionHeader title="Badges" action={<Text style={styles.link}>{earnedCount} / {badges.length}</Text>} />
        <View style={styles.badgeGrid}>
          {badges.map((b) => (
            <View key={b.label} style={[styles.badge, !b.earned && styles.badgeLocked]}>
              <Ionicons
                name={b.icon}
                size={26}
                color={b.earned ? colors.lime : colors.textFaint}
              />
              <Text style={styles.badgeLabel}>{b.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Level rewards: badges unlocked by player level (1–50). */}
      <View style={styles.section}>
        <SectionHeader
          title="Level rewards"
          action={
            <Text style={styles.link}>
              Lv {level} · {rewardBadgesEarned} / {rewardBadges.length}
            </Text>
          }
        />
        <View style={styles.badgeGrid}>
          {rewardBadges.map((b) => (
            <View
              key={b.badge.id}
              style={[styles.badge, !b.unlocked && styles.badgeLocked]}
              accessible
              accessibilityLabel={`${b.badge.title}, level ${b.level}, ${b.unlocked ? 'unlocked' : 'locked'}`}
            >
              <Ionicons
                name={b.badge.icon as IconName}
                size={26}
                color={b.unlocked ? colors.lime : colors.textFaint}
              />
              <Text style={styles.badgeLabel}>{b.badge.title}</Text>
              <Text style={styles.badgeLevel}>{b.unlocked ? 'Unlocked' : `Level ${b.level}`}</Text>
            </View>
          ))}
        </View>
        {nextReward ? (
          <Text style={styles.sectionHint}>
            Next reward at level {nextReward} · {levelProgress.toNext.toLocaleString()} XP to level{' '}
            {Math.min(50, level + 1)}.
          </Text>
        ) : null}
      </View>

      {/* HUD theme: in-run overlay palette, unlocked by level. */}
      <View style={styles.section}>
        <SectionHeader
          title="HUD theme"
          action={<Text style={styles.link}>{activeTheme.name}</Text>}
        />
        <View style={styles.themeGrid}>
          {themeOptions.map(({ theme, unlockLevel, unlocked }) => {
            const selected = activeTheme.id === theme.id;
            return (
              <Pressable
                key={theme.id}
                disabled={!unlocked}
                onPress={() => setHudTheme(theme.id === DEFAULT_HUD_THEME_ID ? null : theme.id)}
                accessibilityRole="radio"
                accessibilityLabel={`${theme.name} HUD theme${unlocked ? '' : `, unlocks at level ${unlockLevel}`}`}
                accessibilityState={{ selected, disabled: !unlocked }}
                style={({ pressed }) => [
                  styles.themeChip,
                  selected && styles.themeChipSelected,
                  !unlocked && styles.badgeLocked,
                  pressed && unlocked && { opacity: 0.85 },
                ]}
              >
                <View style={[styles.themeSwatch, { backgroundColor: theme.accent }]}>
                  {!unlocked ? (
                    <Ionicons name="lock-closed" size={12} color={colors.black} />
                  ) : selected ? (
                    <Ionicons name="checkmark" size={13} color={colors.black} />
                  ) : null}
                </View>
                <Text style={styles.themeName} numberOfLines={1}>
                  {theme.name}
                </Text>
                <Text style={styles.themeMeta}>
                  {unlocked ? (selected ? 'Active' : 'Unlocked') : `Level ${unlockLevel}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.sectionHint}>{activeTheme.tagline}</Text>
      </View>

      {/* Clips: composed run videos kept on this phone (Documents/clips). */}
      <View style={styles.section}>
        <SectionHeader
          title="Clips"
          action={clips.length > 0 ? <Text style={styles.link}>{clips.length}</Text> : undefined}
        />
        {clips.length > 0 ? (
          <View style={styles.clipGrid}>
            {clips.map((clip) => {
              const levelName = getMode(clip.levelId)?.name ?? 'Run';
              return (
                <Pressable
                  key={clip.id}
                  onPress={() => router.push(`/clip/${clip.id}` as Href)}
                  accessibilityRole="button"
                  accessibilityLabel={`${levelName}, ${clip.score.toLocaleString()} points, ${formatShortDate(clip.createdAt)}. Open clip`}
                  style={({ pressed }) => [styles.clipTile, pressed && { opacity: 0.85 }]}
                >
                  {clip.thumbFilePath ? (
                    <Image source={{ uri: toFileUri(clip.thumbFilePath) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <View style={[StyleSheet.absoluteFill, styles.clipFallback]}>
                      <Ionicons name="film-outline" size={22} color={colors.textFaint} />
                    </View>
                  )}
                  <View style={styles.clipShade} />
                  <View style={styles.clipText}>
                    <Text style={styles.clipLevel} numberOfLines={1}>
                      {levelName}
                    </Text>
                    <Text style={styles.clipScore}>{clip.score.toLocaleString()}</Text>
                    <Text style={styles.clipDate}>{formatShortDate(clip.createdAt)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.clipEmpty}>
            <Text style={styles.settingHint}>
              {recordRun
                ? 'Recording is on. Your next finished run lands here.'
                : 'Your run clips will appear here.'}
            </Text>
            {!recordRun && recordingDeviceCapable ? (
              <Pressable
                onPress={() => handleRecordRunChange(true)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.clipEmptyBtn, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="videocam-outline" size={16} color={colors.black} />
                <Text style={styles.clipEmptyBtnText}>Turn on recording</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      {/* Leaderboard identity + friends */}
      <View style={styles.section}>
        <SectionHeader title="Leaderboards" />
        <Pressable
          onPress={() => router.push('/edit-username' as Href)}
          accessibilityRole="button"
          accessibilityLabel={`Change username. Currently ${handle}`}
          style={({ pressed }) => [styles.settingRow, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.settingLead}>
            <Text style={styles.settingText}>Username</Text>
            <Text style={styles.settingHint}>{handle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>
        <Pressable
          onPress={() => router.push('/find-friends' as Href)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.settingRow, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.settingText}>Find friends</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>
      </View>

      {/* Tracking */}
      <View style={styles.section}>
        <SectionHeader title="Tracking" />
        <Pressable
          onPress={handleRecalibrate}
          style={({ pressed }) => [styles.settingRow, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.settingLead}>
            <Text style={styles.settingText}>Body tracking setup</Text>
            <Text style={styles.settingHint}>{calibrationStatus}</Text>
          </View>
          <Ionicons name="refresh" size={18} color={colors.textFaint} />
        </Pressable>
        <View
          style={styles.settingRow}
          accessible
          accessibilityRole="switch"
          accessibilityLabel="Spoken prompts"
          accessibilityHint="Says “Step back” and “Hold still” during the camera check."
          accessibilityState={{ checked: voicePrompts }}
        >
          <View style={styles.settingLead}>
            <Text style={styles.settingText}>Spoken prompts</Text>
            <Text style={styles.settingHint}>Hear “Step back” and “Hold still” during the camera check.</Text>
          </View>
          <Switch
            value={voicePrompts}
            onValueChange={handleVoicePromptsChange}
            trackColor={{ true: colors.lime, false: colors.surface3 }}
            thumbColor={colors.white}
            ios_backgroundColor={colors.surface3}
          />
        </View>
        <View
          style={styles.settingRow}
          accessible
          accessibilityRole="switch"
          accessibilityLabel="Record my runs"
          accessibilityHint={recordingDeviceCapable ? RECORD_RUNS_BLURB : 'Not available in this build.'}
          accessibilityState={{ checked: recordRun, disabled: !recordingDeviceCapable }}
        >
          <View style={styles.settingLead}>
            <Text style={styles.settingText}>Record my runs</Text>
            <Text style={styles.settingHint}>
              {recordingDeviceCapable ? RECORD_RUNS_BLURB : 'Not available in this build.'}
            </Text>
          </View>
          <Switch
            value={recordRun}
            onValueChange={handleRecordRunChange}
            disabled={!recordingDeviceCapable}
            trackColor={{ true: colors.lime, false: colors.surface3 }}
            thumbColor={colors.white}
            ios_backgroundColor={colors.surface3}
          />
        </View>
      </View>

      {/* Support */}
      <View style={styles.section}>
        <SectionHeader title="Support" />
        <Pressable
          onPress={() => router.push('/faq')}
          style={({ pressed }) => [styles.settingRow, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.settingText}>FAQ</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>
        <Pressable
          onPress={() => router.push('/support')}
          style={({ pressed }) => [styles.settingRow, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.settingText}>Help & support</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>
        {isAdmin ? (
          <Pressable
            onPress={forceRebuildCharts}
            disabled={rebuilding}
            accessibilityRole="button"
            style={({ pressed }) => [styles.settingRow, (pressed || rebuilding) && { opacity: 0.85 }]}
          >
            <Text style={styles.settingText}>{rebuilding ? 'Rebuilding charts…' : 'Rebuild charts now (admin)'}</Text>
            <Ionicons name="cloud-upload-outline" size={18} color={colors.lime} />
          </Pressable>
        ) : null}
        {isAdmin ? (
          <Pressable
            onPress={forceSeedBoards}
            disabled={seeding}
            accessibilityRole="button"
            style={({ pressed }) => [styles.settingRow, (pressed || seeding) && { opacity: 0.85 }]}
          >
            <Text style={styles.settingText}>{seeding ? 'Seeding boards…' : 'Seed boards now (admin)'}</Text>
            <Ionicons name="people-outline" size={18} color={colors.lime} />
          </Pressable>
        ) : null}
        {__DEV__ ? (
          <>
            <Pressable
              onPress={() => router.push('/debug-funnel')}
              style={({ pressed }) => [styles.settingRow, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.settingText}>Analytics funnel (debug)</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/dev-beatmap' as Href)}
              style={({ pressed }) => [styles.settingRow, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.settingText}>Beatmap authoring (debug)</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </Pressable>
          </>
        ) : null}
      </View>

      {/* Legal */}
      <View style={styles.section}>
        <SectionHeader title="Legal" />
        <Pressable
          onPress={() => openLegalUrl(PRIVACY_POLICY_URL)}
          style={({ pressed }) => [styles.settingRow, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.settingText}>Privacy Policy</Text>
          <Ionicons name="open-outline" size={18} color={colors.textFaint} />
        </Pressable>
        <Pressable
          onPress={() => openLegalUrl(TERMS_URL)}
          style={({ pressed }) => [styles.settingRow, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.settingText}>Terms & Conditions</Text>
          <Ionicons name="open-outline" size={18} color={colors.textFaint} />
        </Pressable>
      </View>

      {/* Account */}
      <View style={styles.section}>
        <SectionHeader title="Account" />
        {isPremium ? (
          <Pressable
            onPress={handleManageSubscription}
            style={({ pressed }) => [styles.settingRow, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.settingText}>Manage subscription</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
        ) : (
          <>
            <Pressable
              onPress={handleUpgrade}
              style={({ pressed }) => [styles.upgradeRow, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="sparkles" size={18} color={colors.lime} />
              <Text style={styles.upgradeText}>Upgrade to Pro</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.lime} />
            </Pressable>
            <Pressable
              disabled={restoring}
              onPress={handleRestore}
              style={({ pressed }) => [styles.settingRow, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.settingText}>
                {restoring ? 'Restoring…' : 'Restore purchases'}
              </Text>
              <Ionicons name="refresh" size={18} color={colors.textFaint} />
            </Pressable>
          </>
        )}
        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [styles.logoutRow, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.lime} />
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>
        <Pressable
          onPress={handleDeleteAccount}
          style={({ pressed }) => [styles.deleteRow, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.deleteText}>Delete Account</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function formatShortDate(epochMs: number): string {
  const date = new Date(epochMs);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  clipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  clipTile: {
    width: '31%',
    flexGrow: 1,
    maxWidth: '32%',
    aspectRatio: 9 / 14,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'flex-end',
  },
  clipFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  clipShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
    backgroundColor: 'rgba(8,9,10,0.62)',
  },
  clipText: { padding: spacing.sm, gap: 1 },
  clipLevel: { color: colors.text, fontSize: 11, fontWeight: font.bold },
  clipScore: { ...metric, color: colors.lime, fontSize: 15, fontWeight: font.heavy, letterSpacing: -0.3 },
  clipDate: { ...metric, color: colors.textDim, fontSize: 10, fontWeight: font.semibold },
  clipEmpty: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clipEmptyBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.button,
    backgroundColor: colors.lime,
  },
  clipEmptyBtnText: { color: colors.black, fontSize: 13, fontWeight: font.heavy, letterSpacing: 0.4 },
  header: { alignItems: 'center', gap: 4, marginTop: spacing.sm },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  name: { color: colors.text, fontSize: 24, fontWeight: font.black, letterSpacing: -0.4 },
  handle: { color: colors.textDim, fontSize: 14, fontWeight: font.medium },
  sync: { color: colors.textFaint, fontSize: 12, fontWeight: font.medium, marginTop: 2 },
  section: { gap: spacing.sm },
  link: { color: colors.lime, fontSize: 14, fontWeight: font.bold },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: {
    width: '31%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeLocked: { opacity: 0.45 },
  badgeLabel: { color: colors.text, fontSize: 12, fontWeight: font.semibold },
  badgeLevel: { ...metric, color: colors.textFaint, fontSize: 10, fontWeight: font.bold },
  sectionHint: { color: colors.textFaint, fontSize: 12, lineHeight: 16, fontWeight: font.medium },
  themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  themeChip: {
    width: '23%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 5,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  themeChipSelected: { borderColor: colors.lime, backgroundColor: colors.surface2 },
  themeSwatch: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  themeName: { color: colors.text, fontSize: 12, fontWeight: font.semibold },
  themeMeta: { ...metric, color: colors.textFaint, fontSize: 10, fontWeight: font.bold },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingText: { color: colors.text, fontSize: 15, fontWeight: font.semibold },
  settingLead: { flex: 1, gap: 3, paddingRight: spacing.md },
  settingHint: { color: colors.textFaint, fontSize: 12, lineHeight: 16, fontWeight: font.medium },
  upgradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lime,
  },
  upgradeText: { flex: 1, color: colors.lime, fontSize: 15, fontWeight: font.bold },
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lime,
  },
  logoutText: { color: colors.lime, fontSize: 15, fontWeight: font.bold },
  deleteRow: { alignItems: 'center', paddingVertical: spacing.sm },
  deleteText: { color: colors.textFaint, fontSize: 13, fontWeight: font.semibold },
});
