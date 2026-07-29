import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/AuthContext';
import { colors, font, radius, spacing } from '@/theme';

// Deliberately forgiving: catches obvious typos without rejecting valid
// addresses. Firebase performs authoritative validation on submit.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EditEmailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, updateUserEmail } = useAuth();
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const currentEmail = user?.email ?? null;
  const managed = user != null && !user.isGuest && !user.canChangeEmail;
  const managedBy = user?.providers.includes('apple') ? 'Apple' : 'Google';

  const onBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/profile');
  };

  const submit = async () => {
    if (busy) return;
    const trimmed = email.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      setSuccess(null);
      setError('Enter a valid email address.');
      return;
    }
    if (currentEmail && trimmed.toLowerCase() === currentEmail.toLowerCase()) {
      setSuccess(null);
      setError('That is already your email address.');
      return;
    }
    if (needsPassword && !password) {
      setSuccess(null);
      setError('Enter your current password to confirm.');
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await updateUserEmail(trimmed, needsPassword ? password : undefined);
      switch (result.status) {
        case 'verification-sent':
          setSuccess(
            `Verification link sent to ${result.email} — confirm it to finish the change. Your current email stays active until then.`
          );
          setPassword('');
          setNeedsPassword(false);
          break;
        case 'requires-password':
          setNeedsPassword(true);
          setError('For your security, confirm your current password to continue.');
          requestAnimationFrame(() => passwordRef.current?.focus());
          break;
        case 'not-allowed':
        case 'error':
          setError(result.message);
          break;
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
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
          <Text style={styles.headerTitle}>Change email</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.intro}>
          <Text style={styles.introTitle}>Update your email</Text>
          <Text style={styles.introText}>
            We’ll send a verification link to your new address. The change takes effect once you
            confirm it from that inbox.
          </Text>
        </View>

        <View style={styles.currentCard}>
          <Text style={styles.currentLabel}>Current email</Text>
          <Text style={styles.currentValue}>{currentEmail ?? 'Not set'}</Text>
        </View>

        {managed ? (
          <View style={styles.infoBox}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textDim} />
            <Text style={styles.infoText}>
              Your email is managed by {managedBy} and can’t be changed here. Update it from your
              {' '}
              {managedBy} account instead.
            </Text>
          </View>
        ) : (
          <View style={styles.form}>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              editable={!busy}
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="New email address"
              placeholderTextColor={colors.textFaint}
              returnKeyType={needsPassword ? 'next' : 'done'}
              onSubmitEditing={needsPassword ? () => passwordRef.current?.focus() : submit}
              style={styles.input}
              value={email}
            />
            {needsPassword ? (
              <TextInput
                ref={passwordRef}
                autoCapitalize="none"
                autoComplete="current-password"
                editable={!busy}
                onChangeText={setPassword}
                onSubmitEditing={submit}
                placeholder="Current password"
                placeholderTextColor={colors.textFaint}
                returnKeyType="done"
                secureTextEntry
                style={styles.input}
                value={password}
              />
            ) : null}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {success ? (
              <View style={styles.successBox}>
                <Ionicons name="checkmark-circle" size={18} color={colors.lime} />
                <Text style={styles.successText}>{success}</Text>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={submit}
              style={({ pressed }) => [
                styles.submit,
                busy && styles.disabled,
                pressed && !busy && styles.pressed,
              ]}
            >
              {busy ? (
                <ActivityIndicator color={colors.black} />
              ) : (
                <Text style={styles.submitText}>SEND VERIFICATION LINK</Text>
              )}
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
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
  currentCard: {
    gap: 4,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  currentLabel: { color: colors.textFaint, fontSize: 12, fontWeight: font.bold, letterSpacing: 0.4 },
  currentValue: { color: colors.text, fontSize: 16, fontWeight: font.semibold },
  form: { gap: spacing.sm },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.lg,
  },
  submit: {
    minHeight: 54,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lime,
    marginTop: spacing.xs,
  },
  submitText: { color: colors.black, fontSize: 15, fontWeight: font.black, letterSpacing: 0.3 },
  disabled: { opacity: 0.5 },
  errorText: { color: colors.pink, fontSize: 13, lineHeight: 18 },
  successBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(198,255,61,0.10)',
    borderWidth: 1,
    borderColor: colors.lime,
  },
  successText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: font.medium },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoText: { flex: 1, color: colors.textDim, fontSize: 14, lineHeight: 20, fontWeight: font.medium },
});
