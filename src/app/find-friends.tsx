import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { normalizeUsername } from '@shared/scoring/username';
import { useAuth } from '@/lib/AuthContext';
import { searchUsernames, type UsernameHit } from '@/lib/profileSync';
import { colors, font, radius, spacing, type } from '@/theme';

/** Search reserved handles by prefix and open the runner's public profile. */
export default function FindFriendsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [queryText, setQueryText] = useState('');
  const [hits, setHits] = useState<UsernameHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const needle = normalizeUsername(queryText);
    if (needle.length < 2) {
      setHits(null);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const results = await searchUsernames(needle);
      if (cancelled) return;
      setHits(results.filter((hit) => hit.uid !== user?.id));
      setSearching(false);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [queryText, user?.id]);

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
        <Text style={styles.headerTitle}>Find friends</Text>
        <View style={styles.back} />
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          value={queryText}
          onChangeText={setQueryText}
          placeholder="Search by username"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="search"
          accessibilityLabel="Search by username"
          style={styles.input}
        />
        {searching ? <ActivityIndicator color={colors.lime} /> : null}
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        {hits === null ? (
          <Text style={styles.hint}>Type at least two characters of a handle. Follow a runner to see them on the Friends tab of every leaderboard.</Text>
        ) : hits.length === 0 && !searching ? (
          <Text style={styles.hint}>No runners match “{queryText.trim()}”.</Text>
        ) : (
          <View style={styles.list}>
            {hits.map((hit) => (
              <Pressable
                key={hit.uid}
                onPress={() => router.push(`/runner/${hit.uid}` as Href)}
                accessibilityRole="button"
                accessibilityLabel={`Open @${hit.handle}`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.avatar}>
                  <Ionicons name="person" size={14} color={colors.textFaint} />
                </View>
                <Text style={styles.handle}>@{hit.handle}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </Pressable>
            ))}
          </View>
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
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  input: { flex: 1, color: colors.text, fontSize: 15, fontWeight: font.medium, paddingVertical: spacing.sm },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  hint: { ...type.bodySm, color: colors.textDim },
  list: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: spacing.xs },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  handle: { flex: 1, color: colors.text, fontSize: 14, fontWeight: font.semibold },
  pressed: { opacity: 0.72 },
});
