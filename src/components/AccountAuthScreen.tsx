import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Mascot } from '@/components/ui';
import { authErrorMessage, useAuth, type SignInResult } from '@/lib/AuthContext';
import { useOnboarding } from '@/lib/OnboardingContext';
import { PRIVACY_POLICY_URL, TERMS_URL, openLegalUrl } from '@/lib/legal';
import { colors, font, radius, spacing } from '@/theme';

type Mode = 'create' | 'signin';
type Busy = 'google' | 'apple' | 'email' | 'reset' | null;

const GOOGLE_G = require('../../assets/brand/google-g.svg');
const GOOGLE_TEXT = '#3C4043';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export function AccountAuthScreen({ mode }: { mode: Mode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { completeOnboarding } = useOnboarding();
  const emailRef = useRef<TextInput>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const expand = () => {
    if (expanded) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(true);
    requestAnimationFrame(() => emailRef.current?.focus());
  };

  const finish = (result: SignInResult) => {
    if (result.status === 'signed-in') {
      completeOnboarding();
      router.replace('/(tabs)');
    } else if (result.status === 'error' || result.status === 'unavailable') {
      setError(result.message);
    }
  };

  const social = async (provider: 'google' | 'apple') => {
    if (busy) return;
    setBusy(provider);
    setError(null);
    try {
      finish(provider === 'google' ? await auth.signInWithGoogle() : await auth.signInWithApple());
    } finally {
      setBusy(null);
    }
  };

  const submitEmail = async () => {
    if (busy || !email.trim() || !password) return;
    setBusy('email');
    setError(null);
    try {
      const result =
        mode === 'create'
          ? await auth.signUpWithEmail(email, password, name)
          : await auth.signInWithEmail(email, password);
      finish(result);
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    if (!email.trim()) {
      setError('Enter your email first.');
      return;
    }
    setBusy('reset');
    setError(null);
    try {
      await auth.resetPassword(email);
      Alert.alert('Check your email', 'We sent a password reset link if that account exists.');
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const isCreate = mode === 'create';
  const disabled = busy !== null;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
        ]}
      >
        <Pressable
          accessibilityLabel="Back"
          hitSlop={8}
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace('/(onboarding)/welcome')
          }
          style={styles.back}
        >
          <Ionicons name="arrow-back" size={21} color={colors.text} />
        </Pressable>

        <View style={styles.header}>
          <Mascot variant="avatar" size={82} />
          <Text style={styles.title}>{isCreate ? 'Save your progress' : 'Welcome back'}</Text>
          <Text style={styles.subtitle}>
            {isCreate
              ? 'Create an account to keep your runs and subscription connected across devices.'
              : 'Sign in to restore your runs, stats, and subscription.'}
          </Text>
        </View>

        {!auth.configured ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{auth.configurationError}</Text>
          </View>
        ) : null}

        <View style={styles.stack}>
          <Pressable
            accessibilityLabel="Continue with Apple"
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => social('apple')}
            style={[styles.provider, styles.apple, disabled && styles.disabled]}
          >
            {busy === 'apple' ? (
              <ActivityIndicator color={colors.black} />
            ) : (
              <Ionicons name="logo-apple" size={21} color={colors.black} />
            )}
            <Text style={styles.appleText}>Continue with Apple</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Continue with Google"
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => social('google')}
            style={[styles.provider, styles.google, disabled && styles.disabled]}
          >
            {busy === 'google' ? (
              <ActivityIndicator color={GOOGLE_TEXT} />
            ) : (
              <Image source={GOOGLE_G} style={styles.googleLogo} contentFit="contain" />
            )}
            <Text style={styles.googleText}>Continue with Google</Text>
          </Pressable>
        </View>

        <View style={styles.divider}>
          <View style={styles.line} />
          <Text style={styles.or}>OR</Text>
          <View style={styles.line} />
        </View>

        <View style={styles.form}>
          {expanded && isCreate ? (
            <TextInput
              autoCapitalize="words"
              editable={!disabled}
              onChangeText={setName}
              placeholder="Name (optional)"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              value={name}
            />
          ) : null}
          <TextInput
            ref={emailRef}
            autoCapitalize="none"
            autoComplete="email"
            editable={!disabled}
            keyboardType="email-address"
            onChangeText={setEmail}
            onFocus={expand}
            placeholder="Email"
            placeholderTextColor={colors.textFaint}
            returnKeyType={expanded ? 'default' : 'next'}
            style={styles.input}
            value={email}
          />
          {expanded ? (
            <>
              <TextInput
                autoCapitalize="none"
                autoComplete={isCreate ? 'new-password' : 'current-password'}
                editable={!disabled}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={colors.textFaint}
                secureTextEntry
                style={styles.input}
                value={password}
              />
              {error ? <Text style={styles.inlineError}>{error}</Text> : null}
              <Pressable
                disabled={disabled || !auth.configured}
                onPress={submitEmail}
                style={[styles.submit, (disabled || !auth.configured) && styles.disabled]}
              >
                {busy === 'email' ? (
                  <ActivityIndicator color={colors.black} />
                ) : (
                  <Text style={styles.submitText}>
                    {isCreate ? 'CREATE ACCOUNT' : 'SIGN IN'}
                  </Text>
                )}
              </Pressable>
              {!isCreate ? (
                <Pressable disabled={disabled} onPress={reset} style={styles.linkButton}>
                  <Text style={styles.linkText}>
                    {busy === 'reset' ? 'Sending…' : 'Forgot password?'}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchCopy}>
            {isCreate ? 'Already have an account?' : 'New to CardioSurf?'}
          </Text>
          <Pressable
            onPress={() =>
              router.replace(
                isCreate ? '/(onboarding)/signin' : '/(onboarding)/create-account'
              )
            }
          >
            <Text style={styles.linkText}>{isCreate ? 'Sign in' : 'Create account'}</Text>
          </Pressable>
        </View>

        <Text style={styles.legal}>
          By continuing you agree to our{' '}
          <Text style={styles.legalLink} onPress={() => openLegalUrl(TERMS_URL)}>
            Terms of Use
          </Text>{' '}
          and{' '}
          <Text style={styles.legalLink} onPress={() => openLegalUrl(PRIVACY_POLICY_URL)}>
            Privacy Policy
          </Text>
          .
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, paddingHorizontal: spacing.lg },
  back: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { alignItems: 'center', marginTop: spacing.lg },
  title: {
    color: colors.text,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: font.black,
    letterSpacing: -0.7,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 420,
  },
  stack: { gap: spacing.sm, marginTop: spacing.xl },
  provider: {
    minHeight: 54,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  apple: { backgroundColor: colors.white },
  google: { backgroundColor: colors.white, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' },
  googleLogo: { width: 20, height: 20 },
  appleText: { color: colors.black, fontSize: 16, fontWeight: font.black },
  googleText: { color: GOOGLE_TEXT, fontSize: 16, fontWeight: font.black },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.lg },
  line: { height: 1, backgroundColor: colors.border, flex: 1 },
  or: { color: colors.textFaint, fontSize: 11, fontWeight: font.bold },
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
  submitText: { color: colors.black, fontSize: 15, fontWeight: font.black },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.lg,
  },
  switchCopy: { color: colors.textDim, fontSize: 14 },
  linkButton: { alignSelf: 'center', padding: spacing.sm },
  linkText: { color: colors.lime, fontSize: 14, fontWeight: font.bold },
  inlineError: { color: colors.pink, fontSize: 13, lineHeight: 18 },
  legal: {
    color: colors.textFaint,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  legalLink: { color: colors.textDim, fontWeight: font.bold, textDecorationLine: 'underline' },
  errorBox: {
    backgroundColor: 'rgba(255,73,134,0.12)',
    borderColor: colors.pink,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  errorText: { color: colors.pink, fontSize: 13, lineHeight: 18 },
  disabled: { opacity: 0.5 },
});
