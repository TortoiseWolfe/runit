/**
 * THE PUSH FAN-OUT (#27).
 *
 * Called by the `broadcasts_fan_out_push` trigger through pg_net, never by a client.
 * It reads guest push tokens with the service role -- no client may read a token, their
 * own included, because a token is a routable address for a person's device -- and hands
 * them to Expo's push service.
 *
 * WHY NOT CALL THIS FROM THE APP. A client-invoked send is a second authority on who may
 * address the room: it would have to hold a service key and re-implement `is_host` outside
 * the schema, and a caller could insert a broadcast and simply never call it. The trigger
 * fires on a row RLS has already admitted, so authorisation is settled before the request
 * exists.
 *
 * WHAT THIS CANNOT TELL YOU. pg_net is fire-and-forget: the trigger does not wait, and the
 * outcome lands in `net._http_response` outside the transaction. A failed push is SILENT.
 * That is the shape `assertWrote()` exists to make loud elsewhere in this codebase, and
 * there is no equivalent here -- so this function logs loudly and nothing downstream may
 * claim delivery. Only a phone proves delivery.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Expo's documented cap. More than this must be chunked or the whole batch is rejected. */
const CHUNK = 100;

type Payload = {
  event_id?: string;
  title?: string;
  body?: string;
  kind?: string;
  /** Present only for a message aimed at ONE person, e.g. "your song is next". */
  guest_id?: string;
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'body is not JSON' }), { status: 400 });
  }

  const { event_id, title, body, kind, guest_id } = payload;
  if (!event_id || !body) {
    return new Response(JSON.stringify({ error: 'event_id and body are required' }), { status: 400 });
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    // SERVICE ROLE, and this is the only place in the product that uses it. It is the one
    // identity that can read `guests` at all -- the table has no SELECT policy for anyone.
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  /**
   * AUTHORISED AGAINST VAULT, NOT AGAINST THE GATEWAY -- #51.
   *
   * `verify_jwt` proves only that the caller holds *a* project JWT, and the anon key is
   * PUBLIC: it is compiled into the app bundle. This endpoint reads every guest's push
   * token with the service role and posts to Expo, so without a second factor it is a
   * notification blaster -- anyone with that public key could POST an event id and a body
   * and buzz every phone at somebody else's party.
   *
   * It went unnoticed because the fan-out was never armed: `fan_out_push` returned early
   * for want of its Vault secrets, so nothing had ever called this. Adding the secrets
   * without adding this check would have been the regression, not the fix.
   *
   * IT FAILS CLOSED. Absent secret and wrong secret answer identically, so a prober cannot
   * learn whether the endpoint is armed -- the same rule the sweep follows, for the same
   * reason.
   */
  const presented = req.headers.get('x-push-key');
  const { data: authorised, error: authError } = await db.rpc('push_authorised', {
    p_key: presented,
  });
  if (authError) {
    console.error('push: could not check authorisation', authError);
    return new Response(JSON.stringify({ error: 'authorisation check failed' }), { status: 500 });
  }
  if (authorised !== true) {
    console.error('push: refused -- bad key, or no push_key in Vault');
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  let q = db.from('guests').select('id, push_token').eq('event_id', event_id).not('push_token', 'is', null);
  // A song cue is addressed to one person; an announcement is addressed to the room.
  if (guest_id) q = q.eq('id', guest_id);

  const { data, error } = await q;
  if (error) {
    console.error('fan-out: could not read tokens', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const tokens = (data ?? []).map((r) => r.push_token as string).filter(Boolean);
  if (tokens.length === 0) {
    // NOT AN ERROR. A room where nobody has granted the permission is the ordinary state,
    // and it must not read as a failure in the logs or somebody will chase it.
    console.log(`fan-out: event ${event_id} has no registered devices; nothing to send`);
    return new Response(JSON.stringify({ sent: 0, reason: 'no registered devices' }), { status: 200 });
  }

  const messages = tokens.map((to) => ({
    to,
    sound: 'default',
    title: title ?? 'Runit',
    body,
    // The app reads this on tap to decide where to land. `kind` distinguishes a host
    // announcement from a run-of-show cue, which the trigger already knows and the
    // client would otherwise have to guess.
    data: { eventId: event_id, kind: kind ?? 'announcement' },
  }));

  let sent = 0;
  const failures: unknown[] = [];

  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    try {
      const res = await fetch(EXPO_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          ...(Deno.env.get('EXPO_ACCESS_TOKEN')
            ? { Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` }
            : {}),
        },
        body: JSON.stringify(chunk),
      });
      const out = await res.json();
      if (!res.ok) {
        console.error('fan-out: Expo rejected a chunk', res.status, out);
        failures.push(out);
        continue;
      }
      // Expo answers per-message. A DeviceNotRegistered ticket means the app was
      // uninstalled: the token is dead and should be cleared rather than retried forever.
      const dead: string[] = [];
      (out?.data ?? []).forEach((ticket: { status?: string; details?: { error?: string } }, n: number) => {
        if (ticket?.status === 'error') {
          failures.push(ticket);
          if (ticket?.details?.error === 'DeviceNotRegistered') dead.push(chunk[n]!.to);
        } else {
          sent += 1;
        }
      });
      if (dead.length) {
        await db.from('guests').update({ push_token: null }).in('push_token', dead);
        console.log(`fan-out: cleared ${dead.length} dead token(s)`);
      }
    } catch (e) {
      console.error('fan-out: chunk threw', e);
      failures.push(String(e));
    }
  }

  console.log(`fan-out: event ${event_id} -> ${sent}/${tokens.length} accepted by Expo`);
  return new Response(JSON.stringify({ sent, of: tokens.length, failures }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
