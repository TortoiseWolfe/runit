# Push notifications — what is built, and the two things only you can do

`#27`. The whole path exists and is proven as far as anything here can prove it. What is
left is **two credentials and two secrets**, all four behind an interactive login that an
agent cannot complete.

## What already works

| Piece | Where | Proven by |
|---|---|---|
| A guest's device token, stored against their own seat | `set_push_token` (SECURITY DEFINER) | Lane E |
| No client can read any token, their own included | `guests` has no SELECT policy | Lane E |
| Announcements + run-of-show cues fan out | `broadcasts_fan_out_push` trigger | Lane E |
| "Your song is coming up" | `song_requests_fan_out_push` trigger (on UPDATE) | Lane E |
| Paid tiers only | `tier_limits.push_notifications`, read by the trigger | Lane E + `audit:tiers` |
| The send itself | `supabase/functions/send-push` Edge Function | deployed, ACTIVE |
| Permission + token on device | `src/lib/push.ts` | jest |
| The web harness does not hang | `src/lib/push.web.ts` | Lane B, 208 journeys |

**Until the secrets below exist the fan-out returns early and sends nothing.** That is
deliberate, and no insert ever fails because of it — Lane E asserts an announcement lands
on both a free and a paid tier with the secrets absent.

## 1. Two Supabase secrets (5 minutes, no Apple/Google needed)

The trigger reads these from Vault. Without them it returns early.

```sql
select vault.create_secret(
  'https://qwusbxallkbzfladvgfx.supabase.co/functions/v1/send-push',
  'push_fanout_url'
);
select vault.create_secret('<the project SERVICE ROLE key>', 'push_fanout_key');
```

The service role key is in the Supabase dashboard under **Project Settings → API**. It must
never enter `.env`, `eas.json`, or the app bundle — it goes in Vault and nowhere else.

## 2. The Apple push key (iOS) — needs your Apple ID and 2FA

```bash
eas credentials --platform ios
#   → production → Push Notifications: Manage your Apple Push Notifications Key
#   → Set up a new key
```

- It logs into Apple with your Apple ID and a **two-factor code sent to a trusted device**.
  That step is the wall; nothing here can drive it.
- The key is an **APNs Auth Key** (`.p8`), account-wide across team `Y774K5FF67`,
  downloadable exactly once, and Apple caps you at two active keys.
- EAS may already hold credentials for this app from the earlier TestFlight builds — check
  before setting up a new key.

## 3. The Firebase key (Android) — needs a Google login

1. Firebase console → create or reuse a project → add an Android app with package
   `com.turtlewolfe.runit`.
2. Download `google-services.json` into the repo root.
3. Project Settings → **Service Accounts** → generate a private key.
4. `eas credentials --platform android` → upload that JSON as the FCM V1 key.

`google-services.json` is a build input, so it must be committed or supplied as an EAS
secret. It is **not** currently in `.gitignore` — decide deliberately which.

## 4. Then build and actually look at a phone

```bash
eas build --profile preview --platform ios      # or android
```

**A simulator cannot receive remote push.** Install on a real device, join an event on a
paid tier, and have a host send an announcement.

## What no lane in this repo can tell you

- **That a notification arrived.** Lane B has no push API and boots the in-memory adapter;
  Lane C could witness an Android notification only once step 3 is done; there is no Mac,
  so iOS is unprovable here at all.
- **That the APNs key is right.** A wrong Key ID produces "no notification arrived", which
  is indistinguishable from "nobody sent one".
- **That a push left the database.** `pg_net` is fire-and-forget — the outcome lands in
  `net._http_response`, outside the transaction. A failure is silent.

To see what actually happened after a send:

```sql
select id, status_code, content, created from net._http_response order by created desc limit 5;
```

and the Edge Function logs in the Supabase dashboard, which print
`fan-out: event <id> -> N/M accepted by Expo`.
