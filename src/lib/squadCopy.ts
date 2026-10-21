/**
 * THREE THINGS THE SQUAD SAW THAT WEREN'T TRUE (Phase 38S, S3), each said
 * in one place so every screen says it the same way.
 *
 * 1. "STILL FINISHING DAY 34 · 0/0 · UNTIL NOON". get_squad_status() returns
 *    grace_tasks = 0 when the open day has no challenge_days row — nobody
 *    froze it, because the member never opened the app that day (0011,
 *    `coalesce(... jsonb_array_length(cd.task_snapshot), 0)`). Zero is "the
 *    server does not know", not "a day with no tasks". The line keeps the
 *    fact that is known — which day, and that it is open until noon — and
 *    drops the count it cannot honestly give. The root cause is SQL and is
 *    left there (see docs/testflight.md, "Reported, not fixed").
 *
 * 2. "SQUAD STARTS TODAY" on a squad 35 days in. The squad streak is the
 *    shortest member flame; one member at 0 makes it 0, and 0 was always
 *    rendered as "starts today". That is true only for a squad whose members
 *    are all on their first day.
 *
 * 3. "AL" on You, "AM" on Squad, "YO" on the leaderboard. Three formulas for
 *    one person: the first two letters of the name, the first letter of
 *    each of the first two words, and the first two letters of the label
 *    "You". There is now one: initialsOf(), the per-word one the roster has
 *    always used.
 *
 * Kept free of react-native imports so scripts/squad-copy.test.mjs runs it
 * in plain Node.
 */

/** "Sam Rivera" -> "SR"; a one-word name gives its first two letters, "Maya" -> "MA". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'YO';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** The roster's grace line, or null when there is none to show. */
export function graceLine(m: {
  graceDay: number | null;
  graceDone: number;
  graceTasks: number;
}): string | null {
  if (m.graceDay === null) return null;
  // 0 tasks is the server not knowing the day's size (no snapshot row).
  if (m.graceTasks <= 0) return `Still finishing Day ${m.graceDay} · until noon`;
  return `Still finishing Day ${m.graceDay} · ${Math.min(m.graceDone, m.graceTasks)}/${m.graceTasks} · until noon`;
}

/**
 * The squad-streak label. `short` is the Home strip's ("12-day"); the long
 * form is the Squad tab's ("12-day squad streak").
 */
export function squadStreakLabel(
  streak: number,
  members: readonly { day: number }[],
  short = false,
): string {
  if (streak > 0) return short ? `${streak}-day` : `${streak}-day squad streak`;
  const allNew = members.length > 0 && members.every((m) => m.day <= 1);
  if (allNew) return short ? 'Starts today' : 'Squad starts today';
  return short ? 'No streak' : 'No squad streak running';
}
