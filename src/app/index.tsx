import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatLongDuration } from '@/lib/calories';
import { loadSessions, summarizeSessions } from '@/lib/storage';
import { theme } from '@/lib/theme';
import type { Session } from '@/lib/types';

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function HomeScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadSessions().then((s) => {
        if (!cancelled) {
          setSessions(s);
          setLoaded(true);
        }
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const stats = summarizeSessions(sessions);
  const recent = sessions.slice(0, 5);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>CARDIO SURF</Text>
            <Text style={styles.title}>Ready to run?</Text>
          </View>
          <Link href="/settings" asChild>
            <Pressable hitSlop={12} style={styles.iconButton}>
              <Text style={styles.iconText}>⚙</Text>
            </Pressable>
          </Link>
        </View>

        <View style={styles.statRow}>
          <StatCard label="Sessions" value={stats.count.toString()} />
          <StatCard label="Total time" value={formatLongDuration(stats.totalSec)} />
          <StatCard label="Calories" value={Math.round(stats.totalCalories).toString()} />
        </View>

        <Pressable
          style={({ pressed }) => [styles.startBtn, pressed && styles.startBtnPressed]}
          onPress={() => router.push('/workout')}
        >
          <Text style={styles.startBtnLabel}>START WORKOUT</Text>
          <Text style={styles.startBtnHint}>
            Place phone flat, then jump and move with the run
          </Text>
        </Pressable>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent sessions</Text>
          {!loaded ? (
            <Text style={styles.emptyText}>Loading…</Text>
          ) : recent.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No sessions yet</Text>
              <Text style={styles.emptyText}>
                Tap START WORKOUT above. Your first run will show up here.
              </Text>
            </View>
          ) : (
            recent.map((s) => <SessionRow key={s.id} session={s} />)
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SessionRow({ session }: { session: Session }) {
  return (
    <View style={styles.sessionRow}>
      <View style={styles.sessionDot} />
      <View style={styles.sessionMain}>
        <Text style={styles.sessionDuration}>
          {formatLongDuration(session.durationSec)} workout
        </Text>
        <Text style={styles.sessionMeta}>
          {Math.round(session.estimatedCalories)} cal • {formatRelative(session.startedAt)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  scroll: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xl,
  },
  eyebrow: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: theme.spacing.xs,
  },
  title: {
    color: theme.colors.text,
    fontSize: 32,
    fontWeight: '800',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  iconText: {
    color: theme.colors.text,
    fontSize: 20,
  },
  statRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
  statCard: {
    flex: 1,
    backgroundColor: theme.colors.bgCard,
    padding: theme.spacing.md,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  statValue: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 2,
  },
  statLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  startBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.lg,
    alignItems: 'center',
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 12,
    marginBottom: theme.spacing.xl,
  },
  startBtnPressed: {
    backgroundColor: theme.colors.primaryDark,
    transform: [{ scale: 0.98 }],
  },
  startBtnLabel: {
    color: '#06222a',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
  },
  startBtnHint: {
    color: 'rgba(6, 34, 42, 0.7)',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '600',
  },
  section: {
    marginTop: theme.spacing.md,
  },
  sectionTitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: theme.spacing.md,
  },
  emptyCard: {
    backgroundColor: theme.colors.bgCard,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: theme.spacing.xs,
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sessionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.primary,
    marginRight: theme.spacing.md,
  },
  sessionMain: {
    flex: 1,
  },
  sessionDuration: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  sessionMeta: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
});
