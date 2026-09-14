import Ionicons from '@expo/vector-icons/Ionicons';
import { VideoAirPlayButton } from 'expo-video';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton, OptionCard } from '@/components/ui';
import type { CompositeAvailability } from '@/lib/compositeAssetCache';
import {
  DURATION_OPTIONS,
  INTENSITY_META,
  INTENSITY_ORDER,
  type PlayScreen,
  type RunSettings,
} from '@/lib/playSetup';
import { colors, font, metric, radius, spacing, type } from '@/theme';

/** One line under every "Record my runs" toggle (sheet, Settings, invitation). */
export const RECORD_RUNS_BLURB = 'Saved on your phone. Share whenever you like.';

export type RecordBlockers = {
  /** iOS physical device with the writer + composer linked. */
  deviceCapable: boolean;
  /** Camera permission explicitly denied. */
  cameraDenied: boolean;
  /** Whether this level's composite game asset is hosted. */
  compositeState: CompositeAvailability | 'checking';
};

/**
 * Why recording cannot run right now, or null. Pure so the level screen (for
 * the `record` preflight param) and the sheet (live, as the destination
 * changes) agree.
 */
export function recordBlockedReasonFor(destination: PlayScreen, blockers: RecordBlockers): string | null {
  if (destination === 'tv') return 'Not available for TV runs yet. Choose Phone to record.';
  if (!blockers.deviceCapable) return 'Body tracking is unavailable in this build, so runs cannot be recorded.';
  if (blockers.cameraDenied) return 'Camera access is off. Enable it in Settings to record.';
  if (blockers.compositeState === 'missing') return "Recording isn't available for this map yet.";
  return null;
}

/**
 * Run settings sheet (the top-right sliders button on the level brief).
 * Intensity maps to the playback rate (0.85 / 1.0 / 1.2x); duration is the
 * wall-clock length of the run. Those two are a draft committed on Save so a
 * swipe-down leaves them untouched. The screen (Phone / TV) and "Record my
 * runs" are reported immediately through their callbacks — the AirPlay
 * picker is a native side effect that cannot wait for Save — and the caller
 * persists them and re-reads the play setup when the sheet closes.
 */
export function RunSettingsSheet({
  visible,
  value,
  destination,
  recordRun,
  recordBlockers,
  onDestinationChange,
  onRecordRunChange,
  onClose,
  onSave,
}: {
  visible: boolean;
  value: RunSettings;
  destination: PlayScreen;
  recordRun: boolean;
  recordBlockers: RecordBlockers;
  onDestinationChange: (next: PlayScreen) => void;
  onRecordRunChange: (next: boolean) => void;
  onClose: () => void;
  onSave: (next: RunSettings) => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<RunSettings>(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [value, visible]);

  const rate = INTENSITY_META[draft.intensity].playbackRate;
  const blockedReason = recordBlockedReasonFor(destination, recordBlockers);
  const recordOn = recordRun && blockedReason === null;

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
            <Text style={styles.eyebrow}>Run settings</Text>
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

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
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
              <Text style={styles.groupMeta}>Loops until time is up</Text>
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

          {Platform.OS === 'ios' ? (
            <View style={styles.group}>
              <View style={styles.groupHead}>
                <Text style={styles.groupTitle}>Screen</Text>
                <Text style={styles.groupMeta}>{destination === 'tv' ? 'TV / AirPlay' : 'Phone'}</Text>
              </View>
              <View style={styles.options}>
                <OptionCard
                  title="Phone"
                  desc="Play on this device"
                  icon="phone-portrait-outline"
                  selected={destination === 'phone'}
                  onPress={() => onDestinationChange('phone')}
                />
                <View
                  style={styles.tvAirplayCardWrap}
                  pointerEvents="box-none"
                  accessibilityRole="radio"
                  accessibilityLabel="TV or AirPlay"
                  accessibilityHint="Opens the AirPlay picker to choose your display"
                  accessibilityState={{ selected: destination === 'tv' }}
                >
                  {/* Visual-only card — touches pass through to the native picker overlay. */}
                  <View pointerEvents="none">
                    <OptionCard
                      title="TV / AirPlay"
                      desc="Stream to Apple TV or an AirPlay display"
                      icon="tv-outline"
                      selected={destination === 'tv'}
                    />
                  </View>
                  {/* Invisible native route picker — transparent tint keeps the icon hidden while opacity stays 1 for hit-testing. */}
                  <VideoAirPlayButton
                    style={styles.tvAirplayOverlay}
                    tint="#00000000"
                    activeTint="#00000000"
                    prioritizeVideoDevices
                    onBeginPresentingRoutes={() => onDestinationChange('tv')}
                    accessibilityRole="button"
                    accessibilityLabel="Choose an AirPlay display"
                    accessibilityHint="Opens the system AirPlay route picker"
                  />
                </View>
              </View>
            </View>
          ) : null}

          {Platform.OS === 'ios' ? (
            <View style={styles.group}>
              <View
                style={[styles.recordRow, blockedReason && styles.recordRowDisabled]}
                accessible
                accessibilityRole="switch"
                accessibilityLabel="Record my runs"
                accessibilityHint={blockedReason ?? RECORD_RUNS_BLURB}
                accessibilityState={{ checked: recordOn, disabled: blockedReason !== null }}
              >
                <View style={[styles.recordIcon, recordOn && styles.recordIconOn]}>
                  <Ionicons
                    name={recordOn ? 'videocam' : 'videocam-outline'}
                    size={18}
                    color={recordOn ? '#FF3B30' : colors.lime}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.recordTitle}>Record my runs</Text>
                  <Text style={styles.blurb}>{blockedReason ?? RECORD_RUNS_BLURB}</Text>
                </View>
                <Switch
                  value={recordOn}
                  onValueChange={onRecordRunChange}
                  disabled={blockedReason !== null}
                  trackColor={{ true: colors.lime, false: colors.surface3 }}
                  thumbColor={colors.white}
                  ios_backgroundColor={colors.surface3}
                />
              </View>
            </View>
          ) : null}
        </ScrollView>

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
  scroll: { flex: 1 },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
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
  options: { gap: spacing.sm },
  tvAirplayCardWrap: { position: 'relative' },
  tvAirplayOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordRowDisabled: { opacity: 0.7 },
  recordIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(215,255,62,0.1)',
  },
  recordIconOn: { backgroundColor: 'rgba(255,59,48,0.12)' },
  recordTitle: { ...type.h3, color: colors.text, marginBottom: 2 },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footnote: { ...type.bodySm, color: colors.textFaint, textAlign: 'center' },
});
