/**
 * DELETING AN ACCOUNT -- #19.
 *
 * MANDATORY, NOT A FEATURE. App Store Guideline 5.1.1(v): an app that lets a person create
 * an account must let them delete it IN THE APP. #18 shipped host sign-in, so this became
 * required on the same day.
 *
 * WHY IT CANNOT BE AN RPC, which is the whole reason this file exists rather than a function
 * beside `my_deletion_impact`. Two walls, and either one alone would be enough:
 * `auth.users` is not writable by `authenticated`; and deleting a `storage.objects` row does
 * not delete the BYTES, while `storage.protect_delete()` refuses every direct SQL delete on
 * that table -- for the project owner as much as for a guest, which lane E asserts. Bytes
 * come out through the Storage API with a service role, and an Edge Function is the one
 * place that key already lives.
 *
 * THE CALLER'S OWN JWT IS THE CREDENTIAL, and this is the one difference from `sweep-photos`
 * that matters. That endpoint is called by cron on everybody's behalf, so it needs a Vault
 * secret nobody outside the database holds. This one acts on EXACTLY ONE identity -- the one
 * presenting the token -- so the token is the authorisation and there is nothing a second
 * secret would add. `auth.getUser()` against the presented JWT is what pins it: the uid is
 * read from the token, never from the body, so there is no request shape that deletes
 * somebody else.
 *
 * AN ANONYMOUS CALLER IS ALLOWED, deliberately. A host who created an event and never signed
 * in is still a person with an account in every sense that matters here -- a seat, an
 * identity in `auth.users`, guests' photographs -- and refusing her would make the deletion
 * right conditional on having first taken the sign-in step. It is also what lets lane H
 * clean up after itself through the shipping path rather than by hand.
 *
 * BYTES FIRST, ROW SECOND, IDEMPOTENT -- `init.sql` has carried that rule since the first
 * migration, the retention sweep still got it wrong once and stranded 980 bytes, and the
 * order matters MORE here: `event_photos_delete` requires the EVENT to still exist
 * (`is_host(foldername(name)[1])`), and `hosts` cascades from `events`. Delete the event
 * first and `is_host()` goes false forever, so nothing but a service role can ever reach
 * those objects again -- which is to say, this function is the only thing that could, and it
 * would have just thrown away the name it needed.
 *
 * BY PREFIX, NOT BY ROW. The sweep removes `[storage_path, thumb_path]` per photo row, which
 * is right for expiry -- it deletes what expired. Here the goal is that NOTHING of the event
 * remains, and an upload that landed in storage without its row yet (a transfer interrupted
 * between the two writes) has no row to be found by. `storage.list(<event_id>/)` finds it.
 *
 * BOUNDED AND RESUMABLE, because a cascade is one non-resumable statement and an event with
 * 2,000 photographs is not one request. It returns `{ done: false }` until there is nothing
 * left, and the client calls again -- so an interrupted deletion resumes rather than leaving
 * an account half gone with no way to finish it.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const BUCKET = 'event-photos';

/** Objects removed per invocation. The same reasoning as the sweep's ceiling. */
const DEFAULT_LIMIT = 200;

type Payload = { dry_run?: boolean; limit?: number };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL') ?? '';

  /**
   * WHO IS ASKING, decided by the token and never by the body. A client built from the
   * caller's own header resolves `auth.getUser()` to exactly the identity that presented it.
   */
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: who, error: whoError } = await asCaller.auth.getUser();
  const uid = who?.user?.id;
  if (whoError || !uid) {
    // 401 rather than 403: nothing is wrong with the request, there is simply nobody making
    // it. The gateway's `verify_jwt` proves a project JWT was presented; this proves a USER.
    return json({ error: 'no identity on this request' }, 401);
  }

  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  let payload: Payload = {};
  try {
    payload = await req.json();
  } catch {
    // An empty body is a normal invocation and the defaults are the safe ones.
  }
  const dry = payload.dry_run === true;
  const limit = Math.max(1, Math.min(payload.limit ?? DEFAULT_LIMIT, 1000));

  // WHICH EVENTS DIE is decided in SQL, beside the tables it reads, and is the same answer
  // `my_deletion_impact()` showed the person before they confirmed. A second opinion here
  // would be a second definition of "hers", and the two would drift.
  const { data: dying, error: dyingError } = await db.rpc('sole_host_events', { p_user: uid });
  if (dyingError) {
    console.error('delete-account: could not read which events die', dyingError);
    return json({ error: 'could not read the account' }, 500);
  }
  const events = (dying ?? []) as string[];

  if (dry) {
    let objects = 0;
    for (const event of events) {
      const { data: listed } = await db.storage.from(BUCKET).list(event, { limit: 1000 });
      objects += (listed ?? []).length;
    }
    return json({ dry: true, uid, events: events.length, objects, done: false });
  }

  let removed = 0;
  let budget = limit;

  for (const event of events) {
    // Files first, and only as many as the budget allows -- the event row stays until its
    // bucket prefix is empty, so a run that stops here resumes on the next call.
    while (budget > 0) {
      const { data: listed, error: listError } = await db.storage
        .from(BUCKET)
        .list(event, { limit: Math.min(budget, 100) });
      if (listError) {
        console.error(`delete-account: could not list ${event}`, listError);
        return json({ error: 'could not list the album', done: false }, 500);
      }
      const names = (listed ?? []).map((o) => `${event}/${o.name}`);
      if (names.length === 0) break;

      const { error: rmError } = await db.storage.from(BUCKET).remove(names);
      if (rmError) {
        // AND THE EVENT STAYS. Deleting it now would strand exactly these objects: `hosts`
        // cascades, `is_host()` goes false, and no policy can ever admit anyone to that
        // prefix again.
        console.error(`delete-account: could not remove bytes for ${event}`, rmError);
        return json({ error: 'could not remove the photographs', done: false }, 500);
      }
      removed += names.length;
      budget -= names.length;
    }

    if (budget <= 0) {
      return json({ done: false, uid, removed, remaining: events.length, reason: 'budget' });
    }

    // ROW SECOND, and the cascade takes the folders, hosts, guests, broadcasts, schedule,
    // song requests, votes, invitees, reports and photo rows with it.
    const { error: eventError } = await db.from('events').delete().eq('id', event);
    if (eventError) {
      console.error(`delete-account: could not delete event ${event}`, eventError);
      return json({ error: 'could not delete the event', done: false }, 500);
    }
  }

  /**
   * HER SEATS ON EVENTS THAT SURVIVE. `hosts.auth_user_id` is `on delete set null`, so
   * removing the user alone would leave her row behind as an unclaimed seat -- and
   * `host_claims` keeps its bcrypt hash, so that seat would remain claimable by whoever
   * holds the printed key. Deleting the row is what actually gives the seat up.
   */
  const { error: seatsError } = await db.from('hosts').delete().eq('auth_user_id', uid);
  if (seatsError) {
    console.error('delete-account: could not release the remaining seats', seatsError);
    return json({ error: 'could not release the seats', done: false }, 500);
  }

  /**
   * THE IDENTITY LAST, because everything above needed it to name her. This cascades her
   * `guests` rows (and their votes) and her `guest_lists`.
   *
   * WHAT IT DELIBERATELY DOES NOT TOUCH: photographs she uploaded at OTHER people's events.
   * `photos.uploaded_by_guest_id` is `on delete set null` and `uploaded_by_name` is
   * denormalised, so those stay in somebody else's album under her name. That is third-party
   * content in the other direction -- another host's event, other guests' memories -- and
   * the confirmation sheet says so out loud rather than letting her discover it.
   */
  const { error: userError } = await db.auth.admin.deleteUser(uid);
  if (userError) {
    console.error('delete-account: could not delete the auth user', userError);
    return json({ error: 'could not delete the account', done: false }, 500);
  }

  console.log(`delete-account: ${uid} gone -- ${events.length} event(s), ${removed} object(s)`);
  return json({ done: true, uid, events: events.length, removed });
});
