import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
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
import { reserveUsername } from '@/lib/profileSync';
import { useProgress } from '@/lib/ProgressContext';
import { normalizeUsername, USERNAME_MAX, USERNAME_MIN, validateUsername } from '@/lib/username';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Change the leaderboard handle. Unlike onboarding (offline, format-only),
 * this reserves synchronously through the `reserveUsername` Function and
 * surfaces "taken". Local progress adopts the handle only once reserved.
 */
export default function EditUsernameScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { username, setUsername } = useProgress();

  const [value, setValue] = useState(username ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile');
  };

  const normalized = normalizeUsername(value);
  const localCheck = validateUsername(normalized);

  const submit = async () => {
    if (busy) return;
    setSuccess(null);
    if (!user) {
      setError('Sign in to reserve a username.');
      return;
    }
    if (!localCheck.valid) {
      setError(localCheck.reason ?? 'Invalid username');
      return;
    }
    if (normalized === username) {
      setError('That is already your username.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await reserveUsername(normalized);
      switch (result.status) {
        case 'reserved':
          setUsername(result.handle);
          setSuccess(`You're @${result.handle} on every leaderboard now.`);
          break;
        case 'taken':
          setError('That username is taken. Try another.');
          break;
        case 'invalid':
        case 'error':
          setError(result.message);
          break;
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xxl },
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
          <Text style={styles.headerTitle}>Change username</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.intro}>
          <Text style={styles.introTitle}>Your leaderboard handle</Text>
          <Text style={styles.introText}>
            {USERNAME_MIN}–{USERNAME_MAX} characters: lowercase letters, numbers and underscores. Usernames are unique
            across CardioSurf, so a taken one will be refused.
          </Text>
        </View>

        <View style={styles.currentCard}>
          <Text style={styles.currentLabel}>Current username</Text>
          <Text style={styles.currentValue}>{username ? `@${username}` : 'Not set'}</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputWrap}>
            <Text style={styles.at}>@</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              maxLength={USERNAME_MAX}
              onChangeText={(next) => {
                setValue(next);
                setError(null);
                setSuccess(null);
              }}
              onSubmitEditing={submit}
              placeholder="new_username"
              placeholderTextColor={colors.textFaint}
              returnKeyType="done"
              style={styles.input}
              value={value}
              accessibilityLabel="New username"
            />
          </View>
          {!localCheck.valid && normalized.length > 0 ? (
            <Text style={styles.hintText}>{localCheck.reason}</Text>
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
            style={({ pressed }) => [styles.submit, busy && styles.disabled, pressed && !busy && styles.pressed]}
          >
            {busy ? <ActivityIndicator color={colors.black} /> : <Text style={styles.submitText}>RESERVE USERNAME</Text>}
          </Pressable>
        </View>
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
  headerTitle: { flex: 1, color: colors.text, fontSize: 16, fontWeight: font.bold, textAlign: 'center' },
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
  inputWrap: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: spacing.lg,
  },
  at: { color: colors.textFaint, fontSize: 16, fontWeight: font.bold },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingHorizontal: spacing.xs, paddingRight: spacing.lg, minHeight: 52 },
  hintText: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  submit: {
    minHeight: 54,
    borderRadius: radius.button,
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
    backgroundColor: 'rgba(215,255,62,0.10)',
    borderWidth: 1,
    borderColor: colors.lime,
  },
  successText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: font.medium },
});
