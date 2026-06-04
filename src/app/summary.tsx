import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDuration, formatLongDuration } from '@/lib/calories';
import {
  addCoinsToProfile,
  computeStreak,
  loadProfile,
  loadSessions,
  saveSession,
} from '@/lib/storage';
import { theme } from '@/lib/theme';

// ─────────────────────────── Confetti setup ───────────────────────────

const CONFETTI_COLORS = ['#22d3ee', '#fde047', '#ec4899', '#10b981', '#f97316', '#a855f7'];
const CONFETTI_COUNT = 20;

type ConfettiParticle = {
  y: Animated.Value;
  x: Animated.Value;
  opacity: Animated.Value;
  color: string;
  size: number;
  startX: number;
};

const CONFETTI_SIZES = [8, 10, 7, 9, 11, 8, 10, 7, 9, 8, 11, 9, 7, 10, 8, 9, 11, 7, 10, 8];
const CONFETTI_START_X = [
  -80, 40, -30, 90, -60, 20, -90, 60, -20, 80,
  -50, 30, -70, 50, -10, 70, -40, 10, -60, 40,
];

// ─────────────────────────── Screen ───────────────────────────

export default function SummaryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    durationSec?: string;
    calories?: string;
    coins?: string;
  }>();

  const durationSec = useMemo(() => {
    const n = Number(params.durationSec);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }, [params.durationSec]);

  const calories = useMemo(() => {
    const n = Number(params.calories);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }, [params.calories]);

  const coins = useMemo(() => {
    const n = Number(params.coins);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }, [params.coins]);

  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'discarded'>('idle');
  const [streak, setStreak] = useState(0);
  const [profileLevel, setProfileLevel] = useState<string>('');

  // Animations
  const streakBannerY = useRef(new Animated.Value(-80)).current;
  const confettiRef = useRef<ConfettiParticle[]>(
    Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
      y: new Animated.Value(0),
      x: new Animated.Value(0),
      opacity: new Animated.Value(0),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: CONFETTI_SIZES[i],
      startX: CONFETTI_START_X[i],
    })),
  );
  const confetti = confettiRef.current;

  useEffect(() => {
    loadProfile().then((p) => {
      if (p.level) setProfileLevel(p.level.toUpperCase());
    });
  }, []);

  const triggerConfetti = () => {
    confetti.forEach((p) => {
      p.y.setValue(0);
      p.x.setValue(p.startX * 0.5);
      p.opacity.setValue(1);
    });
    Animated.parallel(
      confetti.map((p) =>
        Animated.parallel([
          Animated.timing(p.y, {
            toValue: -(120 + Math.abs(p.startX) * 1.5),
            duration: 1400,
            useNativeDriver: true,
          }),
          Animated.timing(p.x, {
            toValue: p.startX,
            duration: 1400,
            useNativeDriver: true,
          }),
          Animated.timing(p.opacity, {
            toValue: 0,
            duration: 1400,
            useNativeDriver: true,
          }),
        ]),
      ),
    ).start();
  };

  const showStreakBanner = (streakCount: number) => {
    if (streakCount < 2) return;
    setStreak(streakCount);
    Animated.timing(streakBannerY, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start();
  };

  const onSave = async () => {
    if (saving !== 'idle') return;
    setSaving('saving');
    try {
      const session = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        startedAt: Date.now() - durationSec * 1000,
        durationSec,
        estimatedCalories: calories,
        coins,
      };
      await saveSession(session);
      if (coins > 0) await addCoinsToProfile(coins);
      const sessions = await loadSessions();
      const streakCount = computeStreak(sessions);
      triggerConfetti();
      showStreakBanner(streakCount);
      setSaving('saved');
      setTimeout(() => router.replace('/'), 1800);
    } catch {
      setSaving('idle');
    }
  };

  const onDiscard = () => {
    setSaving('discarded');
    router.replace('/');
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Just ran ${formatLongDuration(durationSec)} and collected ${coins} coins on Cardio Surf 🏃‍♂️🪙 #CardioSurf`,
      });
    } catch {
      // dismissed
    }
  };

  const tooShort = durationSec < 5;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Streak banner (slides in from top) */}
      {streak >= 2 && (
        <Animated.View style={[styles.streakBanner, { transform: [{ translateY: streakBannerY }] }]}>
          <Text style={styles.streakBannerText}>🔥 {streak}-day streak! Keep it going.</Text>
        </Animated.View>
      )}

      <View style={styles.content}>
        <View style={styles.headerBlock}>
          <Text style={styles.eyebrow}>WORKOUT COMPLETE</Text>
          <View style={styles.titleRow}>
            <Text style={styles.title}>NICE RUN.</Text>
            {profileLevel ? (
              <View style={styles.levelBadge}>
                <Text style={styles.levelBadgeText}>⚡ {profileLevel}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.subtitle}>
            {tooShort
              ? "That was a short one — want to save it anyway?"
              : 'Here\'s what you logged today.'}
          </Text>
        </View>

        {/* Metrics card */}
        <View style={styles.metricsCard}>
          <View style={styles.metricRow}>
            <View style={styles.metricBlock}>
              <Text style={styles.metricLabel}>Duration</Text>
              <Text style={styles.metricValue}>{formatDuration(durationSec)}</Text>
              <Text style={styles.metricMeta}>{formatLongDuration(durationSec)}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.metricBlock}>
              <Text style={styles.metricLabel}>Calories</Text>
              <Text style={styles.metricValue}>{Math.round(calories)}</Text>
              <Text style={styles.metricMeta}>estimated</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.metricBlock}>
              <Text style={styles.metricLabel}>Coins</Text>
              <Text style={[styles.metricValue, styles.coinsValue]}>🪙 {coins}</Text>
              <Text style={styles.metricMeta}>collected</Text>
            </View>
          </View>
        </View>

        {/* Share button */}
        <Pressable
          style={({ pressed }) => [styles.shareBtn, pressed && styles.pressed]}
          onPress={handleShare}
        >
          <Text style={styles.shareBtnLabel}>SHARE RUN 📤</Text>
        </Pressable>

        <View style={styles.note}>
          <Text style={styles.noteText}>
            Calories estimated via MET formula. Set your weight in Settings for more accurate numbers.
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            onPress={onDiscard}
            style={({ pressed }) => [styles.discardBtn, pressed && styles.pressed]}
            disabled={saving !== 'idle'}
          >
            <Text style={styles.discardLabel}>DISCARD</Text>
          </Pressable>
          <Pressable
            onPress={onSave}
            style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed]}
            disabled={saving !== 'idle'}
          >
            <Text style={styles.saveLabel}>
              {saving === 'saving' ? 'SAVING…' : saving === 'saved' ? 'SAVED ✓' : 'SAVE WORKOUT'}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Confetti layer */}
      <View style={styles.confettiLayer} pointerEvents="none">
        {confetti.map((p, i) => (
          <Animated.View
            key={i}
            style={[
              styles.confettiPiece,
              {
                backgroundColor: p.color,
                width: p.size,
                height: p.size,
                borderRadius: p.size / 4,
                transform: [
                  { translateX: p.x },
                  { translateY: p.y },
                ],
                opacity: p.opacity,
              },
            ]}
          />
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { flex: 1, padding: theme.spacing.lg, justifyContent: 'space-between' },

  // Streak banner
  streakBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: '#f97316',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
  },
  streakBannerText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // Header
  headerBlock: { marginTop: theme.spacing.lg },
  eyebrow: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: theme.spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    flexWrap: 'wrap',
    marginBottom: theme.spacing.sm,
  },
  title: {
    color: theme.colors.text,
    fontSize: 36,
    fontWeight: '900',
  },
  levelBadge: {
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderRadius: theme.radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.3)',
  },
  levelBadgeText: {
    color: theme.colors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },

  // Metrics
  metricsCard: {
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metricBlock: { flex: 1, alignItems: 'center' },
  metricLabel: {
    color: theme.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: theme.spacing.sm,
  },
  metricValue: {
    color: theme.colors.text,
    fontSize: 36,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  coinsValue: {
    color: '#fde047',
    fontSize: 30,
  },
  metricMeta: {
    color: theme.colors.textDim,
    fontSize: 11,
    marginTop: 2,
  },
  divider: {
    width: 1,
    height: 64,
    backgroundColor: theme.colors.border,
  },

  // Share button
  shareBtn: {
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.pill,
    paddingVertical: 14,
    alignItems: 'center',
  },
  shareBtnLabel: {
    color: theme.colors.textMuted,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 1.5,
  },

  // Note
  note: {
    padding: theme.spacing.md,
    backgroundColor: 'rgba(34,211,238,0.06)',
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.15)',
  },
  noteText: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },

  // Actions
  actions: { flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.sm },
  discardBtn: {
    flex: 1,
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radii.pill,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  discardLabel: { color: theme.colors.textMuted, fontWeight: '800', letterSpacing: 2 },
  saveBtn: {
    flex: 1.5,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radii.pill,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
  },
  saveLabel: { color: '#06222a', fontWeight: '900', letterSpacing: 2, fontSize: 13 },

  // Confetti
  confettiLayer: {
    position: 'absolute',
    bottom: '40%',
    left: '50%',
    width: 0,
    height: 0,
  },
  confettiPiece: {
    position: 'absolute',
  },

  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
