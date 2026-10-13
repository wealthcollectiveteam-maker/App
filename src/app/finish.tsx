import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import {
  BarbellIcon as Barbell,
  BookOpenIcon as BookOpen,
  DropIcon as Drop,
  ForkKnifeIcon as ForkKnife,
  MedalIcon as Medal,
} from 'phosphor-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CelebrationGround } from '@/components/CelebrationGround';
import {
  AccentDivider,
  Card,
  Kicker,
  OutlineButton,
} from '@/components/ui';
import { targetText } from '@/constants/tiers';
import type { FinalResults } from '@/data/types';
import { DataService } from '@/services';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius, space } from '@/theme/tokens';

const FEELINGS = ['Strong', 'Proud', 'Unstoppable', 'Relieved'];

/**
 * What the challenge changed — with the FIGURES taken from the same tally as
 * the stat grid above them.
 *
 * They were literal strings: "150 workouts", "75 gallons", "750 pages". Those
 * are Hard's numbers for a flawless run, and every user read them whatever
 * tier they ran and whatever they had actually done. A line is dropped
 * entirely when its figure is zero rather than congratulating someone on
 * nothing.
 */
function benefits(results: FinalResults) {
  return [
    {
      Icon: ForkKnife,
      lead: 'Clean eating.',
      body: 'Steadier energy, better sleep, no crash.',
    },
    results.workouts > 0 && {
      Icon: Barbell,
      lead: 'Training.',
      body: `${results.workouts} sessions. Your floor is higher now.`,
    },
    results.water.value > 0 && {
      Icon: Drop,
      lead: 'Hydration.',
      body: `${targetText(results.water)}. The headaches are gone.`,
    },
    results.pagesRead > 0 && {
      Icon: BookOpen,
      lead: 'Reading.',
      body: `${results.pagesRead} pages. A habit that stuck.`,
    },
    {
      Icon: Medal,
      lead: 'Discipline.',
      body: 'You kept a promise to yourself, every day. That’s the real result.',
    },
  ].filter((b) => typeof b === 'object');
}


function StepOne({ onNext }: { onNext: () => void }) {
  const durationDays = useAppStore((s) => s.durationDays);
  const feeling = useAppStore((s) => s.finishFeeling);
  const feelingText = useAppStore((s) => s.finishFeelingText);
  const setFeeling = useAppStore((s) => s.setFinishFeeling);
  const setFeelingText = useAppStore((s) => s.setFinishFeelingText);

  return (
    <CelebrationGround>
      <ScrollView contentContainerStyle={styles.stepOne}>
        <Kicker color={colors.accent200} style={{ letterSpacing: 3 }}>
          Day {durationDays} of {durationDays}
        </Kicker>
        <Text style={styles.didIt}>You did it.</Text>
        <Text style={styles.didItSub}>
          {durationDays} days. Never missed. Great job.
        </Text>

        <Kicker color={colors.accent300} style={{ marginTop: 38 }}>
          How do you feel?
        </Kicker>
        <View style={styles.pillWrap}>
          {FEELINGS.map((f) => {
            const active = feeling === f;
            return (
              <Pressable
                key={f}
                onPress={() => setFeeling(active ? null : f)}
                style={[
                  styles.pill,
                  active && {
                    borderColor: colors.accent300,
                    backgroundColor: colors.accentTint,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.pillText,
                    active && { color: colors.accent100 },
                  ]}
                >
                  {f}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          value={feelingText}
          onChangeText={setFeelingText}
          placeholder="…or say it in your own words"
          placeholderTextColor={colors.accent400}
          style={styles.feelingInput}
        />
        <OutlineButton
          label="See your results"
          onPress={onNext}
          style={{ marginTop: 34, minWidth: 220 }}
        />
      </ScrollView>
    </CelebrationGround>
  );
}

const NEWLINE = String.fromCharCode(10);

/**
 * Copy the results, and say so ONLY if the copy happened.
 *
 * This button used to be `onPress={() => toast('Results copied to share')}` —
 * the toast and nothing else, on every platform. It reported a success that
 * had not occurred, which is the worst kind of dead control: the user has no
 * reason to check, and finds out when they paste.
 *
 * The text is built from the same numbers on screen, so what is copied is
 * what was read. Failure is reported as failure.
 */
async function shareResults(
  results: FinalResults,
  durationDays: number,
  feeling: string | null,
): Promise<void> {
  const lines = [
    `${durationDays} days. Done.`,
    '',
    `${results.workouts} workout${results.workouts === 1 ? '' : 's'}`,
    `${results.pagesRead} page${results.pagesRead === 1 ? '' : 's'} read`,
    // targetText is what the rest of the app uses, so the copied line reads
    // the same as the screen — and "1 gallons" cannot happen.
    `${targetText(results.water)} of water`,
  ];
  if (feeling) lines.push('', `Feeling: ${feeling}`);
  try {
    await Clipboard.setStringAsync(lines.join(NEWLINE));
    toast('Results copied');
  } catch {
    toast('Could not copy — select the text above instead');
  }
}

function StepTwo() {
  const durationDays = useAppStore((s) => s.durationDays);
  const router = useRouter();
  const feeling = useAppStore((s) => s.finishFeeling);
  // The one read in the app that spans the whole challenge: 75 days of
  // snapshots and completions, counted server-side. It cannot come from the
  // mirror, so the screen waits for it rather than rendering placeholder
  // numbers that would be indistinguishable from real ones.
  const [results, setResults] = useState<FinalResults | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    DataService.loadFinalResults()
      .then((r) => {
        if (live) setResults(r);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!results) {
    return (
      <View style={[styles.stepTwo, styles.resultsPending]}>
        {failed ? (
          <Text style={styles.resultsFailed}>
            Your totals didn{'’'}t load. Everything you did is safe —
            check your connection and open this screen again.
          </Text>
        ) : (
          <ActivityIndicator color={colors.accent400} />
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.stepTwo}
    >
      {/* The tier is named "75 Hard" after the original challenge; the
          RUN is however many days this person signed up for. Only the
          second of these is a number about them. */}
      <Kicker>The results</Kicker>
      <Text style={styles.headline}>
        {durationDays} days, one different person.
      </Text>
      {feeling && (
        <Text style={styles.feelingEcho}>Feeling: {feeling}</Text>
      )}

      <AccentDivider style={{ marginVertical: 22 }} />

      <View style={styles.statGrid}>
        {[
          { value: results.workouts, label: 'Workouts' },
          { value: results.pagesRead, label: 'Pages read' },
          {
            value: results.water.value,
            label: results.water.unit === 'gallons' ? 'Gallons' : 'Litres',
          },
        ].map((s) => (
          <Card key={s.label} style={styles.statCell}>
            <Text style={styles.statValue}>{s.value}</Text>
            <Kicker color={colors.neutral500} style={{ marginTop: 4 }}>
              {s.label}
            </Kicker>
          </Card>
        ))}
      </View>

      <Card style={{ marginTop: 12 }}>
        <Kicker style={{ marginBottom: 14 }}>
          What {durationDays} days changed
        </Kicker>
        {benefits(results).map(({ Icon, lead, body }) => (
          <View key={lead} style={styles.benefitRow}>
            <Icon size={17} color={colors.accent400} />
            <Text style={styles.benefitText}>
              <Text style={{ fontFamily: font.semibold, color: colors.text }}>
                {lead}{' '}
              </Text>
              {body}
            </Text>
          </View>
        ))}
      </Card>

      <OutlineButton
        label="Share your results"
        onPress={() => shareResults(results, durationDays, feeling)}
        style={{ marginTop: 20 }}
      />
      <OutlineButton
        label="Back to home"
        tone="ghost"
        onPress={() => router.back()}
        style={{ marginTop: 8 }}
      />
    </ScrollView>
  );
}

export default function FinishFlow() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<1 | 2>(1);
  const saveCompletionFeeling = useAppStore((s) => s.saveCompletionFeeling);

  return (
    <View style={{ flex: 1, paddingTop: step === 2 ? insets.top : 0 }}>
      {step === 1 ? (
        <StepOne
          onNext={() => {
            saveCompletionFeeling();
            setStep(2);
          }}
        />
      ) : (
        <StepTwo />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  resultsPending: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultsFailed: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.neutral500,
    textAlign: 'center',
  },
  stepOne: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 60,
  },
  didIt: {
    fontFamily: font.medium,
    fontSize: 44,
    color: colors.text,
    marginTop: 16,
    ...(Platform.OS === 'web'
      ? ({ textShadow: `0 0 38px ${colors.accent500}` } as any)
      : null),
  },
  didItSub: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.accent200,
    marginTop: 10,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.accent700,
    borderRadius: radius.pill,
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  pillText: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.accent300,
  },
  feelingInput: {
    alignSelf: 'stretch',
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.text,
    minHeight: 42,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.accent800,
    borderRadius: radius.sm,
    backgroundColor: colors.groundScrim,
    marginTop: 12,
  },
  stepTwo: {
    paddingHorizontal: space.screenX,
    paddingTop: 24,
    paddingBottom: 40,
  },
  headline: {
    fontFamily: font.medium,
    fontSize: 28,
    color: colors.text,
    marginTop: 8,
    lineHeight: 34,
  },
  feelingEcho: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.accent300,
    marginTop: 8,
  },
  statGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
  },
  statValue: {
    fontFamily: font.medium,
    fontSize: 22,
    color: colors.text,
  },
  benefitRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  benefitText: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.neutral400,
    lineHeight: 18.5,
  },
});
