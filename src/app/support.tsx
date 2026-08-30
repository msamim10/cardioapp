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
import {
  SUPPORT_CATEGORIES,
  SUPPORT_MESSAGE_MAX_LENGTH,
  submitSupportMessage,
  type SupportCategory,
} from '@/lib/support';
import { colors, font, radius, spacing } from '@/theme';

export default function SupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [category, setCategory] = useState<SupportCategory>('question');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const trimmed = message.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const onBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/profile');
  };

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitSupportMessage({ message: trimmed, category, user });
      setMessage('');
      setSent(true);
    } catch {
      setError('We couldn’t send your message. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <View style={styles.root}>
        <View
          style={[
            styles.content,
            styles.successWrap,
            { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xl },
          ]}
        >
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={34} color={colors.black} />
          </View>
          <Text style={styles.successTitle}>Thanks — we got your message</Text>
          <Text style={styles.successText}>
            Our team will take a look. If a reply is needed we’ll reach out
            {user?.email ? ` at ${user.email}` : ''}.
          </Text>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Done"
            style={({ pressed }) => [styles.submit, styles.successButton, pressed && styles.pressed]}
          >
            <Text style={styles.submitText}>Done</Text>
          </Pressable>
          <Pressable
            onPress={() => setSent(false)}
            accessibilityRole="button"
            accessibilityLabel="Send another message"
            hitSlop={8}
            style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryActionText}>Send another message</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: insets.top + spacing.sm,
              paddingBottom: insets.bottom + spacing.xxl,
            },
          ]}
          keyboardShouldPersistTaps="handled"
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
            <Text style={styles.headerTitle}>Help & Support</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.intro}>
            <Text style={styles.introTitle}>How can we help?</Text>
            <Text style={styles.introText}>
              Tell us what’s going on — a question, a problem, or an idea. Send it over and
              we’ll take a look.
            </Text>
          </View>

          {user?.email ? (
            <View style={styles.field}>
              <Text style={styles.label}>Your email</Text>
              <View style={styles.readonlyBox}>
                <Text style={styles.readonlyText}>{user.email}</Text>
              </View>
              <Text style={styles.help}>We’ll use this if we need to reply.</Text>
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.label}>Topic</Text>
            <View style={styles.chips}>
              {SUPPORT_CATEGORIES.map((option) => {
                const active = option.key === category;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => setCategory(option.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.chip,
                      active && styles.chipActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Message</Text>
            <TextInput
              value={message}
              onChangeText={(next) => {
                setMessage(next);
                if (error) setError(null);
              }}
              placeholder="Describe your question or issue…"
              placeholderTextColor={colors.textFaint}
              multiline
              textAlignVertical="top"
              maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
              editable={!submitting}
              style={styles.input}
              accessibilityLabel="Support message"
            />
            <Text style={styles.counter}>
              {message.length} / {SUPPORT_MESSAGE_MAX_LENGTH}
            </Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            onPress={onSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSubmit }}
            style={({ pressed }) => [
              styles.submit,
              !canSubmit && styles.submitDisabled,
              pressed && canSubmit && styles.pressed,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.black} />
            ) : (
              <Text style={styles.submitText}>Send message</Text>
            )}
          </Pressable>

          <Text style={styles.footerNote}>
            Your message is sent securely to our team. We don’t share your details.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
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
  field: { gap: spacing.sm },
  label: { color: colors.text, fontSize: 14, fontWeight: font.bold },
  help: { color: colors.textFaint, fontSize: 12, fontWeight: font.medium },
  readonlyBox: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  readonlyText: { color: colors.textDim, fontSize: 15, fontWeight: font.medium },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.lime, borderColor: colors.lime },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: font.semibold },
  chipTextActive: { color: colors.black },
  input: {
    minHeight: 160,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 15,
    fontWeight: font.medium,
    lineHeight: 21,
  },
  counter: { color: colors.textFaint, fontSize: 12, fontWeight: font.medium, textAlign: 'right' },
  error: { color: colors.pink, fontSize: 13, fontWeight: font.semibold, lineHeight: 19 },
  submit: {
    minHeight: 52,
    borderRadius: radius.button,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: colors.black, fontSize: 16, fontWeight: font.black, letterSpacing: 0.2 },
  footerNote: {
    color: colors.textFaint,
    fontSize: 12,
    fontWeight: font.medium,
    lineHeight: 18,
    paddingHorizontal: spacing.xs,
  },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  successIcon: {
    width: 68,
    height: 68,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  successTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: font.black,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  successText: {
    color: colors.textDim,
    fontSize: 14,
    fontWeight: font.medium,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  successButton: { alignSelf: 'stretch', marginTop: spacing.sm },
  secondaryAction: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  secondaryActionText: { color: colors.lime, fontSize: 14, fontWeight: font.bold },
});
