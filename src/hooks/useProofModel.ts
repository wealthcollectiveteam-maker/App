import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { BASELINE_DAYS, buildProof, type ProofInputs, type ProofModel } from '@/lib/proof';
import { dateKeyIn } from '@/lib/sleepNight';
import { DataService, isLiveBackend } from '@/services';
import { getHealthService } from '@/services/HealthService';
import { selectHealthConnected, useAppStore } from '@/store/useAppStore';

/**
 * READS APPLE HEALTH FOR PROOF (Phase 38O). The one place the PROOF screens
 * talk to HealthKit and the challenge history; the model itself
 * (lib/proof) is pure and never sees a query.
 *
 * Runs on every focus and holds the result in COMPONENT state only. Nothing
 * here is written to the store, to disk, to a log, or over the network — the
 * history read is the user's own completion rows, and the Health arrays are
 * discarded with the screen.
 *
 * It never reads the pre-hydrate Day 1: until the live backend has answered
 * with a challenge id the status stays 'idle' and no query runs, so a
 * baseline is never computed against a day number the server has not said.
 */
export type ProofStatus = 'idle' | 'not-connected' | 'reading' | 'ready' | 'error';

const HOURS = 24;

export function useProofModel(): { status: ProofStatus; model: ProofModel | null } {
  const day = useAppStore((s) => s.day);
  const durationDays = useAppStore((s) => s.durationDays);
  const zone = useAppStore((s) => s.challengeTimezone ?? undefined);
  const challengeId = useAppStore((s) => s.challengeId);
  const checkins = useAppStore((s) => s.metricCheckins);
  const connected = useAppStore(selectHealthConnected);
  const hydrated = !isLiveBackend || challengeId != null;

  const [status, setStatus] = useState<ProofStatus>('idle');
  const [model, setModel] = useState<ProofModel | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!connected) {
        setStatus('not-connected');
        setModel(null);
        return;
      }
      if (!hydrated) {
        setStatus('idle');
        return;
      }
      let live = true;
      setStatus('reading');
      const service = getHealthService();
      const now = Date.now();
      // Baseline plus every challenge day plus today.
      const spanDays = BASELINE_DAYS + Math.max(1, day);
      Promise.all([
        service.getRecentSleepSamples(spanDays * HOURS),
        service.getRecentSamples('HKQuantityTypeIdentifierRestingHeartRate', spanDays),
        service.getRecentSamples('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', spanDays),
        service.getRecentSamples('HKQuantityTypeIdentifierRespiratoryRate', spanDays),
        service.getDailySeries('HKQuantityTypeIdentifierStepCount', spanDays),
        service.getDailySeries('HKQuantityTypeIdentifierActiveEnergyBurned', spanDays),
        service.getRecentWorkouts(spanDays),
        service.getRecentBodyMass(spanDays),
        DataService.loadChallengeHistory(),
      ])
        .then(([sleep, rhr, hrv, rr, steps, energy, workouts, weights, history]) => {
          if (!live) return;
          const input: ProofInputs = {
            todayKey: dateKeyIn(now, zone),
            currentDay: day,
            durationDays,
            zone,
            sleep,
            rhr: rhr ? rhr.map((s) => ({ value: s.value, endMs: s.endMs })) : null,
            hrv: hrv ? hrv.map((s) => ({ value: s.value, endMs: s.endMs })) : null,
            rr: rr ? rr.map((s) => ({ value: s.value, endMs: s.endMs })) : null,
            stepsByDate: steps,
            energyByDate: energy,
            workouts,
            weights: weights ? weights.map((w) => ({ kg: w.kg, atMs: Date.parse(w.dateISO) })) : null,
            checkins: checkins
              .filter((c) => c.weightKg != null)
              .map((c) => ({ kg: c.weightKg as number, atMs: c.timestamp })),
            completions: history.completions.map((c) => ({
              day: c.day,
              taskKey: c.taskKey,
              completedAtMs: Date.parse(c.completedAt),
              durationSeconds: c.durationSeconds,
            })),
            snapshots: history.days.map((d) => ({
              day: d.day,
              tasks: d.tasks.map((t) => ({ key: t.key, target: t.target ?? null })),
            })),
          };
          setModel(buildProof(input));
          setStatus('ready');
        })
        .catch(() => {
          if (!live) return;
          setModel(null);
          setStatus('error');
        });
      return () => {
        live = false;
      };
    }, [connected, hydrated, day, durationDays, zone, checkins]),
  );

  return { status, model };
}
