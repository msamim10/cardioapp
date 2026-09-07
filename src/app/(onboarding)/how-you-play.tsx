import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { type Href, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton, OnboardingTopBar } from '@/components/ui';
import { onboardingProgress } from '@/lib/onboarding';
import { colors, font, radius, spacing, type } from '@/theme';

type MoveCard = {
  key: string;
  eyebrow: string;
  title: string;
  caption: string;
  icon: keyof typeof Ionicons.glyphMap;
  image: number;
};

/**
 * Original illustrations of one adult in front of a TV with the phone propped
 * below it, one per movement. Same scene, same palette, only the pose changes,
 * so the four cards read as one instruction set.
 */
const CARDS: MoveCard[] = [
  {
    key: 'run',
    eyebrow: 'Move 1 of 4',
    title: 'Run in place',
    caption: 'Your cadence is the throttle. Lift your knees and the run keeps moving.',
    icon: 'walk',
    image: require('../../../assets/how-to-play/run.jpg'),
  },
  {
    key: 'dodge',
    eyebrow: 'Move 2 of 4',
    title: 'Dodge left and right',
    caption: 'Lean or step to the side to switch lanes and clear obstacles.',
    icon: 'swap-horizontal',
    image: require('../../../assets/how-to-play/dodge.jpg'),
  },
  {
    key: 'squat',
    eyebrow: 'Move 3 of 4',
    title: 'Squat to duck',
    caption: 'Drop low to slide under barriers. Depth counts.',
    icon: 'arrow-down',
    image: require('../../../assets/how-to-play/squat.jpg'),
  },
  {
    key: 'jump',
    eyebrow: 'Move 4 of 4',
    title: 'Jump',
    caption: 'Both feet off the floor clears the low blocks.',
    icon: 'arrow-up',
    image: require('../../../assets/how-to-play/jump.jpg'),
  },
];

export default function HowYouPlayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<MoveCard>>(null);

  const pageWidth = width;
  const cardWidth = width - spacing.lg * 2;

  const onMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
      setIndex(Math.max(0, Math.min(CARDS.length - 1, next)));
    },
    [pageWidth],
  );

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(CARDS.length - 1, next));
    listRef.current?.scrollToOffset({ offset: clamped * pageWidth, animated: true });
    setIndex(clamped);
  };

  const isLast = index === CARDS.length - 1;

  return (
    <View style={styles.root}>
      <OnboardingTopBar
        progress={onboardingProgress('how-you-play')}
        topInset={insets.top}
        onBack={() => router.back()}
      />

      <View style={styles.header}>
        <Text style={styles.eyebrow}>How you play</Text>
        <Text style={styles.title}>Four moves. That&apos;s the whole game.</Text>
      </View>

      <FlatList
        ref={listRef}
        data={CARDS}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(card) => card.key}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_, i) => ({ length: pageWidth, offset: i * pageWidth, index: i })}
        accessibilityLabel={`${CARDS.length} movement cards. Swipe left or right.`}
        renderItem={({ item }) => (
          <View style={[styles.page, { width: pageWidth }]}>
            <View style={[styles.card, { width: cardWidth }]}>
              <View style={styles.imageWrap}>
                <Image
                  source={item.image}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={160}
                  accessibilityLabel={`${item.title}: a person in a living room in front of a TV, phone on a stand below it.`}
                />
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardHead}>
                  <View style={styles.iconWrap}>
                    <Ionicons name={item.icon} size={18} color={colors.lime} />
                  </View>
                  <Text style={styles.cardEyebrow}>{item.eyebrow}</Text>
                </View>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardCaption}>{item.caption}</Text>
              </View>
            </View>
          </View>
        )}
      />

      <View
        accessibilityRole="progressbar"
        accessibilityLabel={`Card ${index + 1} of ${CARDS.length}`}
        style={styles.dots}
      >
        {CARDS.map((card, i) => (
          <Pressable
            key={card.key}
            hitSlop={8}
            onPress={() => goTo(i)}
            accessibilityLabel={`Go to ${card.title}`}
            style={[styles.dot, i === index && styles.dotActive]}
          />
        ))}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Text style={styles.footnote}>
          Phone propped up, camera facing you, about two metres back.
        </Text>
        <GradientButton
          accent="lime"
          label={isLast ? 'I understand' : 'Next move'}
          icon={isLast ? 'checkmark' : 'arrow-forward'}
          onPress={() =>
            isLast ? router.push('/(onboarding)/where-you-play' as Href) : goTo(index + 1)
          }
        />
        {!isLast ? (
          <Pressable
            onPress={() => router.push('/(onboarding)/where-you-play' as Href)}
            hitSlop={8}
            style={styles.skipRow}
          >
            <Text style={styles.skipText}>I understand, skip ahead</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  eyebrow: { ...type.label, color: colors.lime, marginBottom: 8 },
  title: { ...type.h1, color: colors.text },
  page: { alignItems: 'center', justifyContent: 'center' },
  card: {
    flex: 1,
    maxHeight: 560,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  imageWrap: {
    flex: 1,
    minHeight: 200,
    backgroundColor: colors.bgElevated,
  },
  cardBody: {
    padding: spacing.lg,
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 2 },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(215,255,62,0.12)',
  },
  cardEyebrow: { ...type.micro, color: colors.textDim },
  cardTitle: { ...type.h2, color: colors.text },
  cardCaption: { ...type.body, color: colors.textDim },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  dotActive: { width: 22, backgroundColor: colors.lime },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footnote: { ...type.bodySm, color: colors.textFaint, textAlign: 'center' },
  skipRow: { alignSelf: 'center', paddingVertical: spacing.xs, paddingHorizontal: spacing.lg },
  skipText: { color: colors.textDim, fontSize: 13, fontWeight: font.bold },
});
