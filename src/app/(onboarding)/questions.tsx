import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton, OptionCard, ProgressBar } from '@/components/ui';
import { useOnboarding } from '@/lib/OnboardingContext';
import {
  featuredWorldOptions,
  goalOptions,
  motivationOptions,
  moverOptions,
  onboardingStepProgress,
} from '@/lib/onboarding';
import { colors, font, metric, radius, spacing, type } from '@/theme';

// Personalization questions. The weekly goal + notifications live on their own
// dedicated screens, so they're intentionally not part of this step list.
const STEPS = ['goal', 'mover', 'worlds', 'motivation'] as const;
type Step = (typeof STEPS)[number];

const QUESTION_COUNT = STEPS.length;

export default function QuestionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { answers, setAnswer } = useOnboarding();

  const [index, setIndex] = useState(0);
  const step: Step = STEPS[index];

  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [index, anim]);

  const goNext = () => {
    if (index >= STEPS.length - 1) {
      router.push('/(onboarding)/username');
      return;
    }
    setIndex((i) => i + 1);
  };
  const goBack = () => {
    if (index === 0) {
      router.back();
      return;
    }
    setIndex((i) => Math.max(0, i - 1));
  };

  const questionNumber = index + 1;
  const progress = onboardingStepProgress('questions', index, QUESTION_COUNT);

  const canContinue = useMemo(() => {
    switch (step) {
      case 'goal':
        return answers.goal !== null;
      case 'mover':
        return answers.mover !== null;
      case 'worlds':
        return true;
      case 'motivation':
        return answers.motivation !== null;
      default:
        return true;
    }
  }, [step, answers.goal, answers.mover, answers.motivation]);

  const animatedStyle = {
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={goBack}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <ProgressBar value={progress} accent="lime" />
        </View>
        <Text style={styles.counter}>
          {questionNumber} / {QUESTION_COUNT}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: spacing.xl,
              paddingBottom: insets.bottom + 120,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={animatedStyle}>
            {step === 'goal' ? (
              <StepHead eyebrow="Objective" title="What are you training for?" sub="Pick the one that fits right now.">
                <View style={styles.stack}>
                  {goalOptions.map((o) => (
                    <OptionCard
                      key={o.key}
                      title={o.label}
                      desc={o.desc}
                      accent={o.accent}
                      selected={answers.goal === o.key}
                      onPress={() => setAnswer('goal', o.key)}
                    />
                  ))}
                </View>
              </StepHead>
            ) : null}

            {step === 'mover' ? (
              <StepHead
                eyebrow="Baseline"
                title="Where are you starting from?"
                sub="This sets your opening pace. You can move up any time."
              >
                <View style={styles.stack}>
                  {moverOptions.map((o) => (
                    <OptionCard
                      key={o.key}
                      title={o.label}
                      desc={o.desc}
                      accent={o.accent}
                      selected={answers.mover === o.key}
                      onPress={() => setAnswer('mover', o.key)}
                    />
                  ))}
                </View>
              </StepHead>
            ) : null}

            {step === 'worlds' ? (
              <StepHead
                eyebrow="The catalogue"
                title="Where you'll be training"
                sub="Every session drops you somewhere new."
              >
                <WorldChoices />
              </StepHead>
            ) : null}

            {step === 'motivation' ? (
              <StepHead
                eyebrow="Motivation"
                title="What keeps you coming back?"
                sub="We'll lean into the part of the game that works on you."
              >
                <View style={styles.stack}>
                  {motivationOptions.map((o) => (
                    <OptionCard
                      key={o.key}
                      title={o.label}
                      desc={o.desc}
                      accent={o.accent}
                      selected={answers.motivation === o.key}
                      onPress={() => setAnswer('motivation', o.key)}
                    />
                  ))}
                </View>
              </StepHead>
            ) : null}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <GradientButton
          label="CONTINUE"
          accent="lime"
          onPress={canContinue ? goNext : undefined}
          style={!canContinue ? styles.disabled : undefined}
        />
      </View>
    </View>
  );
}

function WorldChoices() {
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(
    220,
    Math.max(136, Math.floor((width - spacing.lg * 2 - spacing.md) / 2))
  );
  const cardHeight = Math.max(94, Math.min(132, Math.round(cardWidth * 0.68)));
  const reveals = useRef(featuredWorldOptions.map(() => new Animated.Value(0))).current;
  const moreReveal = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return;

    reveals.forEach((value) => value.setValue(reduceMotion ? 1 : 0));
    moreReveal.setValue(reduceMotion ? 1 : 0);
    if (reduceMotion) return;

    const rowAnimations = [0, 2, 4].map((rowStart) =>
      Animated.parallel([
        Animated.timing(reveals[rowStart], {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(70),
          Animated.timing(reveals[rowStart + 1], {
            toValue: 1,
            duration: 420,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    const animation = Animated.sequence([
      ...rowAnimations,
      Animated.timing(moreReveal, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [moreReveal, reduceMotion, reveals]);

  return (
    <View>
      <View style={styles.worldGrid}>
        {featuredWorldOptions.map((world, index) => {
          const reveal = reveals[index];
          return (
            <Animated.View
              key={world.id}
              accessible
              accessibilityRole="image"
              accessibilityLabel={`${world.name} map showcase`}
              style={{
                width: cardWidth,
                height: cardHeight,
                opacity: reveal,
                transform: [
                  {
                    translateY: reveal.interpolate({
                      inputRange: [0, 1],
                      outputRange: [14, 0],
                    }),
                  },
                  {
                    scale: reveal.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.975, 1],
                    }),
                  },
                ],
              }}
            >
              <View style={styles.worldCard}>
                <Image
                  source={world.cover}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={180}
                />
                <LinearGradient
                  colors={['transparent', 'rgba(4,4,8,0.08)', 'rgba(4,4,8,0.78)']}
                  locations={[0.38, 0.66, 1]}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                <Text style={styles.worldName} numberOfLines={2}>
                  {world.name}
                </Text>
              </View>
            </Animated.View>
          );
        })}
      </View>

      <Animated.View
        style={[
          styles.moreWorlds,
          {
            opacity: moreReveal,
            transform: [
              {
                translateY: moreReveal.interpolate({
                  inputRange: [0, 1],
                  outputRange: [8, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Text style={styles.moreWorldsText}>Plus the full catalogue inside.</Text>
      </Animated.View>
    </View>
  );
}

function StepHead({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <View>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      <View style={styles.stepBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  counter: {
    ...metric,
    color: colors.textDim,
    fontSize: 13,
    fontWeight: font.bold,
    width: 44,
    textAlign: 'right',
  },
  content: { paddingHorizontal: spacing.lg },
  eyebrow: { ...type.label, color: colors.lime, marginBottom: 8 },
  title: { ...type.h1, color: colors.text },
  sub: { ...type.body, color: colors.textDim, marginTop: spacing.sm },
  stepBody: { marginTop: spacing.xl },
  stack: { gap: spacing.md },
  worldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  worldCard: {
    width: '100%',
    height: '100%',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  worldName: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.sm,
    color: colors.white,
    fontSize: 13,
    fontWeight: font.heavy,
    letterSpacing: -0.2,
    lineHeight: 15,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  moreWorlds: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  moreWorldsText: {
    ...type.bodySm,
    color: colors.textDim,
    fontWeight: font.semibold,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
