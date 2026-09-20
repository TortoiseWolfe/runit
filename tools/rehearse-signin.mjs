#!/usr/bin/env node
/**
 * HOST SIGN-IN, REHEARSED AGAINST THE REAL GOTRUE -- #18.
 *
 * THE ONE CLAIM NOTHING ELSE HERE CAN CHECK. `SupabaseRepository.requestEmailCode` chooses
 * between `updateUser` and `signInWithOtp`, and the wrong choice is silently destructive: a
 * host still holding the anonymous identity her seat is bound to gets a NEW `auth.uid()`,
 * and her event survives in the database reachable by nothing but its recovery key, with no
 * error raised anywhere. The unit tests (`SupabaseRepository.test.ts`) prove WHICH CALL goes
 * out -- four mutations die there. They cannot prove what GoTrue then does with it, because
 * `FakeClient` answers for GoTrue. Only a real round trip can, and a real round trip needs
 * a real inbox.
 *
 * SO IT IS TWO PHASES WITH A HUMAN (OR A MAIL TOOL) IN THE MIDDLE. `--phase=request` does
 * the half that sends a code and writes its session to `--state`; `--phase=verify --code=`
 * picks that session back up and presents the code. The session is carried in a file
 * because the two phases are two processes, minutes apart.
 *
 * NOT A GATE, AND IT MUST NEVER ENTER `run-checks.sh`. It writes to production -- an event,
 * an `auth.users` row, a real email to a real person -- which is the standing of
 * `pnpm smoke:live`, one step stronger. It refuses under CI for the same reason `--apply`
 * does.
 *
 * SEND TO A PLUS-ADDRESS, NEVER THE OWNER'S BARE ONE. `jonpohlner@gmail.com` already holds
 * a non-anonymous `auth.users` row with no host seat, from a 2026-09-10 test signup. An
 * attach against an address that is already an account falls to `sign_in` by design -- so
 * rehearsing `attach` against it would silently rehearse the OTHER branch and report
 * success. `--branch=exists` is where that case is measured deliberately.
 *
 * WHAT IT LEAVES BEHIND, said plainly: one event and one auth user per attach rehearsal.
 * `docs/smoke-live.md` has the sweep, and #19's deletion path is the route that removes
 * both through the product rather than by hand.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { envLocal } from './lib/env.mjs';

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : null;
};

const url = envLocal('EXPO_PUBLIC_SUPABASE_URL');
const key = envLocal('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
const to = arg('to');
const branch = arg('branch') ?? 'attach';
const phase = arg('phase') ?? 'request';
const code = arg('code');
const statePath = arg('state') ?? '/tmp/runit-rehearsal.json';

if (process.env.CI) {
  console.error(red('REFUSED: this writes to production and sends real mail. Not in CI.'));
  process.exit(1);
}
if (!to) {
  console.error(red('REFUSED: --to=<address> is required, and there is deliberately no default.'));
  console.error('  Use a PLUS-ADDRESS. See this file\'s header for why the bare one is a trap.');
  process.exit(1);
}
if (!url || !key) {
  console.log(yellow('SKIPPED: no EXPO_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY. Nothing measured.'));
  process.exit(0);
}
if (!['attach', 'sign_in', 'exists'].includes(branch)) {
  console.error(red(`REFUSED: --branch must be attach, sign_in or exists (got "${branch}").`));
  process.exit(1);
}

/**
 * `persistSession: false` because this process is not a phone. Writing a session into some
 * ambient store would make the second phase depend on where the first one ran, which is the
 * thing `--state` exists to make explicit.
 */
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const saveState = (s) => writeFileSync(statePath, JSON.stringify(s, null, 1));
const loadState = () => {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    console.error(red(`REFUSED: no rehearsal state at ${statePath}.`));
    console.error('  Run --phase=request first; the two phases are two processes.');
    process.exit(1);
  }
};

const fail = (why, detail) => {
  console.error(red(`FAIL: ${why}`));
  if (detail) console.error(`  ${JSON.stringify(detail).slice(0, 300)}`);
  process.exit(1);
};

/* ------------------------------------------------------------------ attach: request */

if (branch === 'attach' && phase === 'request') {
  const { data: anon, error: anonError } = await db.auth.signInAnonymously();
  if (anonError) fail('could not sign in anonymously', anonError);
  const uid = anon.user?.id;
  console.log(`anonymous identity: ${uid}`);
  if (anon.user?.is_anonymous !== true) fail('the new identity does not report is_anonymous');

  // AN EVENT FIRST, because the whole risk is about an event surviving the upgrade. A
  // rehearsal that attached an address to an identity holding NOTHING would pass on the
  // destructive branch too -- there would be nothing to orphan.
  const { data: made, error: madeError } = await db.rpc('create_event', {
    p_name: `rehearsal ${new Date().toISOString().slice(0, 16)}`,
    p_starts_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    p_timezone: 'America/New_York',
    p_venue: 'The rehearsal room',
    p_doors_label: 'Doors 7:00 PM',
    p_host_name: 'Rehearsal host',
  });
  if (madeError) fail('create_event refused', madeError);
  const event = Array.isArray(made) ? made[0] : made;
  console.log(`event: ${event.code} (${event.event_id})`);

  // The call under test. `updateUser` must KEEP this uid.
  const { error } = await db.auth.updateUser({ email: to });
  if (error) {
    fail(
      `updateUser refused -- if this is email_exists, the address is already an account and ` +
        `attach is not the branch being exercised. Use --branch=exists.`,
      error,
    );
  }

  const { data: sess } = await db.auth.getSession();
  saveState({
    branch,
    uid,
    to,
    eventCode: event.code,
    eventId: event.event_id,
    refresh_token: sess.session?.refresh_token,
    access_token: sess.session?.access_token,
  });
  console.log(green(`ok: a code was requested for ${to} on the ATTACH branch`));
  console.log(`  state: ${statePath}`);
  console.log(`  next:  --branch=attach --phase=verify --code=NNNNNN --to=${to}`);
  process.exit(0);
}

/* ------------------------------------------------------------------- attach: verify */

if (branch === 'attach' && phase === 'verify') {
  if (!code) fail('--code=NNNNNN is required for --phase=verify');
  const st = loadState();
  if (st.branch !== 'attach') fail(`the saved state is a ${st.branch} rehearsal, not an attach`);

  const { error: setError } = await db.auth.setSession({
    access_token: st.access_token,
    refresh_token: st.refresh_token,
  });
  if (setError) fail('could not restore the anonymous session', setError);

  // `email_change`, because the code was issued by `updateUser`. `email` here would refuse
  // a CORRECT code, which is the mistake the mode is carried through the screen to prevent.
  const { error } = await db.auth.verifyOtp({ email: to, token: code, type: 'email_change' });
  if (error) fail('verifyOtp refused the code', error);

  const { data: after } = await db.auth.getUser();
  console.log(`identity after the attach: ${after.user?.id}`);

  // THE ASSERTION THIS WHOLE FILE EXISTS FOR.
  if (after.user?.id !== st.uid) {
    fail(`THE UID CHANGED: ${st.uid} -> ${after.user?.id}. The event is orphaned.`);
  }
  if (after.user?.is_anonymous !== false) fail('still anonymous after attaching an address');
  if (after.user?.email !== to) fail(`the address did not attach (email is ${after.user?.email})`);

  const { data: mine, error: mineError } = await db.rpc('my_events');
  if (mineError) fail('my_events refused', mineError);
  const kept = (mine ?? []).some((e) => e.code === st.eventCode);
  if (!kept) fail(`my_events no longer lists ${st.eventCode} -- the seat did not survive`);

  console.log(green('ok: ATTACH keeps the identity, the address is on it, and the event is still hers'));
  console.log(`  uid unchanged: ${st.uid}`);
  console.log(`  my_events still lists ${st.eventCode} (${(mine ?? []).length} event(s) total)`);
  console.log(yellow(`  leaves behind: event ${st.eventCode} and one auth.users row. docs/smoke-live.md`));
  process.exit(0);
}

/* ------------------------------------------------------------------------- sign_in */

if (branch === 'sign_in' && phase === 'request') {
  const st = loadState();
  // Deliberately NO anonymous session first: this is the second phone, where there is
  // nothing local worth keeping.
  const { error } = await db.auth.signInWithOtp({ email: to, options: { shouldCreateUser: true } });
  if (error) fail('signInWithOtp refused', error);
  saveState({ ...st, branch: 'sign_in', priorUid: st.uid ?? st.priorUid });
  console.log(green(`ok: a code was requested for ${to} on the SIGN_IN branch`));
  console.log(`  next: --branch=sign_in --phase=verify --code=NNNNNN --to=${to}`);
  process.exit(0);
}

if (branch === 'sign_in' && phase === 'verify') {
  if (!code) fail('--code=NNNNNN is required for --phase=verify');
  const st = loadState();
  // `email`, because the code was issued by `signInWithOtp`.
  const { error } = await db.auth.verifyOtp({ email: to, token: code, type: 'email' });
  if (error) fail('verifyOtp refused the code', error);

  const { data: after } = await db.auth.getUser();
  if (st.priorUid && after.user?.id !== st.priorUid) {
    fail(`signing in landed on a DIFFERENT identity: ${st.priorUid} -> ${after.user?.id}`);
  }
  const { data: mine, error: mineError } = await db.rpc('my_events');
  if (mineError) fail('my_events refused', mineError);
  const kept = (mine ?? []).some((e) => e.code === st.eventCode);
  if (st.eventCode && !kept) fail(`my_events does not list ${st.eventCode} for this identity`);

  console.log(green('ok: SIGN_IN lands on the identity that already holds the seats'));
  console.log(`  uid: ${after.user?.id}`);
  if (st.eventCode) console.log(`  my_events lists ${st.eventCode}`);
  process.exit(0);
}

/* -------------------------------------------------------------------------- exists */

if (branch === 'exists') {
  // A FRESH anonymous identity, then an address that is already somebody's account. The
  // adapter keys its fallback on this exact refusal, so this measures the shape rather
  // than trusting the docs.
  const { data: anon, error: anonError } = await db.auth.signInAnonymously();
  if (anonError) fail('could not sign in anonymously', anonError);
  console.log(`throwaway anonymous identity: ${anon.user?.id}`);

  const { error } = await db.auth.updateUser({ email: to });
  if (!error) fail(`updateUser SUCCEEDED, so ${to} is not an existing account -- nothing measured`);

  const taken =
    error.code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message);
  console.log(`  code: ${JSON.stringify(error.code)}  message: ${JSON.stringify(error.message)}`);
  if (!taken) fail('the refusal is not the shape the adapter keys its fallback on', error);

  console.log(green('ok: an address that is already an account is refused as email_exists'));
  console.log('  which is what sends requestEmailCode down the sign_in branch');
  console.log(yellow('  leaves behind: one throwaway anonymous auth.users row with no seat'));
  process.exit(0);
}

fail(`nothing to do for --branch=${branch} --phase=${phase}`);
