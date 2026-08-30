import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  GradientButton,
  OnboardingTopBar,
  UsernameField,
  type UsernameStatus,
} from '@/components/ui';
import { useProgress } from '@/lib/ProgressContext';
import {
  checkUsernameAvailable,
  generateUsername,
  normalizeUsername,
  validateUsername,
} from '@/lib/username';
import { onboardingProgress } from '@/lib/onboarding';
import { colors, spacing, type } from '@/theme';

export default function UsernameScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { username, setUsername } = useProgress();

  const [value, setValue] = useState(() => username ?? generateUsername());
  const [status, setStatus] = useState<UsernameStatus>('empty');
  const [hint, setHint] = useState('Lowercase and numbers, 3-20 characters. Tap shuffle for a suggestion.');

  // Track the most recent value so an in-flight availability check can't apply a
  // stale result after the user keeps typing.
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    const check = validateUsername(value);
    if (!check.valid) {
      setStatus(value.length === 0 ? 'empty' : 'invalid');
      setHint(check.reason && check.reason !== 'empty' ? check.reason : 'Lowercase and numbers, 3-20 characters.');
      return;
    }
    setStatus('checking');
    setHint('Checking availability…');
    let active = true;
    const timer = setTimeout(async () => {
      const available = await checkUsernameAvailable(value);
      if (!active || latest.current !== value) return;
      if (available) {
        setStatus('valid');
        setHint('Available.');
      } else {
        setStatus('invalid');
        setHint('Already taken. Try another.');
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [value]);

  const onChangeText = (text: string) => setValue(normalizeUsername(text));
  const onRandomize = () => setValue(generateUsername());

  const onContinue = () => {
    if (status !== 'valid') return;
    setUsername(value);
    router.push('/(onboarding)/climb');
  };

  return (
    <View style={styles.root}>
      <OnboardingTopBar progress={onboardingProgress('username')} topInset={insets.top} onBack={() => router.back()} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Claim your handle</Text>
          <Text style={styles.sub}>
            This is how you appear in challenges and on leaderboards.
          </Text>

          <View style={styles.fieldWrap}>
            <UsernameField
              value={value}
              onChangeText={onChangeText}
              onRandomize={onRandomize}
              status={status}
            />
            <Text style={[styles.hint, status === 'invalid' && styles.hintError]}>{hint}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <GradientButton
          label="CONTINUE"
          accent="lime"
          onPress={status === 'valid' ? onContinue : undefined}
          style={status !== 'valid' ? styles.disabled : undefined}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxxl, alignItems: 'center' },
  title: {
    ...type.h1,
    color: colors.text,
    textAlign: 'center',
  },
  sub: {
    ...type.body,
    color: colors.textDim,
    marginTop: spacing.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  fieldWrap: { alignSelf: 'stretch', marginTop: spacing.xxl },
  hint: { ...type.bodySm, color: colors.textFaint, marginTop: spacing.md, marginLeft: 4 },
  hintError: { color: colors.effort },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  disabled: { opacity: 0.4 },
});
