import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Kicker, OutlineButton, SegmentedControl } from '@/components/ui';
import { TIERS } from '@/constants/tiers';
import type { Tier } from '@/data/types';
import { AuthService } from '@/services/backend/AuthService';
import { useSessionStore } from '@/store/useSessionStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius, space } from '@/theme/tokens';

/**
 * Sign in / sign up. One screen, three steps:
 *
 *   email → a 6-digit code is emailed (Supabase signInWithOtp)
 *   code  → verified; a returning user is done here
 *   setup → a NEW account picks a name and a tier, and gets its challenge
 *
 * The setup step is not decoration: without a `challenges` row every RPC
 * raises "no challenge for user", so an account that skipped it cannot use
 * the app at all. A session restored mid-setup lands straight back here
 * (session status 'setup') rather than on a broken day 1.
 */

type Step = 'email' | 'code' | 'setup';

const TIER_ORDER: Tier[] = ['hard', 'medium', 'soft'];

function tierSummary(tier: Tier): string {
  const def = TIERS[tier];
  return `${def.taskKeys.length} tasks a day · ${
    def.missedDay.restartsChallenge
      ? 'a missed day restarts the challenge'
      : 'a missed day breaks the streak, not the challenge'
  }`;
}

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const status = useSessionStore((s) => s.status);
  const completeSignIn = useSessionStore((s) => s.completeSignIn);
  const finishSetup = useSessionStore((s) => s.finishSetup);

  const [step, setStep] = useState<Step>(status === 'setup' ? 'setup' : 'email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [tier, setTier] = useState<Tier>('hard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Verifying a code (or tapping the emailed link) flips the session to
  // 'setup' when the account has no challenge yet — including on a cold
  // launch that restored a half-finished sign-up.
  useEffect(() => {
    if (status === 'setup') setStep('setup');
  }, [status]);

  const sendCode = async () => {
    const address = email.trim();
    if (!address.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await AuthService.requestOtp(address);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not send that code.');
      return;
    }
    setStep('code');
    toast('Code sent — check your email');
  };

  const verify = async () => {
    const digits = code.trim();
    if (digits.length < 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await AuthService.verifyOtp(email.trim(), digits);
    if (!result.ok || !result.userId) {
      setBusy(false);
      setError(result.error ?? 'That code did not work.');
      return;
    }
    // Hydrates the mirror and opens the gate — or drops us on the setup
    // step if this email has just created its account.
    await completeSignIn(result.userId);
    setBusy(false);
  };

  const startChallenge = async () => {
    setBusy(true);
    setError(null);
    try {
      await finishSetup(name, tier);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start your challenge.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Kicker>Ranked Fitness</Kicker>
        <Text style={styles.title}>
          {step === 'setup' ? 'Set up your challenge' : 'Sign in'}
        </Text>
        <Text style={styles.lede}>
          {step === 'email'
            ? 'We email a 6-digit code. No password to forget.'
            : step === 'code'
              ? `Enter the code we sent to ${email.trim()}.`
              : 'Your name is what your squad sees. Everything else stays private.'}
        </Text>

        {step === 'email' && (
          <Card style={styles.card}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder="you@example.com"
              placeholderTextColor={colors.neutral600}
              style={styles.input}
              editable={!busy}
              onSubmitEditing={sendCode}
              returnKeyType="send"
            />
            <OutlineButton
              label={busy ? 'Sending…' : 'Send code'}
              onPress={busy ? undefined : sendCode}
              style={styles.action}
            />
          </Card>
        )}

        {step === 'code' && (
          <Card style={styles.card}>
            <Text style={styles.label}>6-digit code</Text>
            <TextInput
              value={code}
              onChangeText={(v) => setCode(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor={colors.neutral600}
              style={[styles.input, styles.codeInput]}
              editable={!busy}
              onSubmitEditing={verify}
            />
            <OutlineButton
              label={busy ? 'Verifying…' : 'Verify'}
              onPress={busy ? undefined : verify}
              style={styles.action}
            />
            <View style={styles.secondaryRow}>
              <OutlineButton
                label="Resend"
                small
                tone="neutral"
                onPress={busy ? undefined : sendCode}
              />
              <OutlineButton
                label="Change email"
                small
                tone="neutral"
                onPress={() => {
                  if (busy) return;
                  setCode('');
                  setError(null);
                  setStep('email');
                }}
              />
            </View>
          </Card>
        )}

        {step === 'setup' && (
          <Card style={styles.card}>
            <Text style={styles.label}>Display name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              placeholder="Your name"
              placeholderTextColor={colors.neutral600}
              style={styles.input}
              editable={!busy}
              maxLength={24}
            />
            <Text style={[styles.label, { marginTop: 16 }]}>Tier</Text>
            <SegmentedControl
              segments={TIER_ORDER.map((t) => TIERS[t].label)}
              value={TIERS[tier].label}
              onChange={(label) =>
                setTier(TIER_ORDER.find((t) => TIERS[t].label === label) ?? 'hard')
              }
              style={{ marginTop: 6 }}
            />
            <Text style={styles.hint}>{tierSummary(tier)}</Text>
            <Text style={styles.hint}>
              Day 1 starts today. Tasks and tier stay editable in My Challenge —
              edits always take effect tomorrow.
            </Text>
            <OutlineButton
              label={busy ? 'Starting…' : 'Start day 1'}
              onPress={busy ? undefined : startChallenge}
              style={styles.action}
            />
          </Card>
        )}

        {busy && (
          <ActivityIndicator color={colors.accent400} style={{ marginTop: 18 }} />
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.screenX,
    minHeight: '100%',
  },
  title: {
    fontFamily: font.medium,
    fontSize: 24,
    color: colors.text,
    marginTop: 10,
  },
  lede: {
    fontFamily: font.regular,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.neutral400,
    marginTop: 6,
  },
  card: {
    marginTop: 22,
  },
  label: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral500,
  },
  input: {
    fontFamily: font.regular,
    fontSize: 15,
    color: colors.text,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    marginTop: 6,
  },
  codeInput: {
    fontSize: 22,
    letterSpacing: 8,
    textAlign: 'center',
  },
  action: {
    marginTop: 16,
    alignSelf: 'stretch',
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  hint: {
    fontFamily: font.regular,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.neutral500,
    marginTop: 8,
  },
  error: {
    fontFamily: font.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.accent300,
    marginTop: 16,
  },
});
