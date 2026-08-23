import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Mascot, SectionHeader } from '@/components/ui';
import { useAuth } from '@/lib/AuthContext';
import { useOnboarding } from '@/lib/OnboardingContext';
import { useProgress } from '@/lib/ProgressContext';
import { useSubscription } from '@/lib/SubscriptionContext';
import { requestSubscriptionAccess } from '@/lib/subscriptionAccess';
import { CLASS_ORDER } from '@/lib/progression';
import { PRIVACY_POLICY_URL, TERMS_URL, openLegalUrl } from '@/lib/legal';
import { colors, font, radius, spacing } from '@/theme';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reopenWelcome } = useOnboarding();
  const { user, signOut, deleteAccount } = useAuth();
  const { isPremium, presentCustomerCenter, presentPaywall } = useSubscription();
  const {
    classData,
    longestStreak,
    totalRuns,
    coins,
    completedLevelIds,
    username,
    syncStatus,
  } = useProgress();

  const firstName = user?.name?.split(' ')[0] || username || 'Runner';
  const handle = username ? `@${username}` : user?.email ?? '@runner';
  const anyClassComplete = CLASS_ORDER.some((k) => classData(k).allComplete);

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
        {__DEV__ ? (
          <Pressable
            onPress={() => router.push('/debug-funnel')}
            style={({ pressed }) => [styles.settingRow, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.settingText}>Analytics funnel (debug)</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
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
          <Pressable
            onPress={handleUpgrade}
            style={({ pressed }) => [styles.upgradeRow, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="sparkles" size={18} color={colors.lime} />
            <Text style={styles.upgradeText}>Upgrade to Pro</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.lime} />
          </Pressable>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
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
