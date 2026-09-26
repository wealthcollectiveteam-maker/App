/**
 * UNDOING A PING THE SERVER NEVER ACCEPTED (Phase 17A part 2, fix #3).
 *
 * Sending a ping puts a row in your own feed — "pinged Sam — 'get up'" —
 * before the network has said anything, because that row is the entire
 * feedback the button has. The send is a fire-and-forget RPC, and its
 * rollback was `() => {}`. Offline, out of quota, or aimed at someone who had
 * left the squad, the row stayed: the toast said the change had not saved and
 * the feed said it had, and the feed is what people believe. The one rule
 * this project does not break is that the UI never claims something happened
 * that did not happen.
 *
 * WHY THIS IS A FUNCTION AND NOT THREE LINES IN THE LISTENER. The undo cannot
 * be "put the feed back as it was", which is how every other optimistic write
 * in the store rolls back. Between composing the row and the server refusing
 * it, the feed has very likely changed — a squadmate ticked a task, a
 * reconciliation replaced the list — and restoring a snapshot would take
 * those rows out too. It has to be surgical, and a surgical undo has edge
 * cases (a row already gone, a day that has rolled over, two refusals at
 * once) that are worth proving rather than reading.
 *
 * Kept free of react-native imports so scripts/ping-rollback.test.mjs can run
 * it in plain Node — the same reason checkinCard.ts exists.
 */

/** Only the fields the undo touches; the real FeedItem carries more. */
export interface PingRollbackInput<T extends { id: string }> {
  feed: T[];
  /** Pings spent on `date` (a local calendar day key). */
  pingsUsed: { date: string; count: number };
  /** The optimistic row the refused send belongs to. */
  feedItemId: string;
  /** Today's local date key, passed in so this stays pure. */
  today: string;
}

export interface PingRollbackResult<T> {
  feed: T[];
  pingsUsed: { date: string; count: number };
}

/**
 * Remove the refused ping's row and give the allowance back.
 *
 * The allowance is returned because a ping is spent by being SENT — charging
 * someone one of three daily pings for a request the server rejected is a
 * second, quieter version of the same lie. The server keeps its own count and
 * remains the authority; this only unwinds the client's courtesy pre-check.
 *
 * The count is only touched when `pingsUsed` is still keyed to TODAY. A
 * refusal that arrives after local midnight belongs to a day that is over,
 * and decrementing the new day's fresh count would hand out a fourth ping.
 */
export function undoPing<T extends { id: string }>(
  input: PingRollbackInput<T>,
): PingRollbackResult<T> {
  const { feed, pingsUsed, feedItemId, today } = input;
  const present = feed.some((item) => item.id === feedItemId);
  return {
    feed: present ? feed.filter((item) => item.id !== feedItemId) : feed,
    // Idempotent: a row that is already gone has already been unwound, and
    // refunding twice would be worth a free ping. Two DIFFERENT refusals each
    // find their own row and each refund once.
    pingsUsed:
      present && pingsUsed.date === today
        ? { date: today, count: Math.max(0, pingsUsed.count - 1) }
        : pingsUsed,
  };
}
