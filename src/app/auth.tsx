import React, { useEffect, useState } from 'react';
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

import { Micro, PrimaryButton, Serif } from '@/components/primitives';
import { Card, OutlineButton } from '@/components/ui';
import {
  CHALLENGE,
  CHALLENGE_LENGTHS,
  MAX_CUSTOM_TASKS,
} from '@/constants/challenge';
import { buildTierTask, missedDayLine, TIERS } from '@/constants/tiers';
import type { ChallengeLength, SetupCustomTask, Tier } from '@/data/types';
import { AuthService } from '@/services/backend/AuthService';
import { useSessionStore } from '@/store/useSessionStore';
import { toast } from '@/store/useToastStore';
import { colors, font, microTracking, radius, space } from '@/theme/tokens';

/**
 * Sign in / sign up. One screen, three steps:
 *
 *   email → a 6-digit code is emailed (Supabase signInWithOtp)
 *   code  → verified; a returning user is done here
 *   setup → a NEW account gives a name, picks a tier, writes its why —
 *           and only then gets a challenge
 *
 * Setup is not decoration. Without a `challenges` row every RPC raises
 * "no challenge for user", so an account that skipped it cannot use the app;
 * and the tier it would have defaulted to decides the task set and the
 * missed-day penalty from day 1, which no later edit can undo. A session
 * restored mid-setup lands straight back here (session status 'setup')
 * rather than on a broken day 1 — the server is asked every time, so this
 * screen is reached by the typed code and the emailed link alike.
 */

type Step = 'email' | 'code' | 'setup';

const TIER_ORDER: Tier[] = ['hard', 'medium', 'soft'];

/**
 * A tier card. The consequence line is DERIVED from that tier's missed-day
 * rules — "miss a task, restart at day one" is true of hard alone, so as a
 * blanket promise under the heading it was false for two thirds of users.
 */
function TierCard({
  tier,
  selected,
  onPress,
}: {
  tier: Tier;
  selected: boolean;
  onPress: () => void;
}) {
  const def = TIERS[tier];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${def.label} tier`}
      style={[styles.tierCard, selected && styles.tierCardSelected]}
    >
      {selected && (
        <View style={styles.selectedTab}>
          <View style={styles.selectedTabInner}>
            <Text style={styles.selectedTabText}>SELECTED</Text>
          </View>
        </View>
      )}
      <View style={styles.tierHeading}>
        <Text
          style={[
            styles.tierName,
            { color: selected ? colors.textHi : colors.textMid },
          ]}
        >
          {def.label.toUpperCase()}
        </Text>
        <Micro color={selected ? colors.accent400 : colors.textLow}>
          {def.tagline}
        </Micro>
      </View>
      <Text style={styles.tierPromise}>{def.promise}</Text>

      {/* The real task list, with the descriptor that makes it that tier.
          A count told you how much; this tells you what — and what a tier
          demands of you is the whole basis for choosing one. */}
      <View style={styles.tierTasks}>
        {def.tasks.map((t) => (
          <View key={t.key} style={styles.tierTaskRow}>
            <View
              style={[
                styles.tierTaskDot,
                { backgroundColor: selected ? colors.accent : colors.textLow },
              ]}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.tierTaskLabel}>
                {buildTierTask(tier, t.key).label}
              </Text>
              <Serif size={13} style={{ color: colors.textLow }}>
                {t.sub}
              </Serif>
            </View>
          </View>
        ))}
      </View>
      <Serif
        size={15}
        style={{
          marginTop: 10,
          color: selected ? colors.accent400 : colors.textLow,
        }}
      >
        {missedDayLine(tier)}
      </Serif>
    </Pressable>
  );
}

/**
 * How long the challenge runs. Three options, one line each, and 75
 * pre-selected — unlike the tier, which is deliberately unselected because a
 * defaulted tier picks a task set and a penalty nobody agreed to. A length
 * has no such consequence: 75 is what this app has always been, and the other
 * two are a shorter version of the same thing.
 */
function LengthCard({
  option,
  selected,
  onPress,
}: {
  option: (typeof CHALLENGE_LENGTHS)[number];
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${option.label} challenge`}
      style={[styles.lengthCard, selected && styles.lengthCardSelected]}
    >
      <Text style={[styles.lengthDays, selected && { color: colors.accent200 }]}>
        {option.days}
      </Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.lengthLabel, selected && { color: colors.text }]}>
          {option.label}
        </Text>
        <Text style={styles.lengthDescriptor}>{option.descriptor}</Text>
      </View>
    </Pressable>
  );
}

/**
 * Custom tasks, added before day 1 is frozen.
 *
 * This is the ONE moment a custom task can join day 1: everywhere else in the
 * app an edit takes effect tomorrow, because today's task set is a snapshot
 * taken at day start. Setup runs before that snapshot exists, which is why
 * the server gives it a separate entry point with its own precondition
 * (add_setup_custom_task refuses once challenge_days holds a day 1).
 *
 * A task added here counts exactly like a tier task — there is one class of
 * task and one definition of a completed day. That is the reason the copy
 * says "counts like any other" rather than offering it as a bonus.
 */
function CustomTaskStep({
  tasks,
  onChange,
  disabled,
}: {
  tasks: SetupCustomTask[];
  onChange: (next: SetupCustomTask[]) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [minutes, setMinutes] = useState('');
  const full = tasks.length >= MAX_CUSTOM_TASKS;

  const add = () => {
    const name = draft.trim();
    if (!name || full) return;
    const parsed = parseInt(minutes, 10);
    onChange([
      ...tasks,
      {
        name,
        timerMinutes:
          Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 600) : undefined,
      },
    ]);
    setDraft('');
    setMinutes('');
  };

  return (
    <View style={{ marginTop: 26 }}>
      <Micro color={colors.textMid}>Your own tasks — optional</Micro>
      <Text style={styles.customIntro}>
        Anything you add counts like any other task. Miss one and the day is a
        miss.
      </Text>

      {tasks.map((t, i) => (
        <View key={`${t.name}-${i}`} style={styles.customRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.customName}>{t.name}</Text>
            {t.timerMinutes ? (
              <Text style={styles.customMeta}>{t.timerMinutes} min timer</Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => onChange(tasks.filter((_, n) => n !== i))}
            hitSlop={10}
            accessibilityLabel={`Remove ${t.name}`}
            disabled={disabled}
          >
            <Text style={styles.customRemove}>REMOVE</Text>
          </Pressable>
        </View>
      ))}

      {full ? (
        <Text style={styles.hint}>
          That is the limit — {MAX_CUSTOM_TASKS} custom tasks.
        </Text>
      ) : (
        <View style={styles.customForm}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Cold plunge"
            placeholderTextColor={colors.textLow}
            style={[styles.whyInput, { flex: 1 }]}
            editable={!disabled}
            maxLength={40}
            onSubmitEditing={add}
          />
          <TextInput
            value={minutes}
            onChangeText={setMinutes}
            placeholder="min"
            placeholderTextColor={colors.textLow}
            style={[styles.whyInput, styles.customMinutes]}
            editable={!disabled}
            keyboardType="number-pad"
            maxLength={3}
            onSubmitEditing={add}
          />
          <OutlineButton label="Add" small onPress={add} />
        </View>
      )}
    </View>
  );
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
  // Deliberately null, not 'hard'. A defaulted tier is a challenge nobody
  // chose: it fixes the task set and the missed-day penalty, and edits only
  // ever take effect tomorrow, so a wrong day 1 cannot be taken back.
  const [tier, setTier] = useState<Tier | null>(null);
  // 75 IS pre-selected, unlike the tier — see LengthCard for why the two are
  // treated differently.
  const [length, setLength] = useState<ChallengeLength>(CHALLENGE.defaultDays);
  const [customs, setCustoms] = useState<SetupCustomTask[]>([]);
  const [why, setWhy] = useState('');
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
    if (!name.trim()) {
      setError('Enter a display name — it is what your squad sees.');
      return;
    }
    if (!tier) {
      setError('Pick a tier. It sets your daily tasks and what a missed day costs.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await finishSetup(name, tier, why, length, customs);
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
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Giant ghost numeral, bleeding off the top-right corner. It is
            decoration: it never takes a touch, and it never scales with the
            system font (it would swallow the screen). */}
        <View style={styles.ghostWrap} pointerEvents="none">
          <Text style={styles.ghost75} allowFontScaling={false}>
            {step === 'setup' ? length : CHALLENGE.defaultDays}
          </Text>
        </View>

        <Text style={styles.wordmark}>RANKED</Text>
        {step !== 'setup' && (
          <>
            <Text style={styles.title}>Sign in</Text>
            <Serif style={{ marginTop: 10 }}>
              {step === 'email'
                ? 'We email a 6-digit code. No password to forget.'
                : `Enter the code we sent to ${email.trim()}.`}
            </Serif>
          </>
        )}

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
            <PrimaryButton
              label={busy ? 'Sending…' : 'Send code →'}
              disabled={busy}
              onPress={sendCode}
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
            <PrimaryButton
              label={busy ? 'Verifying…' : 'Verify →'}
              disabled={busy}
              onPress={verify}
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
          <View style={styles.setup}>
            <Text style={styles.label}>Display name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              placeholder="Your name"
              placeholderTextColor={colors.textLow}
              style={styles.input}
              editable={!busy}
              maxLength={24}
            />

            <Micro color={colors.accent400} style={{ marginTop: 30 }}>
              {length} days. No shortcuts. No mercy.
            </Micro>
            <Text style={styles.pickTitle}>How long?</Text>

            <View style={{ gap: 8, marginTop: 16 }}>
              {CHALLENGE_LENGTHS.map((option) => (
                <LengthCard
                  key={option.days}
                  option={option}
                  selected={length === option.days}
                  onPress={() => setLength(option.days)}
                />
              ))}
            </View>

            {/* Length and tier are independent: a 30-day HARD is a real
                choice, and picking a shorter run does not soften the rules.
                Nothing below reads `length`. */}
            <Text style={styles.pickTitle}>Pick your tier.</Text>

            <View style={{ gap: 10, marginTop: 20 }}>
              {TIER_ORDER.map((t) => (
                <TierCard
                  key={t}
                  tier={t}
                  selected={tier === t}
                  onPress={() => setTier(t)}
                />
              ))}
            </View>

            <CustomTaskStep
              tasks={customs}
              onChange={setCustoms}
              disabled={busy}
            />

            <View style={styles.whyField}>
              <Micro color={colors.textMid}>Why?</Micro>
              <TextInput
                value={why}
                onChangeText={setWhy}
                placeholder="Only you ever see this."
                placeholderTextColor={colors.textLow}
                style={styles.whyInput}
                editable={!busy}
                maxLength={280}
              />
            </View>

            {/* True to the snapshot model, and a stronger promise than
                "locked once you start" — which the app never was. */}
            <Text style={styles.hint}>Changes start tomorrow. Never today.</Text>

            <PrimaryButton
              // Enabled without a tier on purpose: pressing it says WHICH
              // answer is missing, which a dead button never does.
              label={busy ? 'Starting…' : 'Start day 01 →'}
              disabled={busy}
              onPress={startChallenge}
              style={{ marginTop: 18 }}
            />
            <Micro
              size={10}
              color={colors.textLow}
              style={{ marginTop: 16, textAlign: 'center' }}
            >
              Step 2 of 3 — squad next
            </Micro>
          </View>
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
  ghostWrap: {
    position: 'absolute',
    top: -70,
    right: -46,
  },
  ghost75: {
    fontFamily: font.black,
    fontSize: 300,
    lineHeight: 300,
    letterSpacing: -18,
    color: colors.surfaceAlt,
  },
  wordmark: {
    fontFamily: font.blackItalic,
    fontSize: 21,
    letterSpacing: 0.4,
    color: colors.textHi,
  },
  title: {
    fontFamily: font.bold,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -1.6,
    color: colors.textHi,
    marginTop: 34,
  },
  pickTitle: {
    fontFamily: font.bold,
    fontSize: 48,
    lineHeight: 50,
    letterSpacing: -2.4,
    color: colors.textHi,
    marginTop: 10,
  },
  setup: {
    marginTop: 34,
  },
  card: {
    marginTop: 26,
  },
  label: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: microTracking(10),
    textTransform: 'uppercase',
    color: colors.textMid,
  },
  input: {
    fontFamily: font.medium,
    fontSize: 16,
    color: colors.textHi,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    marginTop: 8,
  },
  codeInput: {
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
  },
  lengthCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  lengthCardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  lengthDays: {
    fontFamily: font.black,
    fontSize: 30,
    color: colors.textLow,
    minWidth: 52,
    fontVariant: ['tabular-nums'],
  },
  lengthLabel: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: colors.textMid,
  },
  lengthDescriptor: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.textLow,
    marginTop: 3,
  },
  customIntro: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: colors.textLow,
    lineHeight: 17,
    marginTop: 6,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: 12,
  },
  customName: {
    fontFamily: font.medium,
    fontSize: 14.5,
    color: colors.textHi,
  },
  customMeta: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.textLow,
    marginTop: 2,
  },
  customRemove: {
    fontFamily: font.medium,
    fontSize: 10,
    letterSpacing: microTracking(10),
    color: colors.textLow,
  },
  customForm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  customMinutes: {
    flex: 0,
    width: 62,
    fontFamily: font.regular,
    fontSize: 14,
    textAlign: 'center',
  },
  tierCard: {
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    paddingTop: 22,
  },
  tierCardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  selectedTab: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: colors.accent,
    transform: [{ skewX: '-12deg' }],
    paddingHorizontal: 16,
    paddingVertical: 4,
    // The slant would otherwise poke past the card's own right edge.
    marginRight: -2,
  },
  selectedTabInner: {
    transform: [{ skewX: '12deg' }],
  },
  selectedTabText: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: microTracking(10),
    textTransform: 'uppercase',
    color: colors.bg,
  },
  tierHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 10,
  },
  tierName: {
    fontFamily: font.blackItalic,
    fontSize: 26,
    letterSpacing: -0.6,
  },
  tierPromise: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMid,
    marginTop: 10,
  },
  tierTasks: {
    marginTop: 14,
    gap: 6,
  },
  tierTaskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  tierTaskDot: {
    width: 5,
    height: 5,
    marginTop: 7,
    transform: [{ rotate: '45deg' }],
  },
  tierTaskLabel: {
    fontFamily: font.medium,
    fontSize: 14,
    color: colors.textHi,
  },
  whyField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginTop: 20,
  },
  whyInput: {
    flex: 1,
    fontFamily: font.serifItalic,
    fontSize: 17,
    color: colors.textHi,
    minHeight: 44,
  },
  action: {
    marginTop: 18,
    alignSelf: 'stretch',
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  hint: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMid,
    marginTop: 18,
  },
  error: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.accent400,
    marginTop: 16,
  },
});
