import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { create } from 'zustand';

import { MAX_CUSTOM_TASKS, PINGS, XP } from '@/constants/challenge';
import {
  PREF_KEYS,
  restoreFlag,
  restorePrefs,
  serializeFlag,
  serializePrefs,
} from '@/lib/prefsStorage';
import { undoPing } from '@/lib/pingRollback';
import { writeDay, type DayView } from '@/lib/writeDay';
import type { SyncedPreferences } from '@/lib/serverPrefs';
import type { UnitPreference } from '@/lib/units';
import {
  displayTierLabel,
  targetText,
  TASK_BASES,
  TIERS,
} from '@/constants/tiers';
import type {
  BlockedUser,
  SquadSummary,
  ChallengeLength,
  BuiltinTaskKey,
  CustomTask,
  FeedItem,
  HealthPrefs,
  JournalEntry,
  Meal,
  MealNutrition,
  MetricCheckin,
  Milestone,
  NotificationPrefs,
  PendingChanges,
  ReportReason,
  SavedMeal,
  Scenario,
  ScenarioState,
  TaskDef,
  TaskKey,
  Tier,
} from '@/data/types';
import { DataService, isLiveBackend, supabaseService } from '@/services';
import {
  getHealthAuthDiagnostic,
  getHealthService,
  isHealthSimulated,
  setHealthSimulation,
  type BodyMassSample,
  type HealthWorkout,
} from '@/services/HealthService';

export function formatClock(ts: number = Date.now()): string {
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

export function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Local calendar date (YYYY-MM-DD) — ping allowance is keyed to this. */
export function localDateKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * The day-selection view, assembled in ONE place.
 *
 * Every write path and the check-in screen resolve their day from this,
 * through writeDay(). Before Phase 20 the screen read `day` while the
 * writes sent nothing at all, leaving the server to pick from its own
 * clock at write time — so the day on screen and the day in the database
 * were two answers to the same question, arrived at moments apart.
 */
export function dayView(s: {
  activeDay: 'today' | 'yesterday';
  day: number;
  yesterday: { day: number; open: boolean } | null;
}): DayView {
  return {
    activeDay: s.activeDay,
    today: s.day,
    yesterday: s.yesterday
      ? { day: s.yesterday.day, open: s.yesterday.open }
      : null,
  };
}

/** Coarse local week key — gates the weekly check-in card. */
export function localWeekKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const start = new Date(d.getFullYear(), 0, 1);
  const week = Math.floor((d.getTime() - start.getTime()) / (7 * 86_400_000));
  return `${d.getFullYear()}-W${week}`;
}

/**
 * On-device Apple Health readings. Render-only; never synced or logged.
 *
 * EVERY FIELD IS NULLABLE, AND null IS NOT ZERO. A null here means "we did
 * not read this" — no permission, no data, or a query that could not run,
 * and HealthKit will not say which. It must never be rendered as 0, and
 * `workouts: null` must never be rendered as "no workouts today". `[]` is
 * the only value that means the workout query ran and came back empty.
 */
export interface HealthReadings {
  dietaryKcal: number | null;
  steps: number | null;
  activeEnergyKcal: number | null;
  workouts: HealthWorkout[] | null;
  bodyMass: BodyMassSample | null;
}

const EMPTY_READINGS: HealthReadings = {
  dietaryKcal: null,
  steps: null,
  activeEnergyKcal: null,
  workouts: null,
  bodyMass: null,
};

/**
 * healthEnabled STARTS FALSE, and that is a correctness fix, not a taste.
 *
 * `requestReadPermissions()` is called from exactly one place — this switch
 * going true. While the default was true, a fresh install had the switch
 * already ON and nothing ever asked: permission was never granted, every
 * reading came back null, and the card drew them as zeroes. The switch was
 * asserting a connection that had never been established.
 *
 * OFF is the only value that is true on a device that has never asked. It
 * also makes the switch mean "ask me now" — turning it on is what presents
 * the sheet — and it is what makes the first preference sync defensible
 * (see lib/serverPrefs.ts and 0013_preference_sync.sql).
 */
const DEFAULT_HEALTH_PREFS: HealthPrefs = {
  healthEnabled: false,
  dietPromptEnabled: true,
  workoutPromptEnabled: true,
  weightPrefillEnabled: true,
};

let feedId = 0;

export type ScreenStateKind = 'ready' | 'loading' | 'error';

/**
 * What the screen showed just before an optimistic write, held until the
 * server has had its say.
 *
 * The service rolls its own mirror back when a write is refused, but the
 * screen does not read the mirror — it reads this store, which had already
 * ticked the checkbox, added the XP and incremented the streak. Offline, that
 * left a user looking at a task marked done, a streak that had grown, and a
 * toast that faded: everything on screen said it saved, and on the next
 * launch none of it was there. Someone finishing their last task in a
 * basement gym has to be told NOW.
 *
 * Keyed per write, so two tasks ticked in the same second unwind
 * independently. An entry is written immediately before its own write every
 * time, so a leftover from a call that succeeded is always overwritten before
 * it could be applied to a later one.
 */
const rollbacks = new Map<string, Partial<AppState>>();

function rememberForRollback(key: string, before: Partial<AppState>): void {
  rollbacks.set(key, before);
}

interface AppState extends ScenarioState {
  /**
   * Every squad this user is in. `squad` on ScenarioState is the ACTIVE one
   * in full — roster, feed, leaderboards — and this is the list the switcher
   * renders. Two fields because a roster is a read per squad and the
   * switcher only needs names: loading four rosters to draw four tabs would
   * make the common case (one squad) pay for the rare one.
   */
  squads: SquadSummary[];
  activeSquadId: string | null;
  scenario: Scenario;
  deferred: TaskKey[];
  finishFeeling: string | null;
  finishFeelingText: string;
  profileName: string;
  notificationPrefs: NotificationPrefs;
  blockedUsers: BlockedUser[];
  /** Pings spent on `date` (local calendar day). Restores at local midnight. */
  pingsUsed: { date: string; count: number };
  /** Dev-forced screen state for QA of loading/error UI. */
  screenState: ScreenStateKind;
  healthPrefs: HealthPrefs;
  /** On-device only. Never written to a backend or log. */
  healthReadings: HealthReadings;
  /** Whether a HealthKit source can be queried right now. */
  healthAvailable: boolean;
  /**
   * Whether iOS has ever shown this device the Health permission sheet for
   * our read types. NOT whether it was granted — HealthKit does not report
   * read grants (see HealthService.HealthAuthRequestStatus).
   *
   * This is the belt to the default-false braces: a device carrying a
   * `healthEnabled: true` blob written by an earlier build, or one that
   * adopted a stale server row, must still land on the Connect state rather
   * than on a card full of numbers nobody was allowed to read.
   */
  healthAsked: boolean;
  /**
   * What the OS literally returned for the auth-status question, plus its
   * typeof. Diagnostic only — nothing branches on it; `healthAsked` is the
   * decision. It exists because "Not connected for ever" and "permission
   * denied" look identical on screen, and one of them is a marshalling bug.
   * An authorization enum is not a health value (see HealthAuthDiagnostic).
   */
  healthAuthRaw: string | null;
  /** Health prompt dismissals: 'diet' | 'workout' -> local date dismissed. */
  healthPromptDismissed: Partial<Record<'diet' | 'workout', string>>;
  /**
   * Start times of Health workouts already used to confirm a task — one
   * recorded activity vouches for at most one completion.
   * PRIVACY: in-memory ONLY. This is HealthKit-derived data; it must never
   * be written to AsyncStorage or any backend (see PRIVACY_NOTES.md). It
   * resets on relaunch by design — completed tasks are filtered out anyway.
   */
  healthWorkoutsConsumed: string[];
  healthSimulated: boolean;
  metricCheckins: MetricCheckin[];
  savedMeals: SavedMeal[];
  /** Display preference only — storage is ALWAYS kg/cm (see lib/units.ts). */
  unitPreference: UnitPreference;
  /** Week key when the check-in card was dismissed or saved. */
  checkinHandledWeek: string | null;
  /**
   * The challenge whose restart notice the user dismissed (Phase 38C), or
   * null. Keyed on the challenge id so a later restart gets its own notice.
   * Device-local, like the check-in dismissal: a second device shows the
   * notice again until it too is dismissed or a day is sealed.
   */
  restartNoticeDismissedFor: string | null;
  /** Settings: permanently hide the weekly check-in card. */
  weeklyCheckinEnabled: boolean;
  /**
   * TODAY's task set, frozen at day start. Every count, completion check
   * and streak evaluation reads this snapshot — never the live task list —
   * so edits can never alter today or the past.
   */
  todayTasks: TaskDef[];
  /** Tomorrow's set, reflecting pending adds/removals and tier change. */
  tomorrowTasks: TaskDef[];
  customTasks: CustomTask[];
  pendingChanges: PendingChanges;

  loadScenario: (scenario: Scenario) => void;
  setTier: (tier: Tier) => void;
  /**
   * `sync: false` completes locally only, for the one caller that owns the
   * backend write itself — the timer, whose completeTimedTask() carries the
   * elapsed duration. complete_task() is `on conflict do nothing`, so a
   * second, duration-less call racing it would silently drop the duration.
   */
  completeTask: (key: TaskKey, options?: { sync?: boolean }) => void;
  uncompleteTask: (key: TaskKey) => void;
  deferTask: (key: TaskKey) => void;
  sealDay: () => void;
  /**
   * WHICH DAY THE CHECK-IN SCREEN IS TICKING.
   *
   * For part of every morning two days are open at once, and every write on
   * that screen has to say which one it means. This is that answer, held in
   * one place rather than inferred at each call site — an inferred answer is
   * how a task ends up ticked on the wrong day.
   *
   * It can only ever be 'yesterday' while the server says yesterday is open;
   * setActiveDay refuses otherwise, and a refresh that closes the window
   * snaps it back to 'today'.
   */
  activeDay: 'today' | 'yesterday';
  /**
   * The local calendar day on which the server's day window was last
   * fetched, or null before the first fetch.
   *
   * Staleness is a calendar question, not an elapsed-time one: a window
   * fetched at 23:59 is stale a minute later, and one fetched at 00:05 is
   * good for another twenty-four hours. Read through dayWindowIsStale().
   */
  dayWindowFetchedOn: string | null;
  /** Today's server boundary instant, for the date label. */
  todayClosesAt: string | null;
  /** The challenge's IANA zone, so the date label is right off-zone. */
  challengeTimezone: string | null;
  setActiveDay: (which: 'today' | 'yesterday') => void;
  saveJournal: (text: string) => JournalEntry;
  logMeal: (text: string) => Meal;
  addMilestone: (title: string) => Milestone;
  toggleMilestone: (id: string) => void;
  /** Returns false when the daily ping allowance is spent. */
  sendPing: (toName: string, text: string) => boolean;
  /**
   * All four are async and all four THROW. The screens await them and show
   * the server's own message — "you are already in this squad", "only the
   * squad creator can rename it" — because those refusals are the useful
   * part and a swallowed one leaves a button that looks broken.
   */
  createSquad: (name: string) => Promise<void>;
  joinSquad: (code: string) => Promise<void>;
  renameSquad: (squadId: string, name: string) => Promise<void>;
  leaveSquad: (squadId: string) => Promise<void>;
  setActiveSquad: (squadId: string) => Promise<void>;
  reportFeedItem: (id: string, reason: ReportReason) => void;
  blockUser: (user: { id?: string; name: string }) => void;
  unblockUser: (id: string) => void;
  updateProfile: (name: string, why: string) => void;
  setNotificationPref: (key: keyof NotificationPrefs, value: boolean) => void;
  attachNutrition: (mealId: string, nutrition: MealNutrition) => void;
  removeNutrition: (mealId: string) => void;
  saveMealTemplate: (name: string, nutrition: MealNutrition) => void;
  removeSavedMeal: (id: string) => void;
  /** One-tap log of a saved meal (name + attached nutrition). */
  logSavedMeal: (id: string) => void;
  setHealthPref: (key: keyof HealthPrefs, value: boolean) => void;
  /** Present the permission sheet, then re-read. Safe to call twice. */
  connectHealth: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  dismissHealthPrompt: (kind: 'diet' | 'workout') => void;
  /** Mark a Health workout as used for a confirmed completion. */
  consumeHealthWorkout: (startISO: string) => void;
  toggleHealthSimulation: () => void;
  saveMetricCheckin: (weightKg: number | null, mood: number | null) => void;
  /**
   * Correct or remove a past check-in. Both REJECT if the server refused,
   * having changed nothing — the screen keeps the user's value and says so
   * rather than showing a success it cannot stand behind.
   */
  updateMetricCheckin: (
    id: string,
    weightKg: number | null,
    mood: number | null,
  ) => Promise<void>;
  deleteMetricCheckin: (id: string) => Promise<void>;
  dismissCheckinCard: () => void;
  /** Re-open the entry form for a week already handled. */
  reopenCheckinCard: () => void;
  /** Hide the restart notice for the challenge on screen. */
  dismissRestartNotice: () => void;
  /**
   * 0018: reopen the missed day that ended the previous challenge. Server-
   * owned and not optimistic: which challenge is alive changes underneath
   * the mirror, so the caller re-hydrates the session afterwards. Throws
   * with the server's reason.
   */
  restoreMissedDay: () => Promise<void>;
  setWeeklyCheckinEnabled: (enabled: boolean) => void;
  setUnitPreference: (pref: UnitPreference) => void;
  /** Load persisted preference + check-ins (call once at app start). */
  hydratePersisted: () => Promise<void>;
  /**
   * Settle this device's preferences against the account's. Adopts the
   * server's copy, or seeds the server from this device when the account has
   * never recorded one. Safe to call repeatedly; waits for
   * hydratePersisted() so it can never seed half-restored state.
   */
  reconcilePreferences: () => Promise<void>;
  /**
   * Ask the server what day it is and pull today back into step with it.
   * Called on every foreground. Silent on failure by design — see the
   * service's refreshToday().
   */
  refreshDay: () => Promise<void>;
  /**
   * Re-read everything the server owns: the day, the squad roster, the feed,
   * the leaderboards, and the owner-only logs. Pull-to-refresh on every
   * screen that shows server data calls this, and so does every return to
   * the foreground.
   *
   * Resolves only once the refetch has actually finished, so a spinner tied
   * to it cannot bounce back before the data lands. Silent on failure for
   * the same reason refreshDay() is: the mirror keeps what it had.
   */
  refreshFromServer: () => Promise<void>;
  /**
   * Adopt the backend mirror after a sign-in or a cold launch that restored
   * a session. DataService has already hydrated; this copies that state in.
   */
  adoptSession: (profile: { name?: string | null }) => void;
  /**
   * Back to signed-out defaults. Local only — the caller owns ending the
   * Supabase session and clearing the service mirror first.
   */
  resetSession: () => void;
  /** Returns false when the 4-custom-task cap is hit. */
  addCustomTask: (input: {
    name: string;
    sub: string;
    proof: boolean;
    timerMinutes?: number;
  }) => boolean;
  updateCustomTask: (
    id: string,
    patch: Partial<Pick<CustomTask, 'name' | 'sub' | 'proof' | 'timerMinutes'>>,
  ) => void;
  removeCustomTask: (id: string) => void;
  /** Pending tier change — takes effect at the next rollover. */
  requestTierChange: (tier: Tier) => void;
  /**
   * Move the finish line. Resolves with whether the change ended the
   * challenge, so the caller can say what happened rather than guess.
   */
  changeChallengeDuration: (
    days: ChallengeLength,
  ) => Promise<{ completed: boolean }>;
  /** Set a tier task's target — effective tomorrow, like every edit. */
  updateTaskTarget: (taskKey: TaskKey, value: number) => void;
  undoPendingChanges: () => void;
  /** Dev: simulate the local-midnight rollover. */
  advanceDay: () => void;
  /**
   * Guideline 5.1.1(v) deletion. Rejects if the server refused, and clears
   * nothing in that case — the account still exists and the screen must not
   * pretend otherwise.
   */
  deleteAccount: () => Promise<void>;
  setScreenState: (state: ScreenStateKind) => void;
  setFinishFeeling: (feeling: string | null) => void;
  setFinishFeelingText: (text: string) => void;
  saveCompletionFeeling: () => void;
}

function fromScenario(scenario: Scenario): ScenarioState {
  return DataService.loadScenario(scenario);
}

/** Everything DataService owns about the editable task config, mirrored. */
function taskConfigMirror(tier: Tier, day: number) {
  return {
    todayTasks: DataService.getTodayTasks(tier, day),
    tomorrowTasks: DataService.getTomorrowTasks(tier, day),
    customTasks: [...DataService.getCustomTasks()],
    pendingChanges: DataService.getPendingChanges(tier, day),
  };
}

const DEFAULT_PREFS: NotificationPrefs = {
  pings: true,
  squadActivity: true,
  dailyReminder: false,
  timerAlerts: true,
};

const NOTIF_PREFS_KEY = PREF_KEYS.notifications;
const HEALTH_PREFS_KEY = PREF_KEYS.health;
const WEEKLY_CHECKIN_KEY = PREF_KEYS.weeklyCheckin;

const UNIT_PREF_KEY = 'ranked.unitPreference.v1';
/** Seed from the device locale; the user can change it in Settings. */
function localeUnitPreference(): UnitPreference {
  try {
    const system = getLocales()[0]?.measurementSystem;
    return system === 'us' ? 'imperial' : 'metric';
  } catch {
    return 'metric';
  }
}
const CHECKINS_KEY = 'ranked.metricCheckins.v1';
const RESTART_NOTICE_KEY = 'ranked.restartNoticeDismissed.v1';
/**
 * What the restart-notice dismissal is keyed on: the server's challenge id,
 * or a fixed token on the mock, which has no ids to offer.
 */
const restartNoticeKey = (challengeId: string | null | undefined) =>
  challengeId ?? 'mock';

/**
 * The local copy of the check-in history. It exists so the "Last check-in"
 * line and the history screen still read correctly with no network; the
 * server is the record.
 */
const persistCheckins = (checkins: MetricCheckin[]) => {
  AsyncStorage.setItem(CHECKINS_KEY, JSON.stringify(checkins)).catch(() => {});
};

/**
 * Preferences that MUST survive a relaunch.
 *
 * All three of these were `set()` and nothing else, so every one of them
 * reset on launch: you turned a notification off, and the next time you
 * opened the app it was on again. A switch that forgets is a switch that
 * lied about what it did — the same bug as a dead button, spread over time.
 *
 * They are device settings, not account state, so AsyncStorage rather than
 * the server: which alerts this phone shows is a fact about this phone.
 * The serialisation lives in lib/prefsStorage.ts, which is pure and has its
 * own proofs in scripts/prefs.test.mjs.
 */
function persist(key: string, value: object): void {
  AsyncStorage.setItem(key, serializePrefs(value)).catch(() => {});
}

/**
 * ...AND THE ONES THAT MUST SURVIVE A NEW PHONE.
 *
 * The paragraph above is right about which alerts a phone shows. It is wrong
 * about the rest, and Phase 17A is what made the difference matter: friends
 * mid-challenge are moving from the web build to a native one. Units,
 * notification switches, health prompts and the weekly check-in card are
 * facts about a PERSON, and every one of them lived only in AsyncStorage —
 * so the move re-derived units from the phone's locale (a browser on a
 * laptop and a phone can easily disagree) and put every switch back to its
 * default. Someone who deliberately turned notifications off and finds them
 * on has had a choice reverted without being asked.
 *
 * The columns to hold them have existed since 0003/0004 and nothing had ever
 * written one. These three pieces are what wire them up:
 *
 *   - every setter also calls DataService.savePreferences()
 *   - reconcilePreferences() adopts the server's copy at sign-in and on every
 *     refresh, or SEEDS the server from this device when the account has
 *     never saved one (see lib/serverPrefs.ts for why that distinction is
 *     load-bearing rather than fussy)
 *   - the AsyncStorage copy stays, as a cache: it is what paints the first
 *     frame on a cold launch, before any network read has answered.
 *
 * ORDERING. reconcilePreferences() must never run against half-restored
 * device state, or it would seed the server with defaults the user never
 * chose. hydratePersisted() is fired from the app root at mount and the
 * network round trips of sign-in take far longer — but "far longer" is not a
 * guarantee, so this is one.
 */
let devicePrefsStarted = false;
/**
 * Whether this session has already offered its preferences to an account that
 * had none. ONCE, not once per refresh: reconcilePreferences() runs on every
 * foreground and pull-to-refresh, and a seed that kept failing — 0013 not
 * applied yet, say — would raise "that change didn't save" every time the app
 * came back, for a change the user never made.
 */
let prefsSeedAttempted = false;
let markDevicePrefsRestored: () => void = () => {};
const devicePrefsRestored = new Promise<void>((resolve) => {
  markDevicePrefsRestored = resolve;
});

/**
 * One line naming what the OS returned for the auth-status question. Read by
 * the dev sheet and by the device gate; nothing branches on it.
 */
function describeAuthDiagnostic(): string | null {
  const d = getHealthAuthDiagnostic();
  return d ? `${d.raw} (typeof ${d.typeOf}) -> ${d.parsedAs}` : null;
}

/** The account-level preferences as this device currently holds them. */
function currentSyncedPreferences(s: {
  unitPreference: UnitPreference;
  notificationPrefs: NotificationPrefs;
  healthPrefs: HealthPrefs;
  weeklyCheckinEnabled: boolean;
}): SyncedPreferences {
  return {
    unitPreference: s.unitPreference,
    notifications: s.notificationPrefs,
    health: s.healthPrefs,
    weeklyCheckinEnabled: s.weeklyCheckinEnabled,
  };
}

/**
 * "The server says this week's check-in is already done."
 *
 * Returns a patch that only ever SETS the week — never clears it. Dismissing
 * the card is a local act with no server record (see reopenCheckinCard), so a
 * refresh that cleared this would reopen a card the user had just put away.
 */
function handledThisWeek(checkins: MetricCheckin[]): {
  checkinHandledWeek?: string;
} {
  const week = localWeekKey();
  const last = checkins[0];
  return last && localWeekKey(last.timestamp) === week
    ? { checkinHandledWeek: week }
    : {};
}

const initialScenario = fromScenario('day1');
const initialTaskConfig = taskConfigMirror(
  initialScenario.tier,
  initialScenario.day,
);

export const useAppStore = create<AppState>((set, get) => ({
  scenario: 'day1',
  squads: [],
  activeSquadId: null,
  activeDay: 'today',
  dayWindowFetchedOn: null,
  todayClosesAt: null,
  challengeTimezone: null,
  deferred: [],
  finishFeeling: null,
  finishFeelingText: '',
  profileName: 'You',
  notificationPrefs: DEFAULT_PREFS,
  blockedUsers: [],
  pingsUsed: { date: localDateKey(), count: 0 },
  screenState: 'ready',
  healthPrefs: DEFAULT_HEALTH_PREFS,
  healthReadings: EMPTY_READINGS,
  healthAvailable: false,
  healthAsked: false,
  healthAuthRaw: null,
  healthPromptDismissed: {},
  healthWorkoutsConsumed: [],
  healthSimulated: false,
  metricCheckins: [],
  savedMeals: [],
  unitPreference: localeUnitPreference(),
  checkinHandledWeek: null,
  restartNoticeDismissedFor: null,
  weeklyCheckinEnabled: true,
  ...initialScenario,
  ...initialTaskConfig,

  loadScenario: (scenario) => {
    const st = fromScenario(scenario);
    set({
      scenario,
      deferred: [],
      finishFeeling: null,
      finishFeelingText: '',
      blockedUsers: [],
      pingsUsed: { date: localDateKey(), count: 0 },
      screenState: 'ready',
      ...st,
      ...taskConfigMirror(st.tier, st.day),
    });
  },

  // Dev/QA tier switch: instant, re-freezes today's snapshot for the new
  // tier and drops custom tasks. User-facing tier changes go through
  // requestTierChange and take effect tomorrow.
  setTier: (tier) => {
    const s = get();
    DataService.initTaskConfig(tier, s.day);
    const config = taskConfigMirror(tier, s.day);
    const allowed = new Set(config.todayTasks.map((t) => t.key));
    const tasksDone: Partial<Record<TaskKey, string>> = {};
    for (const [k, v] of Object.entries(s.tasksDone)) {
      if (allowed.has(k)) tasksDone[k] = v;
    }
    const count = config.todayTasks.length;
    set({
      tier,
      ...config,
      tasksDone,
      deferred: s.deferred.filter((k) => allowed.has(k)),
      squad: s.squad
        ? {
            ...s.squad,
            members: s.squad.members.map((m) => ({
              ...m,
              // Each member against their own task count, not the viewer's.
              doneToday: Math.min(m.doneToday, m.isSelf ? count : m.tasksToday),
            })),
          }
        : null,
    });
  },

  setActiveDay: (which) => {
    const s = get();
    // 'yesterday' is only reachable while the SERVER says it is open. The
    // device's clock has no say: the boundary is noon in the challenge's
    // timezone, and a phone in another zone would otherwise offer a day every
    // write against it is going to be refused.
    if (which === 'yesterday' && !(s.yesterday && s.yesterday.open)) return;
    set({ activeDay: which });
  },

  completeTask: (key, options) => {
    const s0 = get();
    const y = s0.yesterday;
    // THE day for this tap. The same call the check-in screen makes to decide
    // what to render, so the two cannot disagree.
    const target = writeDay(dayView(s0));
    if (y && target === y.day) {
      if (y.tasksDone[key]) return;
      const at = formatClock();
      rememberForRollback(`complete:${y.day}:${key}`, {
        yesterday: y,
        xp: s0.xp,
      });
      set((s) => ({
        yesterday: s.yesterday
          ? { ...s.yesterday, tasksDone: { ...s.yesterday.tasksDone, [key]: at } }
          : s.yesterday,
        xp: s.xp + XP.task,
      }));
      // No local feed row. The squad feed is a record of what happened today;
      // a "checked off" line for yesterday, posted this morning, would read
      // as today's work to everyone but the person who did it.
      if (options?.sync !== false) DataService.completeTask(key, at, y.day);
      return;
    }
    const { tasksDone, feed, todayTasks } = s0;
    if (tasksDone[key]) return;
    const label = todayTasks.find((t) => t.key === key)?.label ?? key;
    const at = formatClock();
    const item: FeedItem = {
      id: `f-local-${++feedId}`,
      kind: 'complete',
      who: 'You',
      text: `checked off ${label}.`,
      timestamp: Date.now(),
    };
    // Recorded BEFORE the optimistic update, whatever `sync` says: the timer
    // path passes sync:false and does its own backend write, and that write
    // can be refused exactly like this one.
    rememberForRollback(`complete:${key}`, {
      tasksDone: s0.tasksDone,
      deferred: s0.deferred,
      xp: s0.xp,
      feed: s0.feed,
    });
    set((s) => ({
      tasksDone: { ...s.tasksDone, [key]: at },
      deferred: s.deferred.filter((k) => k !== key),
      xp: s.xp + XP.task,
      feed: [item, ...feed],
    }));
    // NAMED, always. The server validates the key against ITS frozen
    // snapshot for the day we asked for, and refuses one that has closed — a
    // rejection rolls the service mirror back, reaches the user as a toast,
    // and unwinds the tick above through onWriteRejected. What it will no
    // longer do is quietly choose a different day than the one on screen.
    if (options?.sync !== false) DataService.completeTask(key, at, target);
  },

  uncompleteTask: (key) => {
    const s0 = get();
    const y = s0.yesterday;
    const target = writeDay(dayView(s0));
    if (y && target === y.day) {
      if (!y.tasksDone[key]) return;
      rememberForRollback(`uncomplete:${y.day}:${key}`, {
        yesterday: y,
        xp: s0.xp,
      });
      set((s) => {
        if (!s.yesterday) return {};
        const next = { ...s.yesterday.tasksDone };
        delete next[key];
        return {
          yesterday: { ...s.yesterday, tasksDone: next },
          xp: Math.max(0, s.xp - XP.task),
        };
      });
      DataService.uncompleteTask(key, y.day);
      return;
    }
    if (!s0.tasksDone[key]) return;
    rememberForRollback(`uncomplete:${key}`, {
      tasksDone: s0.tasksDone,
      xp: s0.xp,
    });
    set((s) => {
      const next = { ...s.tasksDone };
      delete next[key];
      return { tasksDone: next, xp: Math.max(0, s.xp - XP.task) };
    });
    DataService.uncompleteTask(key, target);
  },

  deferTask: (key) =>
    set((s) => ({
      deferred: [...s.deferred.filter((k) => k !== key), key],
    })),



  sealDay: () => {
    const s = get();
    const y = s.yesterday;
    const target = writeDay(dayView(s));
    if (y && target === y.day) {
      if (y.sealed) return;
      rememberForRollback(`seal:${y.day}`, {
        yesterday: y,
        xp: s.xp,
        flame: s.flame,
        bestFlame: s.bestFlame,
        perfectDays: s.perfectDays,
      });
      set((st) => ({
        yesterday: st.yesterday ? { ...st.yesterday, sealed: true } : st.yesterday,
        xp: st.xp + XP.dayComplete,
        // A day finished inside the window is a met day, so it pays the
        // flame like any other. The server recomputes both on the next
        // hydrate; this is the optimistic mirror, not the record.
        flame: st.flame + 1,
        bestFlame: Math.max(st.bestFlame, st.flame + 1),
        perfectDays: st.perfectDays + 1,
        // Back to today the moment yesterday is done. Leaving the screen in
        // yesterday-mode after there is nothing left to do there is how a
        // user ends up ticking the wrong day.
        activeDay: 'today',
      }));
      DataService.sealDay(y.day);
      return;
    }
    if (s.dayComplete) return;
    const count = s.todayTasks.length;
    const item: FeedItem = {
      id: `f-local-${++feedId}`,
      kind: 'complete',
      who: 'You',
      text: `locked in Day ${s.day} — ${count} of ${count}.`,
      timestamp: Date.now(),
    };
    // A sealed day is the single most expensive thing to get wrong on
    // screen: it is the streak. Every field the seal touches is captured so
    // a refusal puts back the exact numbers, not an approximation of them.
    rememberForRollback('seal', {
      dayComplete: s.dayComplete,
      xp: s.xp,
      flame: s.flame,
      bestFlame: s.bestFlame,
      perfectDays: s.perfectDays,
      missedDay: s.missedDay,
      feed: s.feed,
    });
    set({
      dayComplete: true,
      xp: s.xp + XP.dayComplete,
      flame: s.flame + 1,
      bestFlame: Math.max(s.bestFlame, s.flame + 1),
      perfectDays: s.perfectDays + 1,
      missedDay: false,
      feed: [item, ...s.feed],
    });
    // seal_day() re-counts completions against the server's own snapshot —
    // it will refuse a day the server does not consider finished. Named, like
    // every other write, so it seals the day the screen was showing.
    DataService.sealDay(target);
  },

  saveJournal: (text) => {
    const s0 = get();
    rememberForRollback('journal', { journal: s0.journal, xp: s0.xp });
    const entry = DataService.saveJournalEntry(s0.day, text);
    set((s) => ({
      journal: [entry, ...s.journal],
      xp: s.xp + XP.journal,
    }));
    return entry;
  },

  logMeal: (text) => {
    rememberForRollback('meal', { meals: get().meals });
    const meal = DataService.logMeal(text);
    set((s) => ({ meals: [meal, ...s.meals] }));
    return meal;
  },

  addMilestone: (title) => {
    rememberForRollback('milestone', { milestones: get().milestones });
    const milestone = DataService.addMilestone(title);
    set((s) => ({ milestones: [...s.milestones, milestone] }));
    return milestone;
  },

  toggleMilestone: (id) => {
    const s = get();
    const target = s.milestones.find((m) => m.id === id);
    rememberForRollback('milestone', { milestones: s.milestones, xp: s.xp });
    const milestones = DataService.toggleMilestone(id, s.day);
    set({
      milestones,
      xp: target && !target.done ? s.xp + XP.milestone : s.xp,
    });
  },

  sendPing: (toName, text) => {
    const s = get();
    const today = localDateKey();
    const used = s.pingsUsed.date === today ? s.pingsUsed.count : 0;
    if (used >= PINGS.maxPerDay) return false;
    const item: FeedItem = {
      id: `f-local-${++feedId}`,
      kind: 'ping-out',
      who: 'You',
      text: `pinged ${toName} — \u201C${text}\u201D`,
      timestamp: Date.now(),
    };
    set({
      feed: [item, ...s.feed],
      pingsUsed: { date: today, count: used + 1 },
    });
    // The local count above is a courtesy pre-check; send_ping() enforces the
    // real quota and rejects a recipient outside the squad — and `item.id` is
    // how a refusal finds the row above again, so a ping that was never sent
    // does not stay in the feed claiming it was.
    DataService.sendPing(toName, text, item.id);
    return true;
  },

  createSquad: async (name) => {
    await DataService.createSquad(name);
    set(DataService.getSquadState());
  },
  joinSquad: async (code) => {
    await DataService.joinSquad(code);
    set(DataService.getSquadState());
  },
  renameSquad: async (squadId, name) => {
    await DataService.renameSquad(squadId, name);
    set(DataService.getSquadState());
  },
  leaveSquad: async (squadId) => {
    await DataService.leaveSquad(squadId);
    set(DataService.getSquadState());
  },
  setActiveSquad: async (squadId) => {
    await DataService.setActiveSquad(squadId);
    set(DataService.getSquadState());
  },

  reportFeedItem: (id, reason) => {
    DataService.reportContent(id, reason);
  },

  blockUser: (user) => set({ blockedUsers: DataService.blockUser(user) }),
  unblockUser: (id) => set({ blockedUsers: DataService.unblockUser(id) }),

  updateProfile: (name, why) => {
    const trimmedName = name.trim() || 'You';
    const trimmedWhy = why.trim() || get().why;
    set({ profileName: trimmedName, why: trimmedWhy });
    // The name is the squad-visible surface: kept only here, no squadmate
    // would ever see it, and it would not survive a reinstall either.
    DataService.updateProfile(trimmedName, trimmedWhy);
  },

  setNotificationPref: (key, value) => {
    const next = { ...get().notificationPrefs, [key]: value };
    set({ notificationPrefs: next });
    persist(NOTIF_PREFS_KEY, next);
    DataService.savePreferences(currentSyncedPreferences(get()));
  },

  attachNutrition: (mealId, nutrition) => {
    rememberForRollback('meal', { meals: get().meals });
    set({ meals: [...DataService.attachNutrition(mealId, nutrition)] });
  },

  removeNutrition: (mealId) => {
    rememberForRollback('meal', { meals: get().meals });
    set({ meals: [...DataService.removeNutrition(mealId)] });
  },

  saveMealTemplate: (name, nutrition) => {
    DataService.saveMealTemplate(name, nutrition)
      .then((savedMeals) => set({ savedMeals }))
      .catch(() => {});
  },

  removeSavedMeal: (id) => {
    DataService.removeSavedMeal(id)
      .then((savedMeals) => set({ savedMeals }))
      .catch(() => {});
  },

  logSavedMeal: (id) => {
    const template = get().savedMeals.find((m) => m.id === id);
    if (!template) return;
    rememberForRollback('meal', { meals: get().meals });
    const meal = DataService.logMeal(template.name);
    DataService.attachNutrition(meal.id, template.nutrition);
    set({ meals: [...DataService.getMeals()] });
  },

  setHealthPref: (key, value) => {
    const nextPrefs = { ...get().healthPrefs, [key]: value };
    set({ healthPrefs: nextPrefs });
    persist(HEALTH_PREFS_KEY, nextPrefs);
    // The SWITCH syncs. No reading ever does — see PRIVACY_NOTES.md.
    // healthEnabled itself is deliberately NOT among the synced columns:
    // it stands for an OS grant that belongs to this phone, not to the
    // account (lib/serverPrefs.ts).
    DataService.savePreferences(currentSyncedPreferences(get()));
    if (key === 'healthEnabled') {
      if (value) {
        get().connectHealth().catch(() => {});
      } else {
        // Turning it off drops the readings immediately. It does NOT clear
        // healthAsked: iOS has been asked and will not un-ask, and claiming
        // otherwise would be its own small lie.
        set({ healthReadings: EMPTY_READINGS });
      }
    }
  },

  /**
   * The single place that asks iOS for Health access.
   *
   * `requestReadPermissions()` resolving true means THE REQUEST COMPLETED,
   * never that anything was granted — so `healthAsked` is set from it and
   * nothing else is inferred. Calling this when the sheet has already been
   * shown is harmless: iOS presents nothing and resolves immediately.
   */
  connectHealth: async () => {
    try {
      const service = getHealthService();
      if (!service.isAvailable()) return;
      await service.requestReadPermissions();
    } catch {
      // A failed request is "still not asked". Nothing to record.
    }
    await get().refreshHealth();
  },

  refreshHealth: async () => {
    // Defence in depth: nothing from the health layer may ever propagate
    // into app startup. Any failure degrades to "no health data".
    try {
      const service = getHealthService();
      const available = service.isAvailable();
      // 'unknown' counts as not-asked: asking twice costs a silent no-op,
      // assuming we were asked costs a card that claims a connection.
      const asked =
        available && (await service.getAuthRequestStatus()) === 'requested';
      const { healthPrefs } = get();
      if (!available || !healthPrefs.healthEnabled || !asked) {
        set({
          healthReadings: EMPTY_READINGS,
          healthAvailable: available,
          healthAsked: asked,
          healthAuthRaw: describeAuthDiagnostic(),
        });
        return;
      }
      const [dietaryKcal, steps, activeEnergyKcal, workouts, bodyMass] =
        await Promise.all([
          service.getTodayDietaryEnergyKcal(),
          service.getTodaySteps(),
          service.getTodayActiveEnergyKcal(),
          service.getTodayWorkouts(),
          service.getLatestBodyMass(),
        ]);
      set({
        healthReadings: { dietaryKcal, steps, activeEnergyKcal, workouts, bodyMass },
        healthAvailable: true,
        healthAsked: true,
        healthAuthRaw: describeAuthDiagnostic(),
      });
    } catch {
      set({ healthReadings: EMPTY_READINGS });
    }
  },

  dismissHealthPrompt: (kind) =>
    set((s) => ({
      healthPromptDismissed: {
        ...s.healthPromptDismissed,
        [kind]: localDateKey(),
      },
    })),

  consumeHealthWorkout: (startISO) =>
    set((s) => ({
      healthWorkoutsConsumed: [...s.healthWorkoutsConsumed, startISO],
    })),

  toggleHealthSimulation: () => {
    const next = !isHealthSimulated();
    setHealthSimulation(next);
    set({
      healthSimulated: next,
      healthPromptDismissed: {},
      healthWorkoutsConsumed: [],
    });
    get().refreshHealth();
  },

  saveMetricCheckin: (weightKg, mood) => {
    // weightKg is ALWAYS canonical kg — conversion happened at the input
    // boundary via lib/units.ts. Never store display units.
    const checkin = DataService.saveMetricCheckin(weightKg, mood);
    set((s) => {
      const metricCheckins = [checkin, ...s.metricCheckins];
      persistCheckins(metricCheckins);
      return { metricCheckins, checkinHandledWeek: localWeekKey() };
    });
  },

  updateMetricCheckin: async (id, weightKg, mood) => {
    // The service call is the GATE, not the source of the new list: it throws
    // when the server refuses and returns having written nothing otherwise.
    // The store's own array stays authoritative for what is on screen, which
    // also keeps a mock build (whose service mirror holds only this session's
    // entries) from dropping restored history on an edit.
    await DataService.updateMetricCheckin(id, weightKg, mood);
    set((s) => {
      const metricCheckins = s.metricCheckins.map((c) =>
        c.id === id ? { ...c, weightKg, mood } : c,
      );
      persistCheckins(metricCheckins);
      return { metricCheckins };
    });
  },

  deleteMetricCheckin: async (id) => {
    await DataService.deleteMetricCheckin(id);
    set((s) => {
      const removed = s.metricCheckins.find((c) => c.id === id);
      const metricCheckins = s.metricCheckins.filter((c) => c.id !== id);
      persistCheckins(metricCheckins);
      // Deleting THIS week's check-in has to reopen the card. Otherwise the
      // sticky "handled this week" flag leaves Track showing a read-back line
      // for a row that no longer exists — or, once the last one is gone,
      // showing nothing at all, with no way back to the history and no way to
      // enter a replacement until the week turns over.
      const thisWeek = localWeekKey();
      const removedThisWeek =
        removed != null && localWeekKey(removed.timestamp) === thisWeek;
      const stillHandled = metricCheckins.some(
        (c) => localWeekKey(c.timestamp) === thisWeek,
      );
      return removedThisWeek && !stillHandled
        ? { metricCheckins, checkinHandledWeek: null }
        : { metricCheckins };
    });
  },

  dismissCheckinCard: () => set({ checkinHandledWeek: localWeekKey() }),

  // The way back from the summary row to the entry form. Checking in twice in
  // one week is allowed — the rows are timestamped and the history holds both
  // — so "handled this week" is a default, not a lock. Local only: nothing
  // server-side records which week the card was collapsed for.
  reopenCheckinCard: () => set({ checkinHandledWeek: null }),

  dismissRestartNotice: () => {
    const key = restartNoticeKey(get().challengeId);
    set({ restartNoticeDismissedFor: key });
    AsyncStorage.setItem(RESTART_NOTICE_KEY, key).catch(() => {});
  },

  restoreMissedDay: async () => {
    await DataService.restoreMissedDay();
    set({ restorable: null });
  },

  setWeeklyCheckinEnabled: (enabled) => {
    set({ weeklyCheckinEnabled: enabled });
    AsyncStorage.setItem(WEEKLY_CHECKIN_KEY, serializeFlag(enabled)).catch(() => {});
    DataService.savePreferences(currentSyncedPreferences(get()));
  },

  setUnitPreference: (pref) => {
    set({ unitPreference: pref });
    AsyncStorage.setItem(UNIT_PREF_KEY, pref).catch(() => {});
    // The device copy above is the cache that paints the first frame; this is
    // the record. Without it a friend who set pounds in the browser opened the
    // native build in kilograms, because nothing had ever asked the server.
    //
    // The WHOLE set goes, not just the field that changed: the write may be
    // the INSERT that creates profile_private, and a column left out of an
    // INSERT takes a DDL default that disagrees with this app. Same at all
    // four call sites.
    DataService.savePreferences(currentSyncedPreferences(get()));
  },

  refreshDay: async () => {
    if (!supabaseService) return;
    try {
      await supabaseService.refreshToday();
    } catch {
      // Keep showing what the mirror already holds. A failed refresh must
      // never be able to blank a real challenge.
      return;
    }
    const st = supabaseService.snapshot;
    const s = get();
    const rolledOver = st.day !== s.day;
    if (rolledOver) {
      // Yesterday's pending rollbacks describe a day that no longer exists;
      // applying one later would put yesterday's ticks back on screen.
      rollbacks.clear();
    }
    set({
      day: st.day,
      // Stamped with every window the server hands back, so the next render
      // can tell whether the day on screen has since gone stale.
      dayWindowFetchedOn: localDateKey(),
      todayClosesAt: st.todayClosesAt ?? null,
      challengeTimezone: st.challengeTimezone ?? null,
      durationDays: st.durationDays,
      tier: st.tier,
      flame: st.flame,
      bestFlame: st.bestFlame,
      perfectDays: st.perfectDays,
      xp: st.xp,
      tasksDone: st.tasksDone,
      dayComplete: st.dayComplete,
      yesterday: st.yesterday,
      // Crossing NOON is a rollover of its own, and this is where it lands.
      // The moment the server stops calling yesterday open, the screen stops
      // being in yesterday-mode — it must never be sitting on a day every
      // write is about to be refused for.
      ...(st.yesterday && st.yesterday.open && !st.yesterday.sealed
        ? {}
        : { activeDay: 'today' as const }),
      // The server decides whether a broken streak is still today's news.
      // Set here rather than only by applyMissedDay(), because the penalty
      // happens at local midnight with the app closed: without this the
      // banner never appeared for the case it exists for.
      missedDay: st.missedDay,
      // Also the server's, and unlike missedDay it survives the rollover:
      // the restart notice reads it (Phase 38C).
      restarted: st.restarted,
      challengeId: st.challengeId ?? null,
      restorable: st.restorable ?? null,
      ...(rolledOver
        ? {
            deferred: [],
            healthPromptDismissed: {},
            healthWorkoutsConsumed: [],
          }
        : {}),
      ...taskConfigMirror(st.tier, st.day),
    });
  },

  refreshFromServer: async () => {
    if (!supabaseService) return;
    try {
      await supabaseService.refreshAll();
    } catch {
      // Same contract as refreshDay(): a failed refresh must never be able
      // to blank a real challenge. Keep the mirror exactly as it was.
      return;
    }
    const st = supabaseService.snapshot;
    const s = get();
    // A refresh that crosses local midnight is a rollover like any other:
    // yesterday's pending rollbacks describe a day that no longer exists.
    if (st.day !== s.day) rollbacks.clear();
    // The server is the record for check-ins, and until now the store never
    // read it: metricCheckins came only from this device's AsyncStorage, so a
    // history written on another device — or before a reinstall — was
    // invisible, and the row the user wants to correct might not have been on
    // screen at all.
    const metricCheckins = supabaseService.getMetricHistory();
    persistCheckins(metricCheckins);
    // Fix #2, second half: a check-in saved on the other client collapses the
    // card here on the next refresh, instead of offering to record the week
    // twice. Only ever sets — see handledThisWeek().
    const handled = handledThisWeek(metricCheckins);
    set({
      ...supabaseService.getSquadState(),
      blockedUsers: supabaseService.getBlockedUsers(),
      metricCheckins,
      ...st,
      // Same noon-rollover rule as refreshDay(). `st` already carried
      // `yesterday` in through the spread; this is only about the mode the
      // check-in screen is left in.
      ...(st.yesterday && st.yesterday.open && !st.yesterday.sealed
        ? {}
        : { activeDay: 'today' as const }),
      // AFTER the spread, for the same reason adoptSession() does it: st.meals
      // is the whole challenge's log, and every screen that reads `meals`
      // means today.
      meals: supabaseService.getMeals(),
      ...(st.day !== s.day
        ? { deferred: [], healthPromptDismissed: {}, healthWorkoutsConsumed: [] }
        : {}),
      ...taskConfigMirror(st.tier, st.day),
      ...handled,
    });
    // refreshAll() re-read the profile rows, so a preference changed on the
    // other client lands on the next pull-to-refresh or foreground.
    get().reconcilePreferences().catch(() => {});
  },

  hydratePersisted: async () => {
    devicePrefsStarted = true;
    try {
      const [pref, checkins, notif, health, weekly, restartDismissed] =
        await Promise.all([
          AsyncStorage.getItem(UNIT_PREF_KEY),
          AsyncStorage.getItem(CHECKINS_KEY),
          AsyncStorage.getItem(NOTIF_PREFS_KEY),
          AsyncStorage.getItem(HEALTH_PREFS_KEY),
          AsyncStorage.getItem(WEEKLY_CHECKIN_KEY),
          AsyncStorage.getItem(RESTART_NOTICE_KEY),
        ]);
      const updates: Partial<AppState> = {};
      if (pref === 'metric' || pref === 'imperial') {
        updates.unitPreference = pref;
      }
      if (restartDismissed) updates.restartNoticeDismissedFor = restartDismissed;
      const storedNotif = restorePrefs(notif, DEFAULT_PREFS);
      if (storedNotif) updates.notificationPrefs = storedNotif;
      const storedHealth = restorePrefs(health, DEFAULT_HEALTH_PREFS);
      if (storedHealth) updates.healthPrefs = storedHealth;
      const storedWeekly = restoreFlag(weekly);
      if (storedWeekly !== null) updates.weeklyCheckinEnabled = storedWeekly;
      if (checkins) {
        const parsed = JSON.parse(checkins) as MetricCheckin[];
        if (Array.isArray(parsed)) {
          updates.metricCheckins = parsed;
          if (parsed[0] && localWeekKey(parsed[0].timestamp) === localWeekKey()) {
            updates.checkinHandledWeek = localWeekKey();
          }
        }
      }
      if (Object.keys(updates).length) set(updates);
      const savedMeals = await DataService.getSavedMeals();
      if (savedMeals.length) set({ savedMeals });
    } catch {
      // persisted state is a convenience; never block startup on it
    } finally {
      // Releases reconcilePreferences(), which must not seed the server from
      // half-restored state. In the `catch` path too: a preference blob that
      // would not parse is still an answer, and a reconcile that waited for
      // one that never came would leave the account unsynced for the session.
      markDevicePrefsRestored();
    }
  },

  /**
   * SETTLE THIS DEVICE'S PREFERENCES AGAINST THE ACCOUNT'S.
   *
   * Three outcomes, and the middle one is the whole reason this is not a
   * one-liner:
   *
   *   null              no server to ask (mock), or no hydrate has answered
   *                     yet, or the profile read failed. Change nothing.
   *   synced: false     the account has never saved a preference, so those
   *                     columns hold DDL defaults — 'metric', health off —
   *                     which are NOT this app's defaults. Adopting them
   *                     would flip an imperial user to metric and switch
   *                     someone's health prompts off: the same reverted-
   *                     choice failure this fix exists to prevent, pointing
   *                     the other way. Seed the server from this device.
   *   synced: true      the server is the record. Adopt it, and refresh the
   *                     device cache so the next cold launch paints it before
   *                     any network read.
   */
  reconcilePreferences: async () => {
    if (devicePrefsStarted) {
      await devicePrefsRestored;
    } else {
      // Nothing has read the device's own copy yet. Do it here rather than
      // waiting on a promise that would never resolve.
      await get().hydratePersisted();
    }
    const current = currentSyncedPreferences(get());
    const remote = DataService.getRemotePreferences(current);
    if (!remote) return;
    if (!remote.synced) {
      if (prefsSeedAttempted) return;
      prefsSeedAttempted = true;
      DataService.savePreferences(current);
      return;
    }
    set({
      unitPreference: remote.unitPreference,
      notificationPrefs: remote.notifications,
      healthPrefs: remote.health,
      weeklyCheckinEnabled: remote.weeklyCheckinEnabled,
    });
    AsyncStorage.setItem(UNIT_PREF_KEY, remote.unitPreference).catch(() => {});
    persist(NOTIF_PREFS_KEY, remote.notifications);
    persist(HEALTH_PREFS_KEY, remote.health);
    AsyncStorage.setItem(
      WEEKLY_CHECKIN_KEY,
      serializeFlag(remote.weeklyCheckinEnabled),
    ).catch(() => {});
  },

  adoptSession: ({ name }) => {
    const st = DataService.loadScenario('day1');
    // Live backend only: on the mock the service mirror holds nothing but
    // this session's entries.
    const serverCheckins = isLiveBackend ? DataService.getMetricHistory() : null;
    set({
      deferred: [],
      ...DataService.getSquadState(),
      finishFeeling: null,
      finishFeelingText: '',
      pingsUsed: { date: localDateKey(), count: 0 },
      screenState: 'ready',
      blockedUsers: DataService.getBlockedUsers(),
      profileName: name?.trim() || 'You',
      // Adopting the mock's would wipe the restored history the moment a dev
      // build signed in.
      ...(serverCheckins
        ? {
            metricCheckins: serverCheckins,
            // Fix #2: the week the check-in card is already handled for, from
            // the SERVER's history rather than only this device's. A friend
            // who checked in on the web on Monday and installed the app on
            // Tuesday was shown the entry form again, as though the week were
            // untouched.
            ...handledThisWeek(serverCheckins),
          }
        : {}),
      ...st,
      // AFTER the spread: st.meals is the whole challenge's log (the backend
      // mirror keeps it for the "recent meals" chips), and every screen that
      // reads `meals` means today.
      meals: DataService.getMeals(),
      ...taskConfigMirror(st.tier, st.day),
    });
    if (isLiveBackend) persistCheckins(get().metricCheckins);
    // Fixes #1 and #4. Deliberately not awaited: this is the sign-in path and
    // nothing on screen depends on the answer — it settles a moment later, or
    // not at all if the account has no preferences to adopt.
    get().reconcilePreferences().catch(() => {});
  },

  resetSession: () => {
    const st = DataService.loadScenario('day1');
    // The next account on this device is a different account, and it may have
    // no preferences of its own to adopt.
    prefsSeedAttempted = false;
    // Weight and mood are private data with no owner once signed out; the
    // unit preference is a display setting and stays.
    // Weight and mood are private data with no owner once signed out. The
    // preference blobs go with them: the next account on this device gets
    // the defaults, not the last person's choices.
    AsyncStorage.multiRemove([
      CHECKINS_KEY,
      NOTIF_PREFS_KEY,
      HEALTH_PREFS_KEY,
      WEEKLY_CHECKIN_KEY,
      RESTART_NOTICE_KEY,
    ]).catch(() => {});
    set({
      scenario: 'day1',
      squads: [],
      activeSquadId: null,
      restartNoticeDismissedFor: null,
      deferred: [],
      finishFeeling: null,
      finishFeelingText: '',
      profileName: 'You',
      notificationPrefs: DEFAULT_PREFS,
      blockedUsers: [],
      pingsUsed: { date: localDateKey(), count: 0 },
      screenState: 'ready',
      healthPrefs: DEFAULT_HEALTH_PREFS,
      healthReadings: EMPTY_READINGS,
      healthPromptDismissed: {},
      healthWorkoutsConsumed: [],
      metricCheckins: [],
      savedMeals: [],
      checkinHandledWeek: null,
      ...st,
      ...taskConfigMirror(st.tier, st.day),
    });
  },

  addCustomTask: (input) => {
    const s = get();
    const activeTomorrow = DataService.getCustomTasks().filter(
      (c) =>
        c.activeFromDay <= s.day + 1 &&
        (c.removedFromDay == null || c.removedFromDay > s.day + 1),
    );
    if (activeTomorrow.length >= MAX_CUSTOM_TASKS) return false;
    DataService.addCustomTask(input, s.day);
    const config = taskConfigMirror(s.tier, s.day);
    const updates: Partial<AppState> = { ...config };
    if (s.squad) {
      const item: FeedItem = {
        id: `f-local-${++feedId}`,
        kind: 'change',
        who: 'You',
        text: `added \u201C${input.name.trim()}\u201D — ${config.pendingChanges.tomorrowCount} tasks from tomorrow.`,
        timestamp: Date.now(),
      };
      updates.feed = [item, ...s.feed];
    }
    set(updates);
    return true;
  },

  updateCustomTask: (id, patch) => {
    const s = get();
    DataService.updateCustomTask(id, patch);
    set(taskConfigMirror(s.tier, s.day));
  },

  removeCustomTask: (id) => {
    const s = get();
    const target = DataService.getCustomTasks().find((c) => c.id === id);
    if (!target) return;
    const wasActive = target.activeFromDay <= s.day;
    DataService.removeCustomTask(id, s.day);
    const config = taskConfigMirror(s.tier, s.day);
    const updates: Partial<AppState> = { ...config };
    // Retracting a not-yet-active pending add is silent; removing a live
    // task is visible to the squad — accountability, not punishment.
    if (s.squad && wasActive) {
      const item: FeedItem = {
        id: `f-local-${++feedId}`,
        kind: 'change',
        who: 'You',
        text: `removed \u201C${target.name}\u201D — ${config.pendingChanges.tomorrowCount} tasks from tomorrow.`,
        timestamp: Date.now(),
      };
      updates.feed = [item, ...s.feed];
    }
    set(updates);
  },

  changeChallengeDuration: async (days) => {
    const s = get();
    if (days === s.durationDays) return { completed: false };
    const result = await DataService.setChallengeDuration(days);
    // The mirror already holds the new length; reflect it, and if the change
    // ended the run, let refreshDay() bring back whatever the server now
    // says the challenge is. Nothing here guesses at the ended state.
    set({ durationDays: days });
    if (result.completed) await get().refreshDay();
    return result;
  },

  requestTierChange: (tier) => {
    const s = get();
    DataService.changeTier(tier === s.tier ? null : tier);
    const config = taskConfigMirror(s.tier, s.day);
    const updates: Partial<AppState> = { ...config };
    if (s.squad && tier !== s.tier) {
      const item: FeedItem = {
        id: `f-local-${++feedId}`,
        kind: 'change',
        who: 'You',
        text: `changed tier to ${TIERS[tier].label} — starts tomorrow.`,
        timestamp: Date.now(),
      };
      updates.feed = [item, ...s.feed];
    }
    set(updates);
  },

  updateTaskTarget: (taskKey, value) => {
    const s = get();
    const before = s.tomorrowTasks.find((t) => t.key === taskKey);
    if (!before?.target || value === before.target.value || value < 1) return;
    DataService.updateTaskTarget(taskKey, value, s.tier);
    const config = taskConfigMirror(s.tier, s.day);
    const updates: Partial<AppState> = { ...config };
    if (s.squad) {
      const name =
        TASK_BASES[taskKey as BuiltinTaskKey]?.shortName ?? before.label;
      const raised = value > before.target.value;
      const effectiveTier = config.pendingChanges.pendingTier ?? s.tier;
      const becomesCustom =
        displayTierLabel(config.tomorrowTasks, effectiveTier) === 'Custom' &&
        displayTierLabel(s.tomorrowTasks, effectiveTier) !== 'Custom';
      const item: FeedItem = {
        id: `f-local-${++feedId}`,
        kind: 'change',
        who: 'You',
        text: `${raised ? 'raised' : 'lowered'} ${name} to ${targetText({
          value,
          unit: before.target.unit,
        })}${becomesCustom ? ' — challenge now CUSTOM' : ''}.`,
        timestamp: Date.now(),
      };
      updates.feed = [item, ...s.feed];
    }
    set(updates);
  },

  undoPendingChanges: () => {
    const s = get();
    DataService.undoPendingChanges(s.day);
    set(taskConfigMirror(s.tier, s.day));
  },

  /**
   * Simulates the local-midnight rollover: pending changes take effect,
   * the new day's task set freezes, and today's progress resets.
   */
  advanceDay: () => {
    const s = get();
    const next = DataService.rolloverDay(s.tier, s.day);
    set({
      day: next.day,
      tier: next.tier,
      tasksDone: {},
      deferred: [],
      dayComplete: false,
      missedDay: false,
      healthPromptDismissed: {},
      healthWorkoutsConsumed: [],
      ...taskConfigMirror(next.tier, next.day),
    });
  },

  deleteAccount: async () => {
    // Throws if the server refused; everything below is the success path.
    await DataService.deleteAccount();
    AsyncStorage.multiRemove([
      UNIT_PREF_KEY,
      CHECKINS_KEY,
      RESTART_NOTICE_KEY,
    ]).catch(() => {});
    const st = fromScenario('day1');
    set({
      scenario: 'day1',
      restartNoticeDismissedFor: null,
      deferred: [],
      finishFeeling: null,
      finishFeelingText: '',
      profileName: 'You',
      notificationPrefs: DEFAULT_PREFS,
      blockedUsers: [],
      pingsUsed: { date: localDateKey(), count: 0 },
      screenState: 'ready',
      healthPrefs: DEFAULT_HEALTH_PREFS,
      healthReadings: EMPTY_READINGS,
      healthPromptDismissed: {},
      healthWorkoutsConsumed: [],
      metricCheckins: [],
      savedMeals: [],
      unitPreference: localeUnitPreference(),
      checkinHandledWeek: null,
      weeklyCheckinEnabled: true,
      ...st,
      ...taskConfigMirror(st.tier, st.day),
    });
  },

  setScreenState: (screenState) => set({ screenState }),
  setFinishFeeling: (feeling) => set({ finishFeeling: feeling }),
  setFinishFeelingText: (text) => set({ finishFeelingText: text }),
  saveCompletionFeeling: () => {
    const { finishFeeling, finishFeelingText } = get();
    DataService.saveCompletionFeeling(finishFeeling, finishFeelingText);
  },
}));

/**
 * Server-decided squad state, pulled back in when it lands.
 *
 * createSquad/joinSquad return a PROVISIONAL squad — the invite code is
 * minted by create_squad(), so no local write can know it. Without this
 * subscription the store kept the placeholder for the rest of the session:
 * the Squad screen showed a code that was not a code, and Copy put it on
 * the clipboard. Subscribed once, for the life of the app; the mock has
 * nothing to reconcile and never fires.
 */
DataService.onRemoteChange(() => {
  useAppStore.setState(DataService.getSquadState());
});

/**
 * A write the server refused — put the SCREEN back, not just the mirror.
 *
 * The toast is not enough on its own. It says "Offline — that change didn't
 * save" while the task it refers to is still sitting there with a tick beside
 * it, and the two together read as a glitch rather than a fact. Undoing the
 * optimistic update is what makes the toast true.
 *
 * Subscribed once, for the life of the app. The mock never refuses anything,
 * so this never fires against it.
 */
DataService.onWriteRejected((write) => {
  // A PING THE SERVER NEVER ACCEPTED. Handled first and separately because
  // its undo is surgical, not a snapshot: the feed has almost certainly
  // moved on since the row was composed (a squadmate ticked something, a
  // reconciliation landed), and putting back the array as it was would take
  // those rows out with it. Remove the one row, and give back the ping —
  // an allowance is spent by a ping that was SENT.
  if (write.op === 'ping') {
    const s = useAppStore.getState();
    useAppStore.setState(
      undoPing({
        feed: s.feed,
        pingsUsed: s.pingsUsed,
        feedItemId: write.feedItemId,
        today: localDateKey(),
      }),
    );
    return;
  }
  // A PREFERENCE THE SERVER REFUSED. Nothing on screen goes back, on
  // purpose. The switch changed something about THIS device, it saved to
  // this device, and it is in force here — flipping it back would be its own
  // lie, and a louder one than the sync that did not happen. The service has
  // already rolled its own mirror back, so nothing claims the server holds
  // the value, and the toast has already said the change did not save.
  if (write.op === 'prefs') return;
  // The day is part of the key. Two days can be on screen at once, and a
  // rollback that put back "today" for a refused write against yesterday
  // would un-tick a task the user really had completed.
  const day =
    (write.op === 'complete' || write.op === 'uncomplete' || write.op === 'seal') &&
    write.day !== undefined
      ? write.day
      : null;
  const key =
    write.op === 'complete' || write.op === 'uncomplete'
      ? `${write.op}:${day === null ? '' : `${day}:`}${write.taskKey}`
      : `${write.op}${day === null ? '' : `:${day}`}`;
  const before = rollbacks.get(key);
  if (before) {
    rollbacks.delete(key);
    useAppStore.setState(before);
    return;
  }
  // `other` — and any write whose snapshot has already been consumed. The
  // state involved is mirrored from the service rather than composed here,
  // so re-reading it IS the rollback.
  const s = useAppStore.getState();
  useAppStore.setState({
    blockedUsers: DataService.getBlockedUsers(),
    meals: DataService.getMeals(),
    ...taskConfigMirror(s.tier, s.day),
  });
});

// ---- Derived selectors ----

/**
 * TODAY's task set — the day-start snapshot, never the live list. All
 * counts, completion checks and streak logic must read through this.
 */
export const selectTasks = (s: { todayTasks: TaskDef[] }): TaskDef[] =>
  s.todayTasks;

/** Whether the restart notice for the challenge ON SCREEN was dismissed. */
export const selectRestartNoticeDismissed = (s: {
  challengeId?: string | null;
  restartNoticeDismissedFor: string | null;
}): boolean =>
  s.restartNoticeDismissedFor !== null &&
  s.restartNoticeDismissedFor === restartNoticeKey(s.challengeId);

/**
 * The tier tag the app displays: the base tier's label, or CUSTOM when any
 * of TODAY's tier tasks runs below its standard. Derived from the snapshot,
 * so a lowered target only relabels the challenge from tomorrow.
 */
export const selectTierLabel = (s: {
  todayTasks: TaskDef[];
  tier: Tier;
}): string => displayTierLabel(s.todayTasks, s.tier);

export const selectTaskCount = (s: { todayTasks: TaskDef[] }) =>
  s.todayTasks.length;

export const selectLevel = (xp: number) => Math.floor(xp / XP.perLevel) + 1;
export const selectXpIntoLevel = (xp: number) => xp % XP.perLevel;
export const selectXpToNext = (xp: number) => XP.perLevel - (xp % XP.perLevel);

export const selectDoneCount = (s: {
  todayTasks: TaskDef[];
  tasksDone: Partial<Record<TaskKey, string>>;
}) => s.todayTasks.filter((t) => s.tasksDone[t.key]).length;

/** Pending tasks in deck order: undeferred first, deferred at the back. */
export const selectQueue = (s: {
  todayTasks: TaskDef[];
  tasksDone: Partial<Record<TaskKey, string>>;
  deferred: TaskKey[];
}): TaskKey[] => {
  const pending = s.todayTasks
    .map((t) => t.key)
    .filter((k) => !s.tasksDone[k]);
  const fresh = pending.filter((k) => !s.deferred.includes(k));
  const deferred = s.deferred.filter((k) => pending.includes(k));
  return [...fresh, ...deferred];
};

/** Pings remaining today, respecting the local-midnight reset. */
export const selectPingsLeft = (s: {
  pingsUsed: { date: string; count: number };
}) => {
  const used = s.pingsUsed.date === localDateKey() ? s.pingsUsed.count : 0;
  return Math.max(0, PINGS.maxPerDay - used);
};

/**
 * CONNECTED means "this app has asked iOS for Health access and the user
 * has left the switch on" — never "we have data" and never "we were
 * granted access", because HealthKit will not report a read grant.
 *
 * Both the Today's Health card and the Settings switch read this one
 * selector so they can never disagree about whether a connection exists.
 */
export const selectHealthConnected = (s: {
  healthAvailable: boolean;
  healthAsked: boolean;
  healthPrefs: HealthPrefs;
}): boolean =>
  s.healthAvailable && s.healthAsked && s.healthPrefs.healthEnabled;

/**
 * Match today's HealthKit workouts to incomplete workout tasks.
 * Chronological, one workout per task, qualifying = duration >= the task's
 * snapshot target. Suggestions only — the user always confirms (never
 * auto-complete), and completion goes through the existing path.
 */
export const selectWorkoutSuggestions = (s: {
  healthAvailable: boolean;
  healthAsked: boolean;
  healthPrefs: HealthPrefs;
  healthReadings: HealthReadings;
  healthWorkoutsConsumed: string[];
  todayTasks: TaskDef[];
  tasksDone: Partial<Record<TaskKey, string>>;
}): Partial<Record<TaskKey, HealthWorkout>> => {
  // CONNECTED, not merely "the pref says on". A suggestion is a claim that
  // Apple Health has a workout in it, and a device that was never asked has
  // no standing to make one.
  if (!selectHealthConnected(s) || !s.healthPrefs.workoutPromptEnabled) {
    return {};
  }
  const pendingWorkoutTasks = s.todayTasks.filter(
    (t) => t.key.startsWith('workout') && !s.tasksDone[t.key],
  );
  if (pendingWorkoutTasks.length === 0) return {};
  const out: Partial<Record<TaskKey, HealthWorkout>> = {};
  // Chronological, minus workouts already used to confirm a completion.
  // `workouts: null` means the query never ran — no suggestions from it.
  const unclaimed = (s.healthReadings.workouts ?? []).filter(
    (w) => !s.healthWorkoutsConsumed.includes(w.startISO),
  );
  for (const task of pendingWorkoutTasks) {
    const required =
      task.target?.unit === 'minutes' ? task.target.value : Infinity;
    const idx = unclaimed.findIndex((w) => w.minutes >= required);
    if (idx >= 0) {
      out[task.key] = unclaimed[idx];
      unclaimed.splice(idx, 1);
    }
  }
  return out;
};

/** Body-mass prefill: only a sample from the last 7 days qualifies. */
export const selectWeightPrefillKg = (s: {
  healthAvailable: boolean;
  healthAsked: boolean;
  healthPrefs: HealthPrefs;
  healthReadings: HealthReadings;
}): { kg: number; dateISO: string } | null => {
  if (!selectHealthConnected(s) || !s.healthPrefs.weightPrefillEnabled) {
    return null;
  }
  const sample = s.healthReadings.bodyMass;
  if (!sample) return null;
  const ageMs = Date.now() - Date.parse(sample.dateISO);
  if (ageMs > 7 * 86_400_000) return null;
  return { kg: sample.kg, dateISO: sample.dateISO };
};

export const selectRecentMeals = (meals: Meal[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of meals) {
    const key = m.text.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(m.text);
    }
  }
  return out;
};
