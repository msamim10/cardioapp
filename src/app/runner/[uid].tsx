import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/AuthContext';
import { levelBadges } from '@/lib/levels';
import { fetchPublicProfile, followUser, isFollowing, unfollowUser, type PublicProfile } from '@/lib/profileSync';
import { colors, font, metric, radius, spacing, type } from '@/theme';

/** Minimal public profile: handle, level, badges, follow/unfollow. */
export default function PublicProfileScreen() {
  const { uid: uidParam } = useLocalSearchParams<{ uid: string | string[] }>();
  const targetUid = Array.isArray(uidParam) ? uidParam[0] : uidParam;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const isSelf = user?.id === targetUid;

  useEffect(() => {
    if (!targetUid) return;
    let cancelled = false;
    (async () => {
      const [p, f] = await Promise.all([
        fetchPublicProfile(targetUid),
        user && !isSelf ? isFollowing(user.id, targetUid) : Promise.resolve(false),
      ]);
      if (cancelled) return;
      setProfile(p);
      setFollowing(f);
    })();
    return () => {
      cancelled = true;
    };
  }, [isSelf, targetUid, user]);

  const toggleFollow = async () => {
    if (!user || !targetUid || busy || following === null) return;
    setBusy(true);
    try {
      if (following) await unfollowUser(user.id, targetUid);
      else await followUser(user.id, targetUid);
      setFollowing(!following);
    } catch {
      // leave state unchanged; the button can be tapped again
    } finally {
      setBusy(false);
    }
  };

  const badges = profile ? levelBadges(profile.level).filter((b) => b.unlocked || profile.badges.includes(b.badge.id)) : [];

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Runner</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        {profile === undefined ? (
          <ActivityIndicator color={colors.lime} style={{ paddingVertical: spacing.xxl }} />
        ) : profile === null ? (
          <View style={styles.empty}>
            <Ionicons name="person-outline" size={24} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>Profile unavailable</Text>
            <Text style={styles.emptyDetail}>This runner has no public profile yet.</Text>
          </View>
        ) : (
          <>
            <View style={styles.hero}>
              <View style={styles.avatar}>
                {profile.photoURL ? (
                  <Image source={{ uri: profile.photoURL }} contentFit="cover" style={styles.avatarImage} />
                ) : (
                  <Ionicons name="person" size={30} color={colors.lime} />
                )}
              </View>
              <Text style={styles.handle}>{profile.username ? `@${profile.username}` : 'Runner'}</Text>
              <View style={styles.levelPill}>
                <Text style={styles.levelPillText}>LEVEL {profile.level}</Text>
              </View>
              {!isSelf && user ? (
                <Pressable
                  onPress={toggleFollow}
                  disabled={busy || following === null}
                  accessibilityRole="button"
                  accessibilityLabel={following ? 'Unfollow' : 'Follow'}
                  accessibilityState={{ busy, disabled: busy || following === null }}
                  style={({ pressed }) => [styles.followBtn, following && styles.followBtnOn, pressed && styles.pressed]}
                >
                  {busy ? (
                    <ActivityIndicator color={following ? colors.text : colors.black} />
                  ) : (
                    <>
                      <Ionicons
                        name={following ? 'checkmark' : 'person-add'}
                        size={16}
                        color={following ? colors.text : colors.black}
                      />
                      <Text style={[styles.followText, following && styles.followTextOn]}>
                        {following ? 'FOLLOWING' : 'FOLLOW'}
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : null}
            </View>

            <Text style={styles.sectionLabel}>Badges</Text>
            {badges.length === 0 ? (
              <Text style={styles.emptyDetail}>No badges yet.</Text>
            ) : (
              <View style={styles.badges}>
                {badges.map(({ badge, level }) => (
                  <View key={badge.id} style={styles.badge} accessible accessibilityLabel={`${badge.title}, level ${level}`}>
                    <Ionicons name={badge.icon as keyof typeof Ionicons.glyphMap} size={18} color={colors.lime} />
                    <Text style={styles.badgeTitle} numberOfLines={1}>
                      {badge.title}
                    </Text>
                    <Text style={styles.badgeLevel}>LVL {level}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  back: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerTitle: { ...type.label, flex: 1, color: colors.textDim, textAlign: 'center' },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  handle: { ...type.h1, color: colors.text, fontSize: 26 },
  levelPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  levelPillText: { ...metric, color: colors.lime, fontSize: 11, fontWeight: font.black, letterSpacing: 0.8 },
  followBtn: {
    marginTop: spacing.sm,
    minWidth: 160,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.button,
    backgroundColor: colors.lime,
  },
  followBtnOn: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.borderStrong },
  followText: { ...type.action, color: colors.black, fontSize: 13 },
  followTextOn: { color: colors.text },
  sectionLabel: { ...type.label, color: colors.textDim },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: {
    width: '31%',
    minWidth: 96,
    alignItems: 'center',
    gap: 4,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeTitle: { color: colors.text, fontSize: 12, fontWeight: font.bold },
  badgeLevel: { ...metric, color: colors.textFaint, fontSize: 10, fontWeight: font.black },
  empty: { alignItems: 'center', gap: 6, paddingVertical: spacing.xxl },
  emptyTitle: { ...type.h3, color: colors.text },
  emptyDetail: { ...type.bodySm, color: colors.textDim, textAlign: 'center' },
  pressed: { opacity: 0.72 },
});
