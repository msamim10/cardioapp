import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { VideoAirPlayButton } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GhostButton, GradientButton } from '@/components/ui';
import type { ExternalDisplayStatus } from '@/lib/externalDisplay';
import { colors, font, radius, spacing, type } from '@/theme';

type GuideStep = {
  key: string;
  title: string;
  detail: string;
  image: number;
};

/**
 * Screen-mirroring walkthrough. The illustrations are original phone-UI mocks
 * (generic tiles and glyphs, no platform logos or trademarks), so the steps read
 * without leaning on anyone else's interface.
 */
const STEPS: GuideStep[] = [
  {
    key: 'control-center',
    title: 'Open Control Center',
    detail: 'Swipe down from the top-right corner of your phone.',
    image: require('../../assets/tv-guide/step-1.jpg'),
  },
  {
    key: 'mirroring',
    title: 'Tap Screen Mirroring',
    detail: 'It is the tile with two overlapping screens.',
    image: require('../../assets/tv-guide/step-2.jpg'),
  },
  {
    key: 'choose-tv',
    title: 'Choose your TV',
    detail: 'Pick it from the list. Your TV and phone need to be on the same Wi-Fi.',
    image: require('../../assets/tv-guide/step-3.jpg'),
  },
];

export function TvSetupGuide({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const imageWidth = Math.min(180, Math.round(width * 0.36));
  const imageHeight = Math.round(imageWidth * 1.5);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={[styles.sheetHeader, { paddingTop: Platform.OS === 'ios' ? spacing.lg : insets.top + spacing.sm }]}>
          <View>
            <Text style={styles.sheetEyebrow}>TV setup</Text>
            <Text style={styles.sheetTitle}>Put the run on your TV</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close TV setup guide"
            hitSlop={10}
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + spacing.xxl }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>
            Mirror your phone to the TV, then keep the phone propped up facing you. The
            camera keeps reading your body while the map plays on the big screen.
          </Text>

          {STEPS.map((step, index) => (
            <View key={step.key} style={styles.step}>
              <View style={[styles.stepImage, { width: imageWidth, height: imageHeight }]}>
                <Image
                  source={step.image}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  accessibilityLabel={`Step ${index + 1} illustration: ${step.title}`}
                />
              </View>
              <View style={styles.stepText}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText}>{index + 1}</Text>
                </View>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDetail}>{step.detail}</Text>
              </View>
            </View>
          ))}

          {Platform.OS === 'ios' ? (
            <View style={styles.airplayBlock}>
              <Text style={styles.airplayTitle}>Have an AirPlay TV?</Text>
              <Text style={styles.airplayDetail}>
                You can also pick it here. During a run, the map video streams to the TV
                and your phone becomes the camera and dashboard.
              </Text>
              <View style={styles.airplayRow}>
                <Text style={styles.airplayRowLabel}>Tap the AirPlay icon to pick a display</Text>
                <VideoAirPlayButton
                  style={styles.airplayNative}
                  tint={colors.lime}
                  activeTint={colors.lime}
                  prioritizeVideoDevices
                  accessibilityRole="button"
                  accessibilityLabel="Choose an AirPlay display"
                />
              </View>
            </View>
          ) : null}

          <GradientButton label="Got it" accent="lime" onPress={onClose} style={{ marginTop: spacing.lg }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

export type TvConnectionState = 'waiting' | 'confirmed';

/**
 * The "Waiting for TV…" card.
 *
 * On iOS native builds the local `external-display` module watches
 * `UIScreen` connect/disconnect notifications, so AirPlay screen mirroring and
 * wired adapters are detected for real: pass `detection` and the card flips to
 * "TV connected" on its own, with no manual confirm button. Where detection is
 * unsupported (Expo Go, Android, web) the card falls back to the honest
 * behaviour: it pulses while the user sets up and the user confirms when the
 * TV shows this screen. Nothing is ever faked in either mode.
 */
export function TvConnectionCard({
  state,
  detection,
  onConfirm,
  onHelp,
  onUsePhone,
}: {
  state: TvConnectionState;
  /** Live detector status; omit or pass `supported: false` for manual mode. */
  detection?: ExternalDisplayStatus;
  onConfirm: () => void;
  onHelp: () => void;
  onUsePhone?: () => void;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  const [elapsedTick, setElapsedTick] = useState(0);
  const autoDetect = detection?.supported === true;

  useEffect(() => {
    if (state !== 'waiting') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    const tick = setInterval(() => setElapsedTick((t) => t + 1), 1000);
    return () => {
      loop.stop();
      clearInterval(tick);
    };
  }, [pulse, state]);

  const confirmed = state === 'confirmed';
  const showNudge = !confirmed && elapsedTick >= 12;

  const detail = confirmed
    ? autoDetect
      ? 'Your phone is mirroring to the TV. Keep it propped up facing you and the run plays on the big screen.'
      : 'Keep the phone propped up facing you. The run plays on the TV.'
    : autoDetect
      ? 'Mirror your screen now. This flips to connected the moment your TV picks it up.'
      : 'Mirror your screen now. When this screen shows on your TV, confirm below.';

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.connection, confirmed && styles.connectionConfirmed]}
    >
      <View style={styles.connectionRow}>
        <View style={styles.connectionIcon}>
          {confirmed ? (
            <Ionicons name="checkmark" size={18} color={colors.black} />
          ) : (
            <Animated.View
              style={[
                styles.connectionPulse,
                { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
              ]}
            />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.connectionTitle}>
            {confirmed ? 'TV connected' : 'Waiting for TV…'}
          </Text>
          <Text style={styles.connectionDetail}>{detail}</Text>
        </View>
      </View>

      {!confirmed ? (
        <View style={styles.connectionActions}>
          {autoDetect ? null : (
            <GradientButton
              label="My TV shows this"
              icon="tv"
              accent="lime"
              onPress={onConfirm}
            />
          )}
          <View style={styles.connectionLinks}>
            <Pressable onPress={onHelp} hitSlop={8} style={styles.linkBtn}>
              <Ionicons name="help-circle-outline" size={16} color={colors.lime} />
              <Text style={styles.linkText}>Having trouble?</Text>
            </Pressable>
            {showNudge && onUsePhone ? (
              <Pressable onPress={onUsePhone} hitSlop={8} style={styles.linkBtn}>
                <Text style={styles.linkTextDim}>Use my phone for now</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : (
        <GhostButton label="Setup guide" icon="help-circle-outline" onPress={onHelp} style={styles.changeBtn} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetEyebrow: { ...type.label, color: colors.lime, marginBottom: 6 },
  sheetTitle: { ...type.h2, color: colors.text },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.72 },
  sheetContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.lg },
  intro: { ...type.body, color: colors.textDim },
  step: {
    flexDirection: 'row',
    gap: spacing.lg,
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepImage: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.bgElevated,
  },
  stepText: { flex: 1, gap: 6 },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lime,
    marginBottom: 2,
  },
  stepBadgeText: { color: colors.black, fontSize: 13, fontWeight: font.heavy },
  stepTitle: { ...type.h3, color: colors.text },
  stepDetail: { ...type.bodySm, color: colors.textDim },
  airplayBlock: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  airplayTitle: { ...type.h3, color: colors.text },
  airplayDetail: { ...type.bodySm, color: colors.textDim },
  airplayRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  airplayRowLabel: { ...type.bodySm, color: colors.text, flex: 1, fontWeight: font.semibold },
  airplayNative: { width: 44, height: 44 },

  connection: {
    padding: spacing.lg,
    gap: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  connectionConfirmed: { borderColor: colors.lime },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  connectionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lime,
  },
  connectionPulse: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.black,
  },
  connectionTitle: { ...type.h3, color: colors.text },
  connectionDetail: { ...type.bodySm, color: colors.textDim, marginTop: 3 },
  connectionActions: { gap: spacing.sm },
  connectionLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
    flexWrap: 'wrap',
  },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: spacing.sm },
  linkText: { color: colors.lime, fontSize: 14, fontWeight: font.bold },
  linkTextDim: { color: colors.textDim, fontSize: 14, fontWeight: font.bold },
  changeBtn: { alignSelf: 'flex-start', minHeight: 40, paddingVertical: 8, paddingHorizontal: spacing.lg },
});
