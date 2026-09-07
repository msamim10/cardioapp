import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton } from '@/components/ui';
import {
  DURATION_OPTIONS,
  INTENSITY_META,
  INTENSITY_ORDER,
  type RunSettings,
} from '@/lib/playSetup';
import { colors, font, metric, radius, spacing, type } from '@/theme';

/**
 * Per-run Edit sheet. Intensity maps to the map's playback rate (0.85 / 1.0 /
 * 1.2x); duration is the wall-clock length of the run, met by looping the map
 * video until the target is reached. Changes are only committed on Save so a
 * swipe-down leaves the previous settings untouched.
 */
export function RunSettingsSheet({
  visible,
  value,
  onClose,
  onSave,
}: {
  visible: boolean;
  value: RunSettings;
  onClose: () => void;
  onSave: (next: RunSettings) => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<RunSettings>(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [value, visible]);

  const rate = INTENSITY_META[draft.intensity].playbackRate;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Edit run</Text>
            <Text style={styles.title}>Set the session</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close without saving"
            hitSlop={10}
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        </View>

        <View style={styles.body}>
          <View style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={styles.groupTitle}>Intensity</Text>
              <Text style={styles.groupMeta}>{rate.toFixed(2)}x speed</Text>
            </View>
            <View style={styles.segmented} accessibilityRole="radiogroup">
              {INTENSITY_ORDER.map((key) => {
                const meta = INTENSITY_META[key];
                const selected = draft.intensity === key;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${meta.label}. ${meta.blurb}`}
                    onPress={() => setDraft((d) => ({ ...d, intensity: key }))}
                    style={({ pressed }) => [
                      styles.segment,
                      selected && styles.segmentSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons
                      name={meta.icon}
                      size={18}
                      color={selected ? colors.black : colors.textDim}
                    />
                    <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
                      {meta.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.blurb}>{INTENSITY_META[draft.intensity].blurb}</Text>
          </View>

          <View style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={styles.groupTitle}>Duration</Text>
              <Text style={styles.groupMeta}>Map loops until time is up</Text>
            </View>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {DURATION_OPTIONS.map((minutes) => {
                const selected = draft.durationMin === minutes;
                return (
                  <Pressable
                    key={minutes}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${minutes} minutes`}
                    onPress={() => setDraft((d) => ({ ...d, durationMin: minutes }))}
                    style={({ pressed }) => [
                      styles.chip,
                      selected && styles.chipSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipValue, selected && styles.chipValueSelected]}>
                      {minutes}
                    </Text>
                    <Text style={[styles.chipUnit, selected && styles.chipUnitSelected]}>min</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={styles.footnote}>Saved as your default for the next run.</Text>
          <GradientButton
            label="Save"
            icon="checkmark"
            accent="lime"
            onPress={() => onSave(draft)}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  eyebrow: { ...type.label, color: colors.lime, marginBottom: 6 },
  title: { ...type.h2, color: colors.text },
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
  pressed: { opacity: 0.75 },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, gap: spacing.xxl },
  group: { gap: spacing.md },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  groupTitle: { ...type.h3, color: colors.text },
  groupMeta: { ...metric, ...type.bodySm, color: colors.textFaint },
  segmented: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segment: {
    flex: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentSelected: { backgroundColor: colors.lime, borderColor: colors.lime },
  segmentLabel: { color: colors.text, fontSize: 13, fontWeight: font.bold },
  segmentLabelSelected: { color: colors.black },
  blurb: { ...type.bodySm, color: colors.textDim },
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    flex: 1,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.lime, borderColor: colors.lime },
  chipValue: { ...metric, color: colors.text, fontSize: 26, fontWeight: font.heavy, letterSpacing: -0.8 },
  chipValueSelected: { color: colors.black },
  chipUnit: { ...type.micro, color: colors.textDim },
  chipUnitSelected: { color: colors.black },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footnote: { ...type.bodySm, color: colors.textFaint, textAlign: 'center' },
});
