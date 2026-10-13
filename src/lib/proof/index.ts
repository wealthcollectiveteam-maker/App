/**
 * PROOF — the challenge as an experiment on one person (Phase 38O).
 *
 * Pure. Fed by arrays of daily values; never calls HealthKit itself, so
 * everything is proved with fixtures in scripts/proof.test.mjs. The screen
 * (src/app/proof.tsx) reads Apple Health, hands the arrays here, and draws
 * the answer. Nothing computed here is stored anywhere.
 */
import { allBeforeNow, observations, recoveryHasBaseline, rollingLoad, type BeforeNow, type LoadPoint, type Observation } from './metrics.ts';
import { patterns, type Pattern } from './patterns.ts';
import { report, type Report } from './reports.ts';
import { buildDailySeries, type DailyRow, type ProofInputs } from './series.ts';

export * from './copy.ts';
export * from './dates.ts';
export * from './metrics.ts';
export * from './patterns.ts';
export * from './reports.ts';
export * from './series.ts';
export * from './stats.ts';


export interface ProofModel {
  rows: DailyRow[];
  beforeNow: BeforeNow[];
  load: LoadPoint[];
  observations: Observation[];
  recoveryHasBaseline: boolean;
  patterns: Pattern[];
  halfway: Report;
  final: Report;
}

/** Everything the screens show, from the inputs, in one call. */
export function buildProof(input: ProofInputs): ProofModel {
  const rows = buildDailySeries(input);
  return {
    rows,
    beforeNow: allBeforeNow(rows),
    load: rollingLoad(rows),
    observations: observations(rows),
    recoveryHasBaseline: recoveryHasBaseline(rows),
    patterns: patterns(rows),
    halfway: report('halfway', rows, input.currentDay, input.durationDays),
    final: report('final', rows, input.currentDay, input.durationDays),
  };
}
