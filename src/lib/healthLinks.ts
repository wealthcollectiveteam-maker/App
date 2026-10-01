/**
 * LINK A TASK TO APPLE HEALTH (Phase 38N, N3).
 *
 * Pure. No react-native imports; proved in scripts/health-links.test.mjs.
 * The store's selector and the edit sheet are thin over this.
 *
 * WHAT A LINK IS. Configuration, not health data: "this task is met when
 * Apple Health shows at least 6 h asleep last night". It is chosen by the
 * user on the task's edit surface — offered as a default when the task's
 * wording plainly matches, but never applied without a tap — and kept on
 * the device (lib/prefsStorage.ts, PREF_KEYS.healthLinks). A link carries
 * nothing that came out of HealthKit.
 *
 * WHAT A SUGGESTION IS. When a link's rule is met for the OPEN day, the task
 * gets an inline line naming what Apple Health saw and where it came from,
 * with a Mark complete button. The tap goes through completeTask — the same
 * XP, feed, streak and haptic as a swipe. Nothing here completes anything.
 *
 * WHAT IS NEVER SAID. When a rule is not met the answer is null: no
 * suggestion, no line, no "you only slept 5 h". Health here vouches; it does
 * not grade, anywhere.
 *
 * SEALED DAYS. `dayOpen` false returns nothing at all, so a suggestion
 * cannot exist for a day that has closed, let alone complete one.
 */
import { formatInteger, wallClockIn } from './intl.ts';
import { formatHoursMinutes, wakeMinuteOfDay, type SleepNight } from './sleepNight.ts';

export type HealthRuleKind = 'sleep' | 'wake' | 'water' | 'steps' | 'workout' | 'mindful';

export interface HealthLink {
  kind: HealthRuleKind;
  /** sleep: hours asleep last night, at least / at most. */
  minHours?: number;
  maxHours?: number;
  /** wake: minutes after midnight in the challenge zone ("06:00" = 360). */
  byMinute?: number;
  /** water: litres today. A gallon is 3.785 L. */
  minLitres?: number;
  /** steps: today. */
  minSteps?: number;
  /** workout, mindful: minutes. */
  minMinutes?: number;
}

export const LITRES_PER_GALLON = 3.785;

/** Order the edit sheet lists them in, with a label for each. */
export const HEALTH_RULE_KINDS: { kind: HealthRuleKind; label: string }[] = [
  { kind: 'sleep', label: 'Asleep last night, at least…' },
  { kind: 'wake', label: 'Woke up by…' },
  { kind: 'water', label: 'Water today, at least…' },
  { kind: 'steps', label: 'Steps today, at least…' },
  { kind: 'workout', label: 'A workout today of at least…' },
  { kind: 'mindful', label: 'Mindful minutes today, at least…' },
];

// ---------------------------------------------------------------------------
// Defaults from the task's wording. Offered, never applied.
// ---------------------------------------------------------------------------

function firstNumber(text: string): number | null {
  const m = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (m) return Number(m[1]) * 1000;
  const n = text.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return n ? Number(n[0]) : null;
}

/** "6-8", "6 to 8", "6–8" → [6, 8]; "8 hours" → [8, null]. */
function hoursRange(text: string): [number, number | null] | null {
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)?/i);
  if (range) return [Number(range[1]), Number(range[2])];
  const single = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i);
  if (single) return [Number(single[1]), null];
  return null;
}

/** "6am", "6:30 am", "0630", "06:30" → minutes after midnight, or null. */
export function parseClock(text: string): number | null {
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase().replace(/\./g, '');
  if (h > 23 || min > 59) return null;
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

export interface TaskLike {
  key: string;
  label: string;
  target?: { value: number; unit: string } | null;
}

/**
 * The link the wording plainly suggests, or null. The user confirms it on
 * the edit sheet; nothing is linked silently.
 */
export function suggestLinkForText(task: TaskLike): HealthLink | null {
  const text = task.label;
  const t = text.toLowerCase();

  if (/\b(wake|woke|up at|up by|rise|out of bed)\b/.test(t)) {
    const at = text.match(/(?:by|at)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    const byMinute = (at ? parseClock(at[1]) : null) ?? 6 * 60;
    return { kind: 'wake', byMinute };
  }
  if (/\bsleep|asleep|bed\b/.test(t)) {
    const hr = hoursRange(text);
    return {
      kind: 'sleep',
      minHours: hr?.[0] ?? 7,
      ...(hr?.[1] != null ? { maxHours: hr[1] } : {}),
    };
  }
  if (/\b(water|gallon|litre|liter|hydrat)/.test(t)) {
    let litres = LITRES_PER_GALLON;
    if (task.target?.unit === 'gallons') litres = task.target.value * LITRES_PER_GALLON;
    else if (task.target?.unit === 'litres') litres = task.target.value;
    else if (/gallon/.test(t)) litres = (firstNumber(text) ?? 1) * LITRES_PER_GALLON;
    else if (/litre|liter/.test(t)) litres = firstNumber(text) ?? 3;
    return { kind: 'water', minLitres: Math.round(litres * 1000) / 1000 };
  }
  if (/\bsteps?\b/.test(t)) {
    return { kind: 'steps', minSteps: firstNumber(text) ?? 10_000 };
  }
  if (/\b(meditat|mindful|breath)/.test(t)) {
    const mins = task.target?.unit === 'minutes' ? task.target.value : (firstNumber(text) ?? 10);
    return { kind: 'mindful', minMinutes: mins };
  }
  if (/\b(workout|train|gym|lift|run|cardio|exercise)/.test(t) || /^workout/.test(task.key)) {
    const mins = task.target?.unit === 'minutes' ? task.target.value : (firstNumber(text) ?? 45);
    return { kind: 'workout', minMinutes: mins };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Evaluation.
// ---------------------------------------------------------------------------

export interface WorkoutFact {
  type: string;
  minutes: number;
  startISO: string;
  source: string;
}

export interface SummedFact {
  /** The total, in the unit named on QUANTITY_UNITS (mL for water). */
  value: number;
  sources: string[];
}

/** Everything a rule can look at. Null = not read; iOS does not say why. */
export interface HealthFacts {
  /** The main sleep that ended on the open day's date, challenge zone. */
  night: SleepNight | null;
  water: SummedFact | null;
  steps: SummedFact | null;
  mindful: SummedFact | null;
  /** null = the query did not run; [] = it ran and found none. */
  workouts: WorkoutFact[] | null;
}

export interface HealthSuggestion {
  /** The whole line, source included. The button says "Mark complete". */
  text: string;
  /** Set for workout rules: the recording this suggestion spends. */
  workoutStartISO?: string;
}

function sourcesText(sources: string[]): string {
  return sources.length ? ` (${sources.join(', ')})` : '';
}

export function formatClockIn(ms: number, zone: string | undefined): string {
  const w = wallClockIn(ms, zone);
  const h12 = w.hour % 12 || 12;
  return `${h12}:${String(w.minute).padStart(2, '0')} ${w.hour < 12 ? 'AM' : 'PM'}`;
}

export function formatWater(ml: number, unit: 'metric' | 'imperial'): string {
  if (unit === 'imperial') {
    return `${(ml / (LITRES_PER_GALLON * 1000)).toFixed(2)} gal`;
  }
  return `${(ml / 1000).toFixed(1)} L`;
}

export function formatWaterTarget(litres: number, unit: 'metric' | 'imperial'): string {
  return formatWater(litres * 1000, unit);
}

export interface EvalContext {
  zone: string | undefined;
  unitPreference: 'metric' | 'imperial';
  /** Workout start times already spent on another task. */
  consumedWorkouts: string[];
}

/**
 * The suggestion a link produces from the facts, or null when the rule is
 * not met or the fact was not read. Never a partial answer, never a grade.
 */
export function evaluateLink(
  link: HealthLink,
  facts: HealthFacts,
  ctx: EvalContext,
): HealthSuggestion | null {
  switch (link.kind) {
    case 'sleep': {
      const n = facts.night;
      if (!n) return null;
      const min = (link.minHours ?? 0) * 60;
      const max = link.maxHours != null ? link.maxHours * 60 : Infinity;
      if (n.asleepMinutes < min || n.asleepMinutes > max) return null;
      return {
        text: `Apple Health: ${formatHoursMinutes(n.asleepMinutes)} asleep last night${sourcesText(n.sources)}.`,
      };
    }
    case 'wake': {
      const n = facts.night;
      if (!n || link.byMinute == null) return null;
      if (wakeMinuteOfDay(n.wakeMs, ctx.zone) > link.byMinute) return null;
      return { text: `Apple Health: up at ${formatClockIn(n.wakeMs, ctx.zone)}${sourcesText(n.sources)}.` };
    }
    case 'water': {
      const w = facts.water;
      if (!w || link.minLitres == null) return null;
      if (w.value < link.minLitres * 1000) return null;
      return {
        text: `Apple Health: ${formatWater(w.value, ctx.unitPreference)} of water today${sourcesText(w.sources)}.`,
      };
    }
    case 'steps': {
      const s = facts.steps;
      if (!s || link.minSteps == null) return null;
      if (s.value < link.minSteps) return null;
      return { text: `Apple Health: ${formatInteger(s.value)} steps today${sourcesText(s.sources)}.` };
    }
    case 'mindful': {
      const m = facts.mindful;
      if (!m || link.minMinutes == null) return null;
      if (m.value < link.minMinutes) return null;
      return {
        text: `Apple Health: ${Math.round(m.value)} mindful minutes today${sourcesText(m.sources)}.`,
      };
    }
    case 'workout': {
      const list = facts.workouts;
      if (!list || link.minMinutes == null) return null;
      const w = list.find(
        (x) => x.minutes >= link.minMinutes! && !ctx.consumedWorkouts.includes(x.startISO),
      );
      if (!w) return null;
      return {
        text: `Apple Health saw a ${w.minutes}-min ${w.type} at ${formatClockIn(Date.parse(w.startISO), undefined)} (${w.source}).`,
        workoutStartISO: w.startISO,
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// All of a day's suggestions.
// ---------------------------------------------------------------------------

export interface BuildInput {
  tasks: TaskLike[];
  /** Task key → completion time; present means done. */
  tasksDone: Partial<Record<string, string>>;
  links: Record<string, HealthLink>;
  facts: HealthFacts;
  /** Task key → the date it was dismissed on. */
  dismissed: Partial<Record<string, string>>;
  /** Today's date key, for the dismissal check. */
  dateKey: string;
  /** False once the day is sealed. Nothing is suggested for a closed day. */
  dayOpen: boolean;
  ctx: EvalContext;
}

/**
 * The implicit link a tier workout task has always had: its own minute
 * target, matched against today's workouts. A saved link overrides it.
 */
function implicitLink(task: TaskLike): HealthLink | null {
  if (/^workout/.test(task.key) && task.target?.unit === 'minutes') {
    return { kind: 'workout', minMinutes: task.target.value };
  }
  return null;
}

export function buildSuggestions(input: BuildInput): Record<string, HealthSuggestion> {
  const out: Record<string, HealthSuggestion> = {};
  if (!input.dayOpen) return out;
  // Workouts are spent as they are claimed, so one recording vouches for one
  // task even within a single pass.
  const consumed = [...input.ctx.consumedWorkouts];
  for (const task of input.tasks) {
    if (input.tasksDone[task.key]) continue;
    if (input.dismissed[task.key] === input.dateKey) continue;
    const link = input.links[task.key] ?? implicitLink(task);
    if (!link) continue;
    const s = evaluateLink(link, input.facts, { ...input.ctx, consumedWorkouts: consumed });
    if (!s) continue;
    if (s.workoutStartISO) consumed.push(s.workoutStartISO);
    out[task.key] = s;
  }
  return out;
}

/** What the edit sheet prints for a saved link. */
export function describeLink(link: HealthLink, unit: 'metric' | 'imperial'): string {
  switch (link.kind) {
    case 'sleep': {
      const min = `${link.minHours ?? 0} h`;
      return link.maxHours != null
        ? `Asleep ${min} to ${link.maxHours} h last night`
        : `Asleep at least ${min} last night`;
    }
    case 'wake': {
      const m = link.byMinute ?? 0;
      const h12 = Math.floor(m / 60) % 12 || 12;
      return `Woke up by ${h12}:${String(m % 60).padStart(2, '0')} ${m < 720 ? 'AM' : 'PM'}`;
    }
    case 'water':
      return `At least ${formatWaterTarget(link.minLitres ?? 0, unit)} of water today`;
    case 'steps':
      return `At least ${formatInteger(link.minSteps ?? 0)} steps today`;
    case 'workout':
      return `A workout of at least ${link.minMinutes ?? 0} min today`;
    case 'mindful':
      return `At least ${link.minMinutes ?? 0} mindful minutes today`;
    default:
      return '';
  }
}

/** Only the keys a rule kind uses survive; a stored blob cannot smuggle more. */
export function sanitizeLink(raw: unknown): HealthLink | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!HEALTH_RULE_KINDS.some((k) => k.kind === r.kind)) return null;
  const kind = r.kind as HealthRuleKind;
  const num = (k: string): number | undefined => {
    const v = r[k];
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  switch (kind) {
    case 'sleep': {
      const minHours = num('minHours');
      if (minHours == null) return null;
      const maxHours = num('maxHours');
      return { kind, minHours, ...(maxHours != null ? { maxHours } : {}) };
    }
    case 'wake': {
      const byMinute = num('byMinute');
      return byMinute == null || byMinute > 1439 ? null : { kind, byMinute };
    }
    case 'water': {
      const minLitres = num('minLitres');
      return minLitres == null ? null : { kind, minLitres };
    }
    case 'steps': {
      const minSteps = num('minSteps');
      return minSteps == null ? null : { kind, minSteps };
    }
    case 'workout':
    case 'mindful': {
      const minMinutes = num('minMinutes');
      return minMinutes == null ? null : { kind, minMinutes };
    }
    default:
      return null;
  }
}

/** Parse the stored blob: task key → link. Anything malformed is dropped. */
export function restoreLinks(raw: string | null | undefined): Record<string, HealthLink> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, HealthLink> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const link = sanitizeLink(value);
    if (link) out[key] = link;
  }
  return out;
}
