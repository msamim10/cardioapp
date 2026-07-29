import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  findNodeHandle,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, spacing } from '@/theme';

type CameraPermissionPromptProps = {
  visible: boolean;
  canAskAgain: boolean;
  requesting: boolean;
  beginTriggered: boolean;
  onRequestPermission: () => void;
  onOpenSettings: () => void;
  onContinue: () => void;
};

export function CameraPermissionPrompt({
  visible,
  canAskAgain,
  requesting,
  beginTriggered,
  onRequestPermission,
  onOpenSettings,
  onContinue,
}: CameraPermissionPromptProps) {
  const insets = useSafeAreaInsets();
  const titleRef = useRef<Text>(null);
  const primaryLabel = canAskAgain ? 'ENABLE CAMERA' : 'OPEN SETTINGS';
  const secondaryLabel = beginTriggered ? 'CONTINUE WITHOUT CAMERA' : 'NOT NOW';

  const focusPrompt = () => {
    requestAnimationFrame(() => {
      const node = findNodeHandle(titleRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onShow={focusPrompt}
      onRequestClose={onContinue}
    >
      <View style={styles.modal}>
        <Pressable
          accessible={false}
          disabled={requesting}
          onPress={onContinue}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.card,
            { marginBottom: Math.max(insets.bottom, spacing.md) },
          ]}
        >
          <View style={styles.iconShell}>
            <Ionicons name="camera-outline" size={28} color={colors.lime} />
          </View>

          <Text ref={titleRef} accessible accessibilityRole="header" style={styles.title}>
            See your form on screen
          </Text>
          <Text style={styles.copy}>
            On TV, your phone shows a larger form preview. On your phone, a small preview
            appears in the corner.
          </Text>

          <View style={styles.privacy}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.cyan} />
            <Text style={styles.privacyText}>
              Your preview stays on-device and is never recorded.
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
            accessibilityState={{ busy: requesting, disabled: requesting }}
            disabled={requesting}
            onPress={canAskAgain ? onRequestPermission : onOpenSettings}
            style={({ pressed }) => [
              styles.primary,
              requesting && styles.disabled,
              pressed && !requesting && styles.pressed,
            ]}
          >
            {requesting ? (
              <ActivityIndicator color={colors.black} />
            ) : (
              <Ionicons
                name={canAskAgain ? 'camera-outline' : 'settings-outline'}
                size={19}
                color={colors.black}
              />
            )}
            <Text style={styles.primaryText}>{primaryLabel}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={secondaryLabel}
            disabled={requesting}
            onPress={onContinue}
            style={({ pressed }) => [
              styles.secondary,
              requesting && styles.disabled,
              pressed && !requesting && styles.pressed,
            ]}
          >
            <Text style={styles.secondaryText}>{secondaryLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(3,3,7,0.76)',
  },
  card: {
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    shadowColor: colors.black,
    shadowOpacity: 0.45,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 18,
  },
  iconShell: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: 'rgba(198,255,61,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(198,255,61,0.22)',
  },
  title: {
    color: colors.text,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: font.black,
    letterSpacing: -0.35,
    marginTop: spacing.lg,
  },
  copy: {
    color: colors.textDim,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: font.medium,
    marginTop: spacing.sm,
  },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  privacyText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: font.semibold,
  },
  primary: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
  },
  primaryText: {
    color: colors.black,
    fontSize: 14,
    fontWeight: font.black,
    letterSpacing: 0.55,
  },
  secondary: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
    borderRadius: radius.pill,
  },
  secondaryText: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: font.bold,
    letterSpacing: 0.35,
  },
  disabled: { opacity: 0.68 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
});
