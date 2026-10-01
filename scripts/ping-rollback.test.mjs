/**
 * Proofs for THE PING THE SERVER NEVER ACCEPTED (Phase 17A part 2, fix #3).
 *
 * sendPing() puts "pinged Sam" in your own feed the instant the button is
 * tapped and fires the RPC. Its rollback was `() => {}`. So an offline send,
 * a send past the daily quota, and a send to someone who had left the squad
 * all left that row on screen for good — the toast saying it had not saved,
 * the feed saying it had. This is the one rule the project does not break.
 *
 * The undo cannot be a snapshot restore like every other write here, because
 * the feed moves underneath it. These assert the properties a surgical undo
 * has to hold, including the two that are easy to get wrong: a refusal that
 * arrives after local midnight, and the same refusal arriving twice.
 *
 *   node --experimental-strip-types scripts/ping-rollback.test.mjs
 */
import assert from 'node:assert/strict';

import { undoPing } from '../src/lib/pingRollback.ts';

const TODAY = '2026-09-04';

let passes = 0;
function ok(label) {
  passes += 1;
  console.log(`PASS: ${label}`);
}

/** A feed as it looks a moment after two pings were sent. */
const feed = () => [
  { id: 'f-local-2', kind: 'ping-out', text: 'pinged Sam' },
  { id: 'f-local-1', kind: 'ping-out', text: 'pinged Alex' },
  { id: 'server-9', kind: 'task', text: 'Alex finished a workout' },
];

// ---- the bug this exists for ---------------------------------------------
{
  const out = undoPing({
    feed: feed(),
    pingsUsed: { date: TODAY, count: 2 },
    feedItemId: 'f-local-2',
    today: TODAY,
  });
  assert.ok(
    !out.feed.some((item) => item.id === 'f-local-2'),
    'the refused ping is still in the feed',
  );
  ok('a refused ping leaves no row claiming it was sent');
}

{
  // The reason it cannot be "put the feed back as it was": everything else in
  // the list has to survive, including rows that arrived AFTER the send.
  const later = [{ id: 'server-10', kind: 'task', text: 'Sam sealed day 12' }, ...feed()];
  const out = undoPing({
    feed: later,
    pingsUsed: { date: TODAY, count: 1 },
    feedItemId: 'f-local-1',
    today: TODAY,
  });
  assert.deepEqual(
    out.feed.map((item) => item.id),
    ['server-10', 'f-local-2', 'server-9'],
  );
  ok('every other row survives, in order — including ones that landed after');
}

// ---- the allowance -------------------------------------------------------
{
  const out = undoPing({
    feed: feed(),
    pingsUsed: { date: TODAY, count: 2 },
    feedItemId: 'f-local-2',
    today: TODAY,
  });
  assert.deepEqual(out.pingsUsed, { date: TODAY, count: 1 });
  ok('the allowance is given back — a ping is spent by being sent');
}

{
  // Two sends, both refused. Each finds its own row and refunds once.
  const first = undoPing({
    feed: feed(),
    pingsUsed: { date: TODAY, count: 2 },
    feedItemId: 'f-local-2',
    today: TODAY,
  });
  const second = undoPing({ ...first, feedItemId: 'f-local-1', today: TODAY });
  assert.deepEqual(
    second.feed.map((item) => item.id),
    ['server-9'],
  );
  assert.deepEqual(second.pingsUsed, { date: TODAY, count: 0 });
  ok('two refusals unwind independently, to the right count');
}

{
  // The same refusal seen twice (a retry, a duplicated listener). The row is
  // already gone, so nothing is refunded — otherwise it is a free ping.
  const once = undoPing({
    feed: feed(),
    pingsUsed: { date: TODAY, count: 3 },
    feedItemId: 'f-local-2',
    today: TODAY,
  });
  const twice = undoPing({ ...once, feedItemId: 'f-local-2', today: TODAY });
  assert.deepEqual(twice.pingsUsed, { date: TODAY, count: 2 });
  assert.deepEqual(twice.feed, once.feed);
  ok('unwinding the same ping twice refunds once — no free ping');
}

{
  // Sent at 23:59, refused at 00:00. The count now belongs to a new day and
  // decrementing it would hand out a fourth ping tomorrow.
  const out = undoPing({
    feed: feed(),
    pingsUsed: { date: '2026-09-05', count: 0 },
    feedItemId: 'f-local-2',
    today: '2026-09-05',
  });
  assert.deepEqual(out.pingsUsed, { date: '2026-09-05', count: 0 });
  assert.ok(!out.feed.some((item) => item.id === 'f-local-2'));
  ok('a refusal after midnight removes the row without touching a fresh count');
}

{
  // Never below zero, whatever the client's count had drifted to.
  const out = undoPing({
    feed: feed(),
    pingsUsed: { date: TODAY, count: 0 },
    feedItemId: 'f-local-1',
    today: TODAY,
  });
  assert.deepEqual(out.pingsUsed, { date: TODAY, count: 0 });
  ok('the count never goes negative');
}

{
  // A row that was never there (a reconciliation replaced the feed first).
  // Nothing to remove, and nothing to refund against.
  const before = feed();
  const out = undoPing({
    feed: before,
    pingsUsed: { date: TODAY, count: 1 },
    feedItemId: 'f-local-99',
    today: TODAY,
  });
  assert.equal(out.feed, before, 'the array should not even be rebuilt');
  assert.deepEqual(out.pingsUsed, { date: TODAY, count: 1 });
  ok('an unknown row changes nothing at all');
}

console.log(`\nAll ${passes} ping-rollback checks passed.`);
