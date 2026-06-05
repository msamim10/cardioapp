import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DEFAULT_WEIGHT_KG } from '@/lib/constants';
import { loadProfile, saveProfile } from '@/lib/storage';
import { theme } from '@/lib/theme';
import type { FitnessLevel, GoalVibe } from '@/lib/types';

const KG_TO_LB = 2.20462;
const MIN_KG = 30;
const MAX_KG = 200;

const LEVEL_OPTIONS: { level: FitnessLevel; emoji: string; label: string; goalMinutes: number }[] = [
  { level: 'beginner', emoji: '🟢', label: 'Beginner', goalMinutes: 10 },
  { level: 'intermediate', emoji: '🟡', label: 'Intermediate', goalMinutes: 20 },
  { level: 'advanced', emoji: '🔴', label: 'Advanced', goalMinutes: 30 },
  { level: 'elite', emoji: '⚡', label: 'Elite', goalMinutes: 45 },
];

const VIBE_OPTIONS: { vibe: GoalVibe; emoji: string; label: string }[] = [
  { vibe: 'sweat', emoji: '💦', label: 'JUST SWEAT' },
  { vibe: 'streak', emoji: '🔥', label: 'BEAT MY STREAK' },
  { vibe: 'zone', emoji: '🎧', label: 'ZONE OUT' },
  { vibe: 'compete', emoji: '🏆', label: "LET'S COMPETE" },
];

const VIBE_LABELS: Record<GoalVibe, string> = {
  sweat: '💦 Just Sweat',
  streak: '🔥 Beat My Streak',
  zone: '🎧 Zone Out',
  compete: "🏆 Let's Compete",
};

const LEVEL_LABELS: Record<FitnessLevel, string> = {
  beginner: '🟢 Beginner',
  intermediate: '🟡 Intermediate',
  advanced: '🔴 Advanced',
  elite: '⚡ Elite',
};

export default function OnboardingScreen() {
  const router = useRouter();
  const [slide, setSlide] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const [vibe, setVibe] = useState<GoalVibe | undefined>();
  const [level, setLevel] = useState<FitnessLevel | undefined>();
  const [goalMinutes, setGoalMinutes] = useState<number>(20);
  const [weightKg, setWeightKg] = useState<number>(DEFAULT_WEIGHT_KG);

  const goToSlide = (next: number) => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 140,
      useNativeDriver: true,
    }).start(() => {
      setSlide(next);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
  };

  const handleFinish = async () => {
    const existing = await loadProfile();
    await saveProfile({
      ...existing,
      weightKg,
      vibe,
      level,
      goalMinutes,
      hasSeenOnboarding: true,
    });
    router.replace('/');
  };

  const adjustWeight = (delta: number) => {
    setWeightKg((prev) => Math.max(MIN_KG, Math.min(MAX_KG, Math.round(prev + delta))));
  };

  const displayWeight = Math.round(weightKg);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Animated.View style={[styles.slideWrap, { opacity: fadeAnim }]}>
        {slide === 0 && <Slide0 onNext={() => goToSlide(1)} />}
        {slide === 1 && <Slide1 onNext={() => goToSlide(2)} />}
        {slide === 2 && (
          <Slide2
            vibe={vibe}
            level={level}
            weight={displayWeight}
            onVibeSelect={(v) => setVibe(v)}
            onLevelSelect={(l, g) => {
              setLevel(l);
              setGoalMinutes(g);
            }}
            onAdjustWeight={adjustWeight}
            onNext={() => goToSlide(3)}
          />
        )}
        {slide === 3 && (
          <Slide3
            vibe={vibe}
            level={level}
            goalMinutes={goalMinutes}
            onFinish={handleFinish}
          />
        )}
      </Animated.View>

      {slide > 0 && (
        <View style={styles.dots}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={[styles.dot, slide === i && styles.dotActive]} />
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}

// ─────────────── Slide 0 — Hook ───────────────

function Slide0({ onNext }: { onNext: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.slideContent} showsVerticalScrollIndicator={false}>
      <View style={styles.slide0BgTop} />
      <View style={styles.slide0BgBottom} />

      <View style={styles.slide0Inner}>
        <Text style={styles.eyebrow}>CARDIO SURF</Text>
        <Text style={styles.hookTitle}>RUN LIKE YOU'RE BEING CHASED.</Text>
        <Text style={styles.hookSub}>
          A cardio game that plays itself. You just run.
        </Text>

        <LaneIllustration />

        <Pressable
          style={({ pressed }) => [styles.ctaBtn, pressed && styles.pressed]}
          onPress={onNext}
        >
          <Text style={styles.ctaLabel}>GET STARTED →</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function LaneIllustration() {
  return (
    <View style={styles.laneWrap}>
      {([-1, 0, 1] as const).map((lane) => (
        <View key={lane} style={[styles.laneBar, lane === 0 && styles.laneCenterBar]}>
          {lane === 0 && <View style={styles.laneDot} />}
        </View>
      ))}
    </View>
  );
}

// ─────────────── Slide 1 — How it works ───────────────

const HOW_ROWS = [
  { icon: '📱', label: 'PLACE YOUR PHONE', desc: 'Flat on a surface or in your hand' },
  { icon: '🏃', label: 'RUN IN PLACE', desc: 'The camera drives itself automatically' },
  { icon: '🏆', label: 'COLLECT & CLIMB', desc: 'Dodge obstacles, grab coins, level up' },
];

function Slide1({ onNext }: { onNext: () => void }) {
  return (
    <View style={styles.slideContent}>
      <Text style={styles.slideTitle}>HOW IT WORKS</Text>
      <View style={styles.howRows}>
        {HOW_ROWS.map((row) => (
          <View key={row.label} style={styles.howRow}>
            <Text style={styles.howIcon}>{row.icon}</Text>
            <View style={styles.howText}>
              <Text style={styles.howLabel}>{row.label}</Text>
              <Text style={styles.howDesc}>{row.desc}</Text>
            </View>
          </View>
        ))}
      </View>
      <Pressable
        style={({ pressed }) => [styles.ctaBtn, pressed && styles.pressed]}
        onPress={onNext}
      >
        <Text style={styles.ctaLabel}>NEXT →</Text>
      </Pressable>
    </View>
  );
}

// ─────────────── Slide 2 — Personalize ───────────────

type Slide2Props = {
  vibe: GoalVibe | undefined;
  level: FitnessLevel | undefined;
  weight: number;
  onVibeSelect: (v: GoalVibe) => void;
  onLevelSelect: (l: FitnessLevel, goalMin: number) => void;
  onAdjustWeight: (delta: number) => void;
  onNext: () => void;
};

function Slide2({ vibe, level, weight, onVibeSelect, onLevelSelect, onAdjustWeight, onNext }: Slide2Props) {
  return (
    <ScrollView contentContainerStyle={styles.slideContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.slideTitle}>PERSONALIZE</Text>

      <Text style={styles.sectionLabel}>What's your vibe?</Text>
      <View style={styles.vibeGrid}>
        {VIBE_OPTIONS.map((opt) => (
          <Pressable
            key={opt.vibe}
            style={[styles.vibeCard, vibe === opt.vibe && styles.vibeCardSelected]}
            onPress={() => onVibeSelect(opt.vibe)}
          >
            <Text style={styles.vibeEmoji}>{opt.emoji}</Text>
            <Text style={[styles.vibeLabel, vibe === opt.vibe && styles.vibeLabelSelected]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.sectionLabel, { marginTop: theme.spacing.lg }]}>What's your level?</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.levelRow}>
        {LEVEL_OPTIONS.map((opt) => (
          <Pressable
            key={opt.level}
            style={[styles.levelPill, level === opt.level && styles.levelPillSelected]}
            onPress={() => onLevelSelect(opt.level, opt.goalMinutes)}
          >
            <Text style={styles.levelEmoji}>{opt.emoji}</Text>
            <Text style={[styles.levelLabel, level === opt.level && styles.levelLabelSelected]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={[styles.sectionLabel, { marginTop: theme.spacing.lg }]}>Your weight?</Text>
      <Text style={styles.weightHelper}>For calorie estimates — stays on your device.</Text>
      <View style={styles.stepper}>
        <Pressable style={styles.stepBtn} onPress={() => onAdjustWeight(-1)}>
          <Text style={styles.stepGlyph}>−</Text>
        </Pressable>
        <View style={styles.stepValue}>
          <Text style={styles.stepValueText}>{weight}</Text>
          <Text style={styles.stepUnit}>kg</Text>
        </View>
        <Pressable style={styles.stepBtn} onPress={() => onAdjustWeight(1)}>
          <Text style={styles.stepGlyph}>+</Text>
        </Pressable>
      </View>

      <Pressable
        style={({ pressed }) => [styles.ctaBtn, pressed && styles.pressed, { marginTop: theme.spacing.xl }]}
        onPress={onNext}
      >
        <Text style={styles.ctaLabel}>NEXT →</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─────────────── Slide 3 — Ready ───────────────

type Slide3Props = {
  vibe: GoalVibe | undefined;
  level: FitnessLevel | undefined;
  goalMinutes: number;
  onFinish: () => void;
};

function Slide3({ vibe, level, goalMinutes, onFinish }: Slide3Props) {
  return (
    <View style={styles.slideContent}>
      <Text style={styles.readyTitle}>YOU'RE ALL SET.</Text>
      <Text style={styles.readySub}>Here's what we've got for you:</Text>

      <View style={styles.summaryCard}>
        {level && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>LEVEL</Text>
            <Text style={styles.summaryValue}>{LEVEL_LABELS[level]}</Text>
          </View>
        )}
        {vibe && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>VIBE</Text>
            <Text style={styles.summaryValue}>{VIBE_LABELS[vibe]}</Text>
          </View>
        )}
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>GOAL</Text>
          <Text style={styles.summaryValue}>⏱ {goalMinutes} min / session</Text>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [styles.ctaBtn, pressed && styles.pressed]}
        onPress={onFinish}
      >
        <Text style={styles.ctaLabel}>START MY FIRST RUN →</Text>
      </Pressable>
    </View>
  );
}

// ─────────────── Styles ───────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  slideWrap: {
    flex: 1,
  },
  slideContent: {
    flexGrow: 1,
    padding: theme.spacing.lg,
    justifyContent: 'center',
    paddingTop: theme.spacing.xxl,
    paddingBottom: theme.spacing.xl,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.border,
  },
  dotActive: {
    backgroundColor: theme.colors.primary,
    width: 24,
    borderRadius: 4,
  },

  // Slide 0
  slide0BgTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '50%',
    backgroundColor: '#0a0e14',
  },
  slide0BgBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
    backgroundColor: '#0e1f2e',
  },
  slide0Inner: {
    flex: 1,
    justifyContent: 'center',
  },
  eyebrow: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: theme.spacing.md,
  },
  hookTitle: {
    color: theme.colors.text,
    fontSize: 38,
    fontWeight: '900',
    lineHeight: 44,
    marginBottom: theme.spacing.md,
  },
  hookSub: {
    color: theme.colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: theme.spacing.xl,
  },
  laneWrap: {
    marginVertical: theme.spacing.xxl,
    gap: 10,
  },
  laneBar: {
    height: 18,
    borderRadius: 4,
    backgroundColor: theme.colors.bgCard,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  laneCenterBar: {
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  laneDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.primary,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },

  // Slide 1
  slideTitle: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: theme.spacing.xl,
  },
  howRows: {
    gap: theme.spacing.lg,
    marginBottom: theme.spacing.xxl,
  },
  howRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.bgCard,
    padding: theme.spacing.md,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  howIcon: {
    fontSize: 28,
    width: 36,
    textAlign: 'center',
  },
  howText: {
    flex: 1,
  },
  howLabel: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  howDesc: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },

  // Slide 2
  sectionLabel: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: theme.spacing.md,
  },
  vibeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  vibeCard: {
    width: '47.5%',
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.md,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    alignItems: 'center',
    gap: 6,
  },
  vibeCardSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: 'rgba(34,211,238,0.08)',
  },
  vibeEmoji: {
    fontSize: 28,
  },
  vibeLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  vibeLabelSelected: {
    color: theme.colors.primary,
  },
  levelRow: {
    flexGrow: 0,
  },
  levelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.bgCard,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    marginRight: theme.spacing.sm,
  },
  levelPillSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: 'rgba(34,211,238,0.1)',
  },
  levelEmoji: {
    fontSize: 16,
  },
  levelLabel: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  levelLabelSelected: {
    color: theme.colors.primary,
  },
  weightHelper: {
    color: theme.colors.textMuted,
    fontSize: 13,
    marginBottom: theme.spacing.md,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xl,
  },
  stepBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  stepGlyph: {
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: '700',
  },
  stepValue: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  stepValueText: {
    color: theme.colors.text,
    fontSize: 48,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  stepUnit: {
    color: theme.colors.textMuted,
    fontSize: 16,
    fontWeight: '700',
  },

  // Slide 3
  readyTitle: {
    color: theme.colors.text,
    fontSize: 44,
    fontWeight: '900',
    marginBottom: theme.spacing.sm,
  },
  readySub: {
    color: theme.colors.textMuted,
    fontSize: 16,
    marginBottom: theme.spacing.xl,
  },
  summaryCard: {
    backgroundColor: theme.colors.bgCard,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
  },
  summaryValue: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '700',
  },

  // Shared
  ctaBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radii.pill,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  ctaLabel: {
    color: '#06222a',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
