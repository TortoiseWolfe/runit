import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useEvent, useHosts, useInvitees, useLoadMyEvents } from '@/state/hooks';
import { useHostActions } from '@/state/actions';
import { formatClock, formatEventDate, instantToWallClock } from '@/lib/format';
import { instantFrom, zoneChoices } from '@/lib/eventForm';
import { TIERS } from '@/domain/tiers';
import type { HostRole } from '@/data/types';
import { alpha, border, eyebrow, radius, useTheme, weight } from '@/theme';
import { MyEventsList } from '@/components/ui/MyEventsList';
import { Disclosure } from '@/components/ui/Disclosure';
import { ZonePicker } from '@/components/ui/ZonePicker';

/**
 * The event's own details, which nothing could edit until now.
 *
 * A screen the canvas never drew -- like the keyboard (note Q) and leaving an event
 * (note R), it is a thing a prototype for one reader never needs. Reported from a
 * phone as "who set the date and where", and the answer was: whoever ran the seed SQL,
 * once. `authenticated` held UPDATE on exactly one column of `events`.
 *
 * A DOCUMENT, NOT A SHEET. Issue #14 proposed modelling it on ReportSheet, and the
 * keyboard decision table in FIDELITY note Q rules that out: anything under /host/*
 * sits below HostConsoleChrome, so it takes `automaticallyAdjustKeyboardInsets` the
 * way BroadcastPanel does. A KeyboardAvoidingView must be OUTERMOST for its offset to
 * be zero, and one here would need a hand-measured header height that drifts the first
 * time the chrome changes.
 */

/**
 * The seats a host can hand out.
 *
 * `host` is a peer and is available on any tier with room. `dj` and `planner` are the
 * paid feature -- `hostRoles`, first granted at the event tier -- and invite_host
 * refuses them below it. DJ leads because it is the one this was asked for.
 */
const ROLE_CHOICES: { role: HostRole; label: string }[] = [
  { role: 'dj', label: 'DJ' },
  { role: 'planner', label: 'Planner' },
  { role: 'host', label: 'Co-host' },
];

export function EventDetailsPanel() {
  const { tokens, fade, depthCss } = useTheme();
  // A host who created an event and came straight here never passed the join screen, so
  // the list has to be loaded from this side too (#17).
  useLoadMyEvents();
  const event = useEvent();
  const { saveEventDetails, rotateHostKey, invite, addInvitee, removeInvitee } = useHostActions();
  const hosts = useHosts();
  const invitees = useInvitees();

  /**
   * Seeded ONCE from the event, then owned by the form.
   *
   * `useState` initialisers run on first render only, which is what makes this a draft
   * rather than a mirror. `events` is in the realtime publication, so a co-host saving
   * a change would otherwise yank the field out from under someone mid-edit.
   */
  const clock = event ? instantToWallClock(event.startsAt, event.timezone) : null;
  const [name, setName] = useState(event?.name ?? '');
  const [venue, setVenue] = useState(event?.venue ?? '');
  const [doorsLabel, setDoorsLabel] = useState(event?.doorsLabel ?? '');
  const [date, setDate] = useState(clock?.date ?? '');
  const [time, setTime] = useState(clock?.time ?? '');
  const [zone, setZone] = useState(event?.timezone ?? 'UTC');
  const [busy, setBusy] = useState(false);
  /** A freshly issued recovery key, held only long enough to be written down. */
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [coHostName, setCoHostName] = useState('');
  const [coHostRole, setCoHostRole] = useState<HostRole>('dj');
  /** The co-host key, held only long enough to be written down. */
  const [invitedKey, setInvitedKey] = useState<string | null>(null);
  const [inviteeEmail, setInviteeEmail] = useState('');

  const venueRef = useRef<TextInput>(null);
  const doorsRef = useRef<TextInput>(null);

  const zones = useMemo(() => zoneChoices(event?.timezone ?? 'UTC'), [event?.timezone]);

  /**
   * What the typed date and time actually MEAN, shown before it is saved.
   *
   * This is the whole defence against a mistyped zone, and against the disagreement
   * that shipped: HOUSE7 on the live project holds a start time of 11:13 AM under a
   * doors label reading "Doors 7:00 PM", because `starts_at` was seeded as
   * `now() + 7 days` and nothing ever rendered it. A host cannot correct what they
   * cannot see.
   *
   * `null` means the fields do not parse yet, which is the ordinary state of a date
   * halfway through being typed -- not an error worth colouring red.
   */
  const startsAt = useMemo(() => instantFrom(date, time, zone), [date, time, zone]);

  /**
   * The seat count the cap is measured against.
   *
   * `hosts.all` carries unclaimed seats too, which is right: a seat minted and not yet
   * redeemed still occupies one. Counting only claimed seats would let a host mint an
   * unbounded number of invitations and discover the cap only when people tried to use
   * them.
   */
  const tier = TIERS[event?.tier ?? 'house_party'];
  const atHostCap = hosts.length >= tier.limits.maxHosts;
  const hostCap = Number.isFinite(tier.limits.maxHosts) ? String(tier.limits.maxHosts) : null;


  const onAddInvitee = async () => {
    const addr = inviteeEmail.trim();
    if (!addr || busy) return;
    setBusy(true);
    // Clear only on success -- a rejected duplicate leaves the address in the field so
    // the host can see what they typed rather than watching it vanish.
    if (await addInvitee(addr)) setInviteeEmail('');
    setBusy(false);
  };

  const onInvite = async () => {
    if (!coHostName.trim() || busy) return;
    setBusy(true);
    try {
      const made = await invite({ displayName: coHostName, role: coHostRole });
      if (made) {
        setInvitedKey(made.hostKey);
        setCoHostName('');
      }
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (!startsAt || busy) return;
    setBusy(true);
    try {
      await saveEventDetails({ name, venue, startsAt, timezone: zone, doorsLabel });
    } finally {
      setBusy(false);
    }
  };

  const fieldStyle = [
    s.input,
    // A field is a channel machined into the panel, not a box sitting on it.
    { boxShadow: depthCss.groove },
    { borderColor: tokens.base300, backgroundColor: tokens.base200, color: tokens.baseContent },
  ];
  const label = (text: string) => (
    <Text style={[s.label, { color: alpha(tokens.baseContent, fade.muted) }]}>{text}</Text>
  );

  /*
    Same keyboard treatment as BroadcastPanel, for the same structural reason -- see
    the class docblock. keyboardShouldPersistTaps is not a nicety here either: Save
    sits in this ScrollView with six inputs above it, so under RN's 'never' default
    the first tap on it is swallowed dismissing the keyboard.
  */
  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.content}
      testID="host-event-details"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      automaticallyAdjustKeyboardInsets
    >
      <Text style={[s.sectionTitle, { color: alpha(tokens.baseContent, fade.muted) }]}>
        Event details
      </Text>

      {label('NAME')}
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="What is it called?"
        placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
        accessibilityLabel="Event name"
        testID="event-name"
        returnKeyType="next"
        // Declared rather than inherited: RN's default for a single-line input that
        // wires onSubmitEditing is to blur, which would drop the keyboard between
        // every field on a six-field form.
        submitBehavior="submit"
        onSubmitEditing={() => venueRef.current?.focus()}
        style={fieldStyle}
      />

      <View style={s.row}>
        <View style={s.half}>
          {label('DATE')}
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="2026-09-11"
            placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
            accessibilityLabel="Date, as year, month and day"
            testID="event-date"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
            style={fieldStyle}
          />
        </View>
        <View style={s.half}>
          {label('TIME')}
          <TextInput
            value={time}
            onChangeText={setTime}
            placeholder="19:00"
            placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
            accessibilityLabel="Start time, on a 24 hour clock"
            testID="event-time"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
            style={fieldStyle}
          />
        </View>
      </View>

      {/* The interpretation, not a second copy of the input. Reading back what the
          three fields COMBINE to is what catches a zone nobody meant to pick -- so the
          zone control sits ON this line rather than in a row of its own below it. */}
      <ZonePicker
        reading={
          <Text testID="event-starts-preview" style={[s.reading, { color: alpha(tokens.baseContent, fade.body) }]}>
            {startsAt
              ? `${formatEventDate(startsAt, zone)} · ${formatClock(startsAt, zone)}`
              : 'Date and time read as 2026-09-11 and 19:00.'}
          </Text>
        }
        value={zone}
        onChange={setZone}
        choices={zones}
        testIDPrefix="event-zone"
      />

      {label('VENUE')}
      <TextInput
        ref={venueRef}
        value={venue}
        onChangeText={setVenue}
        placeholder="Where is it?"
        placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
        accessibilityLabel="Venue"
        testID="event-venue"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => doorsRef.current?.focus()}
        style={fieldStyle}
      />

      {label('DOORS')}
      <TextInput
        ref={doorsRef}
        value={doorsLabel}
        onChangeText={setDoorsLabel}
        placeholder="Doors 7:00 PM"
        placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
        accessibilityLabel="Doors line, shown on the invitation"
        testID="event-doors"
        returnKeyType="done"
        // The last field, so this one SHOULD close the keyboard -- and it submits the
        // form, which is why it is spelled out rather than left to the default.
        submitBehavior="blurAndSubmit"
        onSubmitEditing={onSave}
        style={fieldStyle}
      />
      <Text style={[s.helper, { color: alpha(tokens.baseContent, fade.muted) }]}>
        The invitation reads name, then date, then this line, then the venue.
      </Text>

      {/* WHO IS HELPING -- issue #16. Until this, `hosts.invite` threw against Supabase
          and had no UI caller anywhere, so a host could not add a DJ at any price while
          the $79 tier advertised "5 hosts with roles" as a headline.

          A co-host gets a KEY, not an account. They type it on the join screen and
          claim_host binds the seat to whatever anonymous session they are holding --
          which is the point: the DJ and the floor staff should not need accounts.

          The caps are enforced in Postgres, in invite_host, reading `tier_limits`. The
          gate here is advisory: it changes the label so a host is not surprised, and the
          repository still refuses if this view is stale. */}
      {event ? (
        <View style={s.keyBlock}>
          <Text style={[s.sectionTitle, { color: alpha(tokens.baseContent, fade.muted) }]}>
            Who is helping
          </Text>

          {hosts.map((h) => (
            <View key={h.id} testID="seat-row" style={s.seatRow}>
              <Text style={[s.seatName, { color: tokens.baseContent }]}>{h.displayName}</Text>
              <Text style={[s.seatRole, { color: alpha(tokens.baseContent, fade.muted) }]}>
                {h.roleLabel}
              </Text>
            </View>
          ))}

          {invitedKey ? (
            <>
              <Text testID="invited-key" style={[s.key, { color: tokens.baseContent }]}>
                {invitedKey}
              </Text>
              <Text style={[s.helper, { color: alpha(tokens.baseContent, fade.body) }]}>
                Give them this key and the event code. They type both on the join screen —
                no account needed. It is not shown again.
              </Text>
            </>
          ) : null}

          {/* The seats above are the answer to "who is helping"; this is the machinery
              for adding one, and a host adds a co-host once. `invitedKey` stays OUTSIDE
              the fold deliberately -- it is shown exactly once and never again, so a
              collapsed section is not somewhere it may ever be. */}
          <Disclosure
            title="Add someone"
            summary={atHostCap ? `${hostCap} hosts on this plan` : 'DJ, planner or co-host'}
            testID="cohost-add"
          >
          <TextInput
              value={coHostName}
              onChangeText={setCoHostName}
              placeholder="Their name"
              placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
              accessibilityLabel="Name of the person helping"
              testID="cohost-name"
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={onInvite}
              style={fieldStyle}
            />

            <View style={s.pillRow}>
              {ROLE_CHOICES.map((r) => {
                const on = r.role === coHostRole;
                return (
                  <Pressable
                    key={r.role}
                    onPress={() => setCoHostRole(r.role)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Role ${r.label}`}
                    testID={`cohost-role-${r.role}`}
                    style={[
                      s.pill,
                      { borderColor: tokens.base300, backgroundColor: on ? tokens.primary : 'transparent' },
                    ]}
                  >
                    <Text style={[s.pillText, { color: on ? tokens.primaryContent : tokens.baseContent }]}>
                      {r.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* NEVER disabled at the cap, the same rule as "+ New folder": a control that is
                visibly there and does nothing when tapped reads as a bug, and disabling it
                makes the denial unreachable. The repository throws and the toast names the
                limit. It once WAS disabled elsewhere and looked exactly like a broken button. */}
            <Pressable
              onPress={onInvite}
              accessibilityRole="button"
              accessibilityHint={atHostCap ? `This plan includes ${hostCap} hosts.` : undefined}
              testID="cohost-invite"
              style={[s.rotate, { borderColor: tokens.base300 }]}
            >
              <Text
                style={[
                  s.rotateText,
                  { color: atHostCap ? alpha(tokens.baseContent, fade.faint) : tokens.baseContent },
                ]}
              >
                {atHostCap ? `${hostCap} hosts on this plan` : 'Add a co-host'}
              </Text>
            </Pressable>
          </Disclosure>
        </View>
      ) : null}

      {/*
        THE GUEST LIST (#25). Here rather than as a sixth console segment, because
        HostConsoleChrome already says `/host/event` is "where event-level settings will
        keep accumulating: tier, invitees, co-hosts" -- and because a block inside a screen
        the shot walk already visits inherits the contrast and gutter gates for free.

        THIS IS THE FIRST PERSONAL DATA IN THE APP BEYOND A CHOSEN NICKNAME, and it is
        somebody else's. NOTHING HERE SENDS ANYTHING: there is no send control, and
        `invited_at` is written by no code path in the product. Whether Runit emails people
        who have not heard of it is a product and legal decision, and adding a name to a
        list one host can read is not that decision.
      */}
      {event ? (
        <Disclosure
          title="Who is invited"
          summary={invitees.length === 0 ? 'Nobody yet' : `${invitees.length} invited`}
          testID="invitees"
        >

          {invitees.length === 0 ? (
            <Text style={[s.helper, { color: alpha(tokens.baseContent, fade.body) }]}>
              Nobody yet. This is the list your announcements are addressed to — it is not
              who has turned up.
            </Text>
          ) : null}

          {invitees.map((i) => (
            <View key={i.id} testID="invitee-row" style={s.seatRow}>
              <Text style={[s.seatName, { color: tokens.baseContent }]}>
                {i.displayName ?? i.email}
              </Text>
              {/* A per-row control, so this one gets its own id -- unlike the row wrapper,
                  which is static so a count assertion cannot be fooled by a text match.
                  hitSlop because the label is ~13pt, under SC 2.5.8's 24x24 AA floor. */}
              <Pressable
                onPress={() => void removeInvitee(i.id)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${i.displayName ?? i.email} from the guest list`}
                testID={`invitee-remove-${i.id}`}
                hitSlop={12}
              >
                <Text style={[s.seatRole, { color: alpha(tokens.baseContent, fade.muted) }]}>
                  Remove
                </Text>
              </Pressable>
            </View>
          ))}

          <TextInput
            value={inviteeEmail}
            onChangeText={setInviteeEmail}
            placeholder="name@example.com"
            placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
            testID="invitee-email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={onAddInvitee}
            style={[
              s.input,
              { borderColor: tokens.base300, color: tokens.baseContent, backgroundColor: tokens.base100 },
            ]}
          />

          <Pressable
            onPress={onAddInvitee}
            accessibilityRole="button"
            testID="invitee-add"
            style={[s.rotate, { borderColor: tokens.base300 }]}
          >
            <Text style={[s.rotateText, { color: tokens.baseContent }]}>Add to the list</Text>
          </Pressable>
        </Disclosure>
      ) : null}

      {/*
        GETTING BACK IN (#32), AND WHY THIS SECTION DOES NOT FOLD.

        A host's seat is bound to an anonymous auth session living in a keystore that a
        reinstall wipes. The recovery key is the only thing that binds it to a new one --
        `claim_host` rebinds `hosts.auth_user_id` to whoever presents it.

        `rotate_host_key` issues a replacement and RETIRES the old one, so a key written
        down on Tuesday stops working the moment a new one is minted. Both the freshly
        rotated key here and the co-host key above are shown EXACTLY ONCE and stored only
        as a bcrypt hash -- which is why neither sits inside a Disclosure. A one-time
        string behind a closed fold is a string destroyed.
      */}
      {event ? (
        <View style={s.keyBlock}>
          <Text style={[s.sectionTitle, { color: alpha(tokens.baseContent, fade.muted) }]}>
            Getting back in
          </Text>
          {issuedKey ? (
            <>
              <Text testID="rotated-key" style={[s.key, { color: tokens.baseContent }]}>
                {issuedKey}
              </Text>
              <Text style={[s.helper, { color: alpha(tokens.baseContent, fade.body) }]}>
                Write it down now — it is not shown again, and the previous key has
                stopped working.
              </Text>
            </>
          ) : (
            <Text style={[s.helper, { color: alpha(tokens.baseContent, fade.muted) }]}>
              Your key is how you reach this event from another phone. If you have lost
              it, issue a new one — the old one stops working.
            </Text>
          )}
          <Pressable
            onPress={async () => {
              const next = await rotateHostKey();
              if (next) setIssuedKey(next);
            }}
            accessibilityRole="button"
            testID="rotate-key"
            style={[s.rotate, { borderColor: tokens.base300 }]}
          >
            <Text style={[s.rotateText, { color: tokens.baseContent }]}>
              {issuedKey ? 'Issue another' : 'Issue a new key'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Not drawn while there is no event to edit, the same rule as the calendar pill
          and the invite row: a control that cannot act is not drawn. `?empty=1` asserts
          that nothing visible anywhere is aria-disabled. */}
      {event ? (
        <Pressable
          onPress={onSave}
          accessibilityRole="button"
          testID="event-save"
          style={[s.save, { backgroundColor: tokens.primary }]}
        >
          <Text style={[s.saveText, { color: tokens.primaryContent }]}>
            {busy ? 'Saving…' : 'Save details'}
          </Text>
        </Pressable>
      ) : null}
      {/* SWITCHING, on the panel that already owns "which event is this" (#17). A host
          standing in one party reaches her others from here; the join screen is where a
          host standing in NONE of them reaches all of them. Same rows, same tap.

          Below the details and the key rather than above: this panel's job is the event
          you are in, and a list of the others should not be the first thing on it. */}
      <Disclosure
        title="Your events"
        // The event you are STANDING IN, which the console header never says out loud --
        // it reads "Host" and nothing else. A host running two parties otherwise has no
        // indication which console she is looking at, and Broadcast is one tap away.
        summary={event?.name ?? 'None open'}
        testID="event-switcher"
      >
        {/* `heading` is the empty string because `Disclosure` already printed it, and
            `hideCurrent` stays FALSE: on this panel the list is the map of where you
            are, so the current row is marked "Here" rather than filtered out. That is
            the opposite of the join screen and it is deliberate on both sides. */}
        <MyEventsList heading="" />
      </Disclosure>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingVertical: 16, paddingHorizontal: 20, gap: 10 },
  sectionTitle: { ...eyebrow.section, fontSize: 12, marginBottom: 4 },
  label: { fontSize: 11, letterSpacing: 0.6, marginTop: 6 },
  input: {
    height: 48, borderRadius: radius.field, borderWidth: border,
    paddingHorizontal: 14, fontSize: 16,
  },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  reading: { fontSize: 13 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // 32 tall, over SC 2.5.8's 24 AA minimum, and the 8pt gap keeps neighbours from
  // needing slop that RN would not honour between flush siblings anyway.
  pill: {
    height: 32, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: border,
    alignItems: 'center', justifyContent: 'center',
  },
  pillText: { fontSize: 13 },
  helper: { fontSize: 12, lineHeight: 18 },
  keyBlock: { marginTop: 18, gap: 8 },
  seatRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  seatName: { fontSize: 15 },
  seatRole: { fontSize: 13 },
  // Tabular so the three groups line up, and large because it gets copied by hand.
  key: { fontSize: 22, fontWeight: weight.semibold, letterSpacing: 2, fontVariant: ['tabular-nums'] },
  rotate: {
    height: 44, borderRadius: radius.field, borderWidth: border,
    alignItems: 'center', justifyContent: 'center',
  },
  rotateText: { fontSize: 14, fontWeight: weight.medium },
  save: { height: 52, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  saveText: { fontSize: 16, fontWeight: weight.semibold },
});
