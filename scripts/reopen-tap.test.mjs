/**
 * THE TAP, MEASURED (Phase 38R, R3a).
 *
 * On 2026-10-13 the owner's setup screen offered "Reopen Days 43 to 50"
 * (my_reopen_offer, kind 'catchup') and the tap sent restore_missed_day —
 * 0019's single-day RPC — which the server refused, correctly, because
 * nothing was alive. scripts/catch-up.test.mjs had passed: it proved what
 * the OFFER said and that the source CONTAINED a catch-up call, never that
 * the store action the button calls sends it. The tenth green suite over a
 * live defect.
 *
 * This file drives the REAL store action — useAppStore.restoreMissedDay(),
 * the thing RestoreBlock's onPress awaits — through the real contract, the
 * real SupabaseDataService and the real api.ts, on top of a Supabase client
 * that records every RPC (scripts/app-loader-hooks.mjs). The state is the
 * owner's: the offer put into the app store by completeSignIn() with nothing
 * hydrated, exactly as the setup screen has it.
 *
 * FAIL-FIRST: against 16af6e7 the range offer sends restore_missed_day.
 *
 *   npm run test:reopen-tap
 */
import assert from 'node:assert/strict';

let failures = 0;
let passes = 0;
async function check(label, fn) {
  try {
    await fn();
    passes += 1;
    console.log(`PASS: ${label}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL: ${label}`);
    console.log(`      ${String(e && e.message ? e.message : e).split('\n')[0]}`);
  }
}

// Dynamic, so the loader registered by --import is in force.
const { useAppStore } = await import('../src/store/useAppStore.ts');
const calls = globalThis.__rpcCalls;
const REOPEN_RPCS = ['catch_up_missed_days', 'restore_missed_day'];
const sentReopens = () => calls.filter((c) => REOPEN_RPCS.includes(c.name));

// The owner's row on 2026-10-13, as completeSignIn() placed it in the store.
const range = {
  challengeId: '7729ffa2', day: 43, lastDay: 50,
  missedOn: '2026-10-05', lastOn: '2026-10-12', restoreBy: '2026-10-19', daysLeft: 6,
  kind: 'catchup',
};
// 0019's shape: a direct restart alive, one day to reopen.
const single = {
  challengeId: '573dabe6', day: 37, lastDay: 37,
  missedOn: '2026-09-29', lastOn: '2026-09-29', restoreBy: '2026-10-13', daysLeft: 13,
  kind: 'single',
};

await check('a RANGE offer: the tap sends catch_up_missed_days, with no arguments', async () => {
  calls.length = 0;
  useAppStore.setState({ restorable: range });
  await useAppStore.getState().restoreMissedDay();
  const sent = sentReopens();
  assert.equal(sent.length, 1, `expected one reopen RPC, saw ${sent.map((c) => c.name).join(', ') || 'none'}`);
  assert.equal(sent[0].name, 'catch_up_missed_days', `the tap sent ${sent[0].name}`);
  assert.ok(sent[0].args === undefined || Object.keys(sent[0].args).length === 0, `unexpected arguments ${JSON.stringify(sent[0].args)}`);
  assert.equal(useAppStore.getState().restorable, null, 'the offer stayed on screen after the tap');
});

await check('a SINGLE-DAY offer: the tap still sends restore_missed_day', async () => {
  calls.length = 0;
  useAppStore.setState({ restorable: single });
  await useAppStore.getState().restoreMissedDay();
  const sent = sentReopens();
  assert.equal(sent.length, 1, `expected one reopen RPC, saw ${sent.map((c) => c.name).join(', ') || 'none'}`);
  assert.equal(sent[0].name, 'restore_missed_day', `the tap sent ${sent[0].name}`);
});

await check('the offer\'s kind alone decides: a range offer with the service never hydrated', async () => {
  // The setup-screen case in full: nothing hydrated, nothing alive, the
  // offer only in the app store. (The first check already ran this way;
  // this one says so in words and pins the one-day catch-up too.)
  calls.length = 0;
  useAppStore.setState({ restorable: { ...range, lastDay: 43, lastOn: '2026-10-05', daysLeft: 13 } });
  await useAppStore.getState().restoreMissedDay();
  assert.equal(sentReopens()[0]?.name, 'catch_up_missed_days', `the tap sent ${sentReopens()[0]?.name}`);
});

await check('no offer: the tap sends nothing it could not name', async () => {
  calls.length = 0;
  useAppStore.setState({ restorable: null });
  await useAppStore.getState().restoreMissedDay().catch(() => {});
  assert.notEqual(sentReopens()[0]?.name, 'catch_up_missed_days', 'a catch-up was sent with no offer');
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
