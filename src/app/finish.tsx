import { useRouter } from 'expo-router';
import {
  BarbellIcon as Barbell,
  BookOpenIcon as BookOpen,
  CameraIcon as Camera,
  DropIcon as Drop,
  ForkKnifeIcon as ForkKnife,
  MedalIcon as Medal,
} from 'phosphor-react-native';
import React, { useState } from 'react';
import {
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
import { DataService } from '@/services';
import { useAppStore } from '@/store/useAppStore';
import { toast } from '@/store/useToastStore';
import { colors, font, radius, space } from '@/theme/tokens';

const FEELINGS = ['Strong', 'Proud', 'Unstoppable', 'Relieved'];

const BENEFITS = [
  {
    Icon: ForkKnife,
    lead: 'Clean eating.',
    body: 'Steadier energy, better sleep, no crash.',
  },
  {
    Icon: Barbell,
    lead: 'Two-a-days.',
    body: '150 workouts. Your floor is higher now.',
  },
  {
    Icon: Drop,
    lead: 'Hydration.',
    body: '75 gallons. The headaches are gone.',
  },
  {
    Icon: BookOpen,
    lead: 'Ten pages a day.',
    body: '750 pages. A reading habit that stuck.',
  },
  {
    Icon: Medal,
    lead: 'Discipline.',
    body: 'You kept a promise to yourself 75 days in a row. That\u2019s the real result.',
  },
];

function StepOne({ onNext }: { onNext: () => void }) {
  const feeling = useAppStore((s) => s.finishFeeling);
  const feelingText = useAppStore((s) => s.finishFeelingText);
  const setFeeling = useAppStore((s) => s.setFinishFeeling);
  const setFeelingText = useAppStore((s) => s.setFinishFeelingText);

  return (
    <CelebrationGround>
      <ScrollView contentContainerStyle={styles.stepOne}>
        <Kicker color={colors.accent200} style={{ letterSpacing: 3 }}>
          Day 75 of 75
        </Kicker>
        <Text style={styles.didIt}>You did it.</Text>
        <Text style={styles.didItSub}>
          75 days. Never missed. Great job.
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

function PhotoSlot({ label }: { label: string }) {
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Kicker color={colors.neutral500}>{label}</Kicker>
      <View style={styles.photoSlot}>
        <Camera size={24} color={colors.neutral600} />
        <Text style={styles.photoHint}>progress photo</Text>
      </View>
    </View>
  );
}

function StepTwo() {
  const router = useRouter();
  const feeling = useAppStore((s) => s.finishFeeling);
  const results = DataService.getFinalResults();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.stepTwo}
    >
      <Kicker>75 Hard — The results</Kicker>
      <Text style={styles.headline}>75 days, one different person.</Text>
      {feeling && (
        <Text style={styles.feelingEcho}>Feeling: {feeling}</Text>
      )}

      <AccentDivider style={{ marginVertical: 22 }} />

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <PhotoSlot label="Day 1" />
        <PhotoSlot label="Day 75" />
      </View>

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
        <Kicker style={{ marginBottom: 14 }}>What 75 days changed</Kicker>
        {BENEFITS.map(({ Icon, lead, body }) => (
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
        onPress={() => toast('Results copied to share')}
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
  photoSlot: {
    height: 210,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoHint: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
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
