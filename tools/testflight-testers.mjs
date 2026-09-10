#!/usr/bin/env node
/**
 * WHO CAN ACTUALLY INSTALL THIS APP ON AN IPHONE, AND WHAT IS EACH PERSON WAITING ON.
 *
 *   node tools/testflight-testers.mjs                       # the board: everyone, and their next step
 *   node tools/testflight-testers.mjs invite a@b.com Ada L   # step 2 -- send the ASC invitation
 *   node tools/testflight-testers.mjs add    a@b.com Ada L   # step 4 -- put them in the beta group
 *
 * WHY THIS EXISTS. Getting a private iOS app onto somebody else's iPhone is FOUR steps, and
 * step 4 had no tooling at all -- which is how a real tester ended up parked in the wrong
 * group, believed to be set up, for days:
 *
 *   1. collect their Apple ID email                      (a text message; not automatable)
 *   2. POST /v1/userInvitations                          `invite`, below
 *   3. THEY open Apple's email and accept                CANNOT be forced, and is the slow one
 *   4. POST /v1/betaTesters into the internal group      `add`, below -- the step nobody had
 *
 * STEP 3 IS THE WHOLE SCHEDULE. Nothing you run here shortens it. Apple's email asks a
 * private person to join a DEVELOPER TEAM -- it does not look like a party invitation, and
 * the honest expectation is that some people never click it. Plan around that rather than
 * around the API.
 *
 * AN INVITATION IS NOT AN INSTALL, and the difference is the trap. `userInvitations` says
 * somebody was asked. `users` says they accepted. Membership of the INTERNAL beta group is
 * the only one of the three that means a build reaches their phone. A person can sit in the
 * first two forever and TestFlight will show them nothing.
 *
 * INTERNAL, NOT EXTERNAL, AND THAT IS NOT A PREFERENCE. An external group cannot receive
 * any build until Apple's Beta App Review approves one -- a human review with no guaranteed
 * turnaround. Internal testers must be App Store Connect TEAM USERS (cap 100), which is why
 * step 2 exists at all and why there is no tester-only role to give them. `MARKETING` is the
 * least-privileged role Apple permits, scoped to this app.
 *
 * IT FAILS LOUDLY, deliberately. A sibling script in this family printed `TESTERS: 0` by
 * swallowing a 403 -- the one tool for answering "who can install" fabricated its headline
 * number out of an error, which is worse than having no tool. Every call here checks its
 * status and a non-OK response is a non-zero exit with Apple's own message.
 *
 * Credentials: the ASC API key at ~/.appstoreconnect/private_keys/. Read-only for the
 * default board; `invite` and `add` write.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const KID = 'W92D4L6F5B';
const ISS = '0d47c4c8-5733-414f-a707-df2282d960a8';
const APP = '6808766120';

/**
 * The INTERNAL group. Hard-coded rather than looked up by name: "The Best Team Ever" is a
 * name somebody can rename in the dashboard, and this script sending people to a group that
 * merely sounds right is the exact failure it exists to prevent. The id is stable.
 */
const INTERNAL_GROUP = '394cedfb-cd61-4641-a015-43fb57d7e9b1';

const KEY_PATH = `${process.env.HOME}/.appstoreconnect/private_keys/AuthKey_${KID}.p8`;

let key;
try {
  key = readFileSync(KEY_PATH);
} catch {
  console.error(`\x1b[31mno App Store Connect key at ${KEY_PATH}\x1b[0m`);
  console.error('That key is the only credential here. Nothing below can run without it.');
  process.exit(1);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const iat = Math.floor(Date.now() / 1000);
const head = b64({ alg: 'ES256', kid: KID, typ: 'JWT' });
const claim = b64({ iss: ISS, iat, exp: iat + 900, aud: 'appstoreconnect-v1' });
const signer = createSign('SHA256');
signer.update(`${head}.${claim}`);
signer.end();
const JWT = `${head}.${claim}.${signer.sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;

const API = 'https://api.appstoreconnect.apple.com';

/** Every call checks. A swallowed error here becomes a wrong answer to "who can install". */
async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${JWT}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`\x1b[31m${method} ${path} -> ${res.status}\x1b[0m`);
    try {
      for (const e of JSON.parse(text).errors ?? []) console.error(`  ${e.title} -- ${e.detail}`);
    } catch {
      console.error(`  ${text.slice(0, 400)}`);
    }
    process.exit(1);
  }
  return text ? JSON.parse(text) : {};
}

const lower = (s) => String(s ?? '').trim().toLowerCase();

async function board() {
  const invitations = await call('GET', '/v1/userInvitations?limit=100&fields[userInvitations]=email,firstName,lastName,expirationDate');
  const users = await call('GET', '/v1/users?limit=100&fields[users]=username,firstName,lastName,roles');
  const members = await call('GET', `/v1/betaGroups/${INTERNAL_GROUP}/betaTesters?limit=200&fields[betaTesters]=email,firstName,lastName,state`);
  const builds = await call('GET', `/v1/builds?filter[app]=${APP}&limit=1&sort=-uploadedDate&fields[builds]=version,processingState,expired,uploadedDate`);

  const invited = new Set((invitations.data ?? []).map((i) => lower(i.attributes.email)));
  const accepted = new Set((users.data ?? []).map((u) => lower(u.attributes.username)));
  const inGroup = new Map((members.data ?? []).map((m) => [lower(m.attributes.email), m.attributes.state]));

  const build = builds.data?.[0]?.attributes;
  console.log(
    build
      ? `Current build: ${build.version} · ${build.processingState}${build.expired ? ' · EXPIRED' : ''} · uploaded ${String(build.uploadedDate).slice(0, 10)}`
      : 'Current build: NONE',
  );
  console.log('');

  const everyone = new Set([...invited, ...accepted, ...inGroup.keys()]);
  if (everyone.size === 0) {
    console.log('Nobody is in any stage. Nobody but you can install this app.');
    return;
  }

  let ready = 0;
  const rows = [];
  for (const email of [...everyone].sort()) {
    const state = inGroup.get(email);
    // THE ORDER IS THE POINT: the furthest-along fact wins, because being in the group is
    // the only one that means a build reaches a phone. Being invited and being accepted are
    // both compatible with having no app at all.
    let stage;
    let next;
    if (state === 'INSTALLED') {
      stage = 'INSTALLED';
      next = 'nothing — they have it';
      ready += 1;
    } else if (state) {
      stage = `IN GROUP (${state})`;
      next = 'open TestFlight and install; confirm the build number';
      ready += 1;
    } else if (accepted.has(email)) {
      stage = 'ACCEPTED';
      next = `RUN: node tools/testflight-testers.mjs add ${email} <First> <Last>`;
    } else if (invited.has(email)) {
      stage = 'INVITED';
      next = 'WAITING ON THEM to accept Apple’s email — cannot be forced';
    } else {
      stage = 'UNKNOWN';
      next = 'not in any stage';
    }
    rows.push({ email, stage, next });
  }

  const w = Math.max(...rows.map((r) => r.email.length));
  for (const r of rows) console.log(`  ${r.email.padEnd(w)}  ${r.stage.padEnd(18)}  ${r.next}`);

  console.log('');
  console.log(
    ready > 0
      ? `\x1b[32m${ready} device(s) can install.\x1b[0m`
      : '\x1b[31mNo device can install. Being invited or accepted is not enough — step 4 is what delivers a build.\x1b[0m',
  );
  const stuck = rows.filter((r) => r.stage === 'INVITED').length;
  if (stuck) console.log(`\x1b[33m${stuck} waiting on a person to click Apple's email. That step has no API.\x1b[0m`);
}

async function invite(email, firstName, lastName) {
  const out = await call('POST', '/v1/userInvitations', {
    data: {
      type: 'userInvitations',
      attributes: {
        email,
        firstName,
        lastName,
        roles: ['MARKETING'],
        allAppsVisible: false,
        provisioningAllowed: false,
      },
      relationships: { visibleApps: { data: [{ type: 'apps', id: APP }] } },
    },
  });
  const a = out.data.attributes;
  console.log(`invited ${a.email} · expires ${a.expirationDate}`);
  console.log('THEY must now open Apple’s email and accept. Then run `add` with the same name.');
}

/** STEP 4 -- the one that had no tooling, and the reason a tester sat in the wrong group. */
async function add(email, firstName, lastName) {
  const out = await call('POST', '/v1/betaTesters', {
    data: {
      type: 'betaTesters',
      attributes: { email, firstName, lastName },
      relationships: { betaGroups: { data: [{ type: 'betaGroups', id: INTERNAL_GROUP }] } },
    },
  });
  console.log(`added ${out.data.attributes.email} to the internal group · state ${out.data.attributes.state}`);
  console.log('They install the TestFlight app; RunIt appears inside it. Re-run with no arguments to confirm.');
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd) {
  await board();
} else if (cmd === 'invite' || cmd === 'add') {
  const [email, firstName, lastName] = rest;
  if (!email || !firstName || !lastName) {
    console.error(`usage: node tools/testflight-testers.mjs ${cmd} <email> <First> <Last>`);
    process.exit(1);
  }
  await (cmd === 'invite' ? invite(email, firstName, lastName) : add(email, firstName, lastName));
} else {
  console.error('usage: node tools/testflight-testers.mjs [invite|add] ...');
  process.exit(1);
}
