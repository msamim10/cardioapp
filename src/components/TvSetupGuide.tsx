import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { VideoAirPlayButton } from 'expo-video';
import { useEffect, useRef } from 'react';
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
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton } from '@/components/ui';
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

const NOTES: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string }[] = [
  {
    icon: 'options-outline',
    title: 'No Screen Mirroring tile?',
    detail:
      'Add it in Settings → Control Center → tap the green + next to Screen Mirroring. Then try again.',
  },
  {
    icon: 'wifi',
    title: 'Which TVs work',
    detail:
      'An Apple TV, or a TV that supports AirPlay 2 (most recent Samsung, LG, Sony, Vizio and Roku sets). Both the TV and your phone must be on the same Wi-Fi network.',
  },
];

export function TvSetupGuide({
  visible,
  onClose,
  detection,
}: {
  visible: boolean;
  onClose: () => void;
  /**
   * Live detector status from the calling screen's `useExternalDisplay()`. Pass
   * it so the sheet shows the same connection state as the screen beneath.
   */
  detection?: ExternalDisplayStatus;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const imageWidth = Math.min(180, Math.round(width * 0.36));
  const imageHeight = Math.round(imageWidth * 1.5);
  const connected = detection?.supported === true && detection.connected;

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
          contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + spacing.xl }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>
            Mirror your phone to the TV, then keep the phone propped up facing you. The
            camera keeps reading your body while the map plays on the big screen.
          </Text>

          {detection?.supported ? (
            <TvStatusLine connected={connected} supported style={styles.sheetStatus} />
          ) : null}

          <AirPlayPickerRow
            title="Fastest way: pick your TV here"
            detail="Tap the AirPlay icon and choose your TV from the list."
            prominent
          />

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

          {NOTES.map((note) => (
            <View key={note.title} style={styles.note}>
              <View style={styles.noteIcon}>
                <Ionicons name={note.icon} size={18} color={colors.lime} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.noteTitle}>{note.title}</Text>
                <Text style={styles.noteDetail}>{note.detail}</Text>
              </View>
            </View>
          ))}

          <GradientButton
            label={connected ? 'Done' : 'Got it'}
            icon={connected ? 'checkmark' : undefined}
            accent="lime"
            onPress={onClose}
            style={{ marginTop: spacing.sm }}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * The native AirPlay route picker, framed as a full-width row so it is obvious
 * what the icon does. iOS only: the row renders nothing elsewhere, and callers
 * keep the Control Center instructions visible regardless.
 */
export function AirPlayPickerRow({
  title,
  detail,
  prominent = false,
  style,
}: {
  title: string;
  detail: string;
  prominent?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (Platform.OS !== 'ios') return null;
  return (
    <View
      style={[styles.airplayRow, prominent && styles.airplayRowProminent, style]}
      accessible
      accessibilityLabel={`${title}. ${detail}`}
    >
      <View style={[styles.airplayWell, prominent && styles.airplayWellProminent]}>
        <VideoAirPlayButton
          style={styles.airplayNative}
          tint={prominent ? colors.black : colors.lime}
          activeTint={prominent ? colors.black : colors.lime}
          prioritizeVideoDevices
          accessibilityRole="button"
          accessibilityLabel="Choose an AirPlay display"
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.airplayTitle}>{title}</Text>
        <Text style={styles.airplayDetail}>{detail}</Text>
      </View>
    </View>
  );
}

/**
 * Plain status line (deliberately not a box): pulsing dot + "Waiting for your
 * TV…" until the display connects, then a check + "TV connected". Where
 * detection is unsupported the copy asks for confirmation instead of implying
 * the app can see the TV.
 */
export function TvStatusLine({
  connected,
  supported,
  style,
}: {
  connected: boolean;
  supported: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (connected) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [connected, pulse]);

  const label = connected
    ? 'TV connected ✓'
    : supported
      ? 'Waiting for your TV…'
      : 'Set up your TV, then confirm below';

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
      style={[styles.statusRow, style]}
    >
      {connected ? (
        <View style={styles.statusCheck}>
          <Ionicons name="checkmark" size={12} color={colors.black} />
        </View>
      ) : (
        <Animated.View
          style={[
            styles.statusDot,
            { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
          ]}
        />
      )}
      <Text style={[styles.statusText, connected && styles.statusTextConnected]}>{label}</Text>
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
  sheetStatus: { marginTop: -spacing.sm },
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
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(215,255,62,0.1)',
  },
  noteTitle: { ...type.h3, color: colors.text, fontSize: 15 },
  noteDetail: { ...type.bodySm, color: colors.textDim },

  airplayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  airplayRowProminent: { borderColor: colors.lime, backgroundColor: colors.surface3 },
  airplayWell: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  airplayWellProminent: { backgroundColor: colors.lime },
  airplayNative: { width: 44, height: 44 },
  airplayTitle: { ...type.body, color: colors.text, fontWeight: font.bold },
  airplayDetail: { ...type.bodySm, color: colors.textDim },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 22 },
  statusDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.lime },
  statusCheck: {
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lime,
  },
  statusText: { ...type.body, color: colors.textDim, fontWeight: font.semibold },
  statusTextConnected: { color: colors.lime },
});
