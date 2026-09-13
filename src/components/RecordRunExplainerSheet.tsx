import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton } from '@/components/ui';
import { colors, font, radius, spacing, type } from '@/theme';

const POINTS: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string }[] = [
  {
    icon: 'videocam-outline',
    title: 'Your camera + the game',
    detail: 'The run video shows the map on top and your camera below, with your score and hits.',
  },
  {
    icon: 'phone-portrait-outline',
    title: 'Stays on your phone',
    detail: 'Nothing is uploaded. The video is only saved or shared when you choose to.',
  },
  {
    icon: 'volume-mute-outline',
    title: 'No audio',
    detail: 'The microphone is never used and the video is silent.',
  },
  {
    icon: 'trash-outline',
    title: 'Delete any time',
    detail: 'Only your last three run videos are kept, and you can delete each one from the results screen.',
  },
];

/**
 * One-time explainer shown the first time "Record my run" is switched on.
 * Confirming turns the toggle on; dismissing leaves it off.
 */
export function RecordRunExplainerSheet({
  visible,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}>
          <View style={styles.badge}>
            <View style={styles.recDot} />
            <Text style={styles.badgeText}>REC</Text>
          </View>
          <Text style={styles.title}>Record my run</Text>
          <Text style={styles.lead}>
            Get a shareable video of your run when you finish. Here is exactly what that means.
          </Text>
          <View style={styles.points}>
            {POINTS.map((point) => (
              <View key={point.title} style={styles.point} accessible accessibilityLabel={`${point.title}. ${point.detail}`}>
                <View style={styles.pointIcon}>
                  <Ionicons name={point.icon} size={18} color={colors.lime} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pointTitle}>{point.title}</Text>
                  <Text style={styles.pointDetail}>{point.detail}</Text>
                </View>
              </View>
            ))}
          </View>
          <GradientButton label="Turn on recording" icon="videocam" accent="lime" onPress={onConfirm} />
          <Pressable onPress={onClose} accessibilityRole="button" style={styles.cancel}>
            <Text style={styles.cancelText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet: {
    gap: spacing.md,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,59,48,0.14)',
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  badgeText: { color: '#FF3B30', fontSize: 11, fontWeight: font.black, letterSpacing: 1.2 },
  title: { ...type.h2, color: colors.text },
  lead: { ...type.bodySm, color: colors.textDim },
  points: { gap: spacing.sm },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  pointIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(215,255,62,0.1)',
  },
  pointTitle: { color: colors.text, fontSize: 15, fontWeight: font.bold },
  pointDetail: { ...type.bodySm, color: colors.textDim, marginTop: 2 },
  cancel: { alignSelf: 'center', paddingVertical: spacing.xs },
  cancelText: { color: colors.textDim, fontSize: 14, fontWeight: font.semibold },
});
