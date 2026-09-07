import Ionicons from '@expo/vector-icons/Ionicons';
import { VideoAirPlayButton } from 'expo-video';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, radius, spacing, type } from '@/theme';

/**
 * The native AirPlay route picker framed as a full-width box, with the text
 * doubling as the connection status so there is exactly one thing to read:
 *
 * - not connected → "Choose your TV" + a one-line hint
 * - connected (screen mirroring or an AirPlay route) → "Connected" + the
 *   receiver name when iOS reports one, else "Your TV is ready"
 *
 * Deselecting the TV in the picker drops the route, so the box falls back to
 * "Choose your TV" on its own. Shared by the onboarding TV card and the setup
 * guide so both show the identical state. iOS only: renders nothing elsewhere,
 * and callers keep the Control Center instructions visible regardless.
 */
export function AirPlayConnectBox({
  connected,
  deviceName,
  idleTitle = 'Choose your TV',
  idleDetail = 'Tap the AirPlay icon and pick your TV',
  style,
}: {
  connected: boolean;
  /** `airPlayDeviceName` from the detector; ignored while not connected. */
  deviceName?: string | null;
  idleTitle?: string;
  idleDetail?: string;
  style?: StyleProp<ViewStyle>;
}) {
  if (Platform.OS !== 'ios') return null;
  const title = connected ? 'Connected' : idleTitle;
  const detail = connected ? deviceName?.trim() || 'Your TV is ready' : idleDetail;
  return (
    <View
      style={[styles.box, style]}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${title}. ${detail}`}
    >
      <View style={styles.well}>
        <VideoAirPlayButton
          style={styles.native}
          tint={colors.black}
          activeTint={colors.black}
          prioritizeVideoDevices
          accessibilityRole="button"
          accessibilityLabel="Choose an AirPlay display"
        />
      </View>
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, connected && styles.titleConnected]}>{title}</Text>
          {connected ? (
            <Ionicons name="checkmark-circle" size={16} color={colors.lime} />
          ) : null}
        </View>
        <Text style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface3,
  },
  well: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lime,
  },
  native: { width: 44, height: 44 },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...type.body, color: colors.text, fontWeight: font.bold },
  titleConnected: { color: colors.lime },
  detail: { ...type.bodySm, color: colors.textDim },
});
