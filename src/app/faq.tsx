import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, spacing } from '@/theme';

type FaqItem = {
  id: string;
  question: string;
  /** Answer paragraphs, rendered stacked. */
  answer: string[];
  /** Optional ordered steps rendered as a numbered list under the answer. */
  steps?: string[];
};

const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'what-is',
    question: 'What is CardioSurf?',
    answer: [
      'CardioSurf is a body-movement cardio game. You physically jump, duck, and step left or right in front of your phone to play along with fast-paced running videos.',
      'Every move you make is a real rep, so it plays like a game but works like a cardio session.',
    ],
  },
  {
    id: 'equipment',
    question: 'Do I need any equipment?',
    answer: [
      'No. All you need is your phone and enough clear space to jump and step from side to side safely.',
      'Optionally, you can mirror the video to a TV with AirPlay for a bigger screen while your phone stays nearby as your camera and stats display.',
    ],
  },
  {
    id: 'tracking',
    question: 'How does the movement tracking work?',
    answer: [
      'Your phone’s front camera watches you and uses on-device pose detection (Apple’s Vision framework) to find where your shoulders, hips, and other joints are.',
      'From that body position it recognizes your jumps, ducks, and side steps in real time and turns them into moves in the game.',
    ],
  },
  {
    id: 'privacy',
    question: 'Is my camera footage recorded or uploaded?',
    answer: [
      'No. The camera feed is analyzed live on your device only to detect how your body is moving.',
      'The video itself is not saved to your device and is never uploaded or sent anywhere — only your body’s position is used to drive the game.',
    ],
  },
  {
    id: 'space',
    question: 'How much space and how far from the camera do I need?',
    answer: [
      'Stand back far enough that your whole body fits in the frame — roughly 5–6 feet (1.5–2 m) from the phone.',
      'Keep your shoulders and hips visible; having your knees and feet in view gives the most accurate jump detection. Make sure the area around you is clear so you can move safely in every direction.',
    ],
  },
  {
    id: 'calibrate',
    question: 'What is calibration at the start of a run?',
    answer: [
      'Before scoring begins, CardioSurf takes a moment to learn your neutral standing position. Stand centered and hold still for a second or two while it calibrates.',
      'Once calibrated, it can tell the difference between a real jump, duck, or side step and normal small movements.',
    ],
  },
  {
    id: 'airplay',
    question: 'How do I play on my TV (AirPlay)?',
    answer: [
      'On the run recap screen, tap the TV / AirPlay option to open the system AirPlay picker. Choose your Apple TV or AirPlay display on the same Wi-Fi network.',
      'The run video plays on your TV in landscape while your phone stays with you as the live stats and camera controller. You can switch back to Phone anytime before you start.',
    ],
  },
  {
    id: 'scoring',
    question: 'How are calories, score, and XP calculated?',
    answer: [
      'These are estimates, not precise measurements. Calories use a standard activity (MET) estimate based on how long you move and your class speed, with an assumed body weight — so treat it as an approximation.',
      'Your score comes from progressing through the run plus bonus points for each move you land, with combos for stringing moves together. XP and coins are based on how long you run and your class multiplier.',
    ],
  },
  {
    id: 'modes',
    question: 'How do modes and difficulty classes work?',
    answer: [
      'There are three classes: Beginner runs at normal speed, Intermediate is about 10% faster, and Hard is about 20% faster. Faster classes burn more and reward more coins and XP.',
      'Each class has its own campaign path of maps for you to work through at that pace.',
    ],
  },
  {
    id: 'unlock',
    question: 'How do I unlock the next level?',
    answer: [
      'Inside a class campaign, finish a run all the way to the end to unlock the next map on that path. Each step opens once you complete the one right before it.',
    ],
  },
  {
    id: 'not-unlocked',
    question: 'Why didn’t a level unlock after I played?',
    answer: [
      'Campaign maps only unlock when you finish the run to the end from inside that class campaign.',
      'Casual or recommended plays, and runs you exit early, don’t advance the campaign path. Jump back into the class campaign and complete the run fully to unlock the next map.',
    ],
  },
  {
    id: 'subscription',
    question: 'How do I manage or cancel my subscription?',
    answer: [
      'Go to Profile → Account → Manage subscription. That opens the subscription management screen (handled through the App Store), where you can view, change, or cancel your plan.',
      'Subscriptions are billed and cancelled through your app store account, so any changes you make there apply to your CardioSurf plan.',
    ],
  },
  {
    id: 'troubleshoot',
    question: 'Tracking isn’t working or the video won’t load. What can I do?',
    answer: [
      'For tracking: make sure the app has camera permission, stand back so your whole body is in frame, add more light, and clear the space around you. Hold still and centered for a moment so it can calibrate.',
      'For video: check your internet connection and try restarting the run. If tracking says it’s unavailable, your current setup may not support on-device pose detection — try again on a supported device build.',
    ],
  },
];

export default function FaqScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  const toggle = (id: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/profile');
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + spacing.sm,
            paddingBottom: insets.bottom + spacing.xxl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={10}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>FAQ</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.intro}>
          <Text style={styles.introTitle}>How CardioSurf works</Text>
          <Text style={styles.introText}>
            Tap a question to see the answer. Here are the things players ask most.
          </Text>
        </View>

        <View style={styles.list}>
          {FAQ_ITEMS.map((item) => {
            const open = openIds.has(item.id);
            return (
              <View key={item.id} style={styles.item}>
                <Pressable
                  onPress={() => toggle(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={item.question}
                  accessibilityState={{ expanded: open }}
                  hitSlop={6}
                  style={({ pressed }) => [styles.questionRow, pressed && styles.pressed]}
                >
                  <Text style={styles.questionText}>{item.question}</Text>
                  <Ionicons
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.textDim}
                  />
                </Pressable>

                {open ? (
                  <View style={styles.answer}>
                    {item.answer.map((paragraph, index) => (
                      <Text key={index} style={styles.answerText}>
                        {paragraph}
                      </Text>
                    ))}
                    {item.steps ? (
                      <View style={styles.steps}>
                        {item.steps.map((step, index) => (
                          <View key={step} style={styles.step}>
                            <View style={styles.stepNum}>
                              <Text style={styles.stepNumText}>{index + 1}</Text>
                            </View>
                            <Text style={styles.stepText}>{step}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <Text style={styles.footerNote}>
          Calories, score, and XP are estimates to help you track effort, not medical or fitness
          measurements.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  back: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: font.bold,
    textAlign: 'center',
  },
  headerSpacer: { width: 42 },
  pressed: { opacity: 0.85 },
  intro: { gap: 4 },
  introTitle: { color: colors.text, fontSize: 22, fontWeight: font.black, letterSpacing: -0.4 },
  introText: { color: colors.textDim, fontSize: 14, fontWeight: font.medium, lineHeight: 20 },
  list: { gap: spacing.sm },
  item: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  questionText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: font.semibold,
    lineHeight: 21,
  },
  answer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  answerText: { color: colors.textDim, fontSize: 14, fontWeight: font.medium, lineHeight: 21 },
  steps: { gap: spacing.sm, marginTop: spacing.xs },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: { color: colors.lime, fontSize: 12, fontWeight: font.bold },
  stepText: { flex: 1, color: colors.textDim, fontSize: 14, fontWeight: font.medium, lineHeight: 21 },
  footerNote: {
    color: colors.textFaint,
    fontSize: 12,
    fontWeight: font.medium,
    lineHeight: 18,
    paddingHorizontal: spacing.xs,
  },
});
