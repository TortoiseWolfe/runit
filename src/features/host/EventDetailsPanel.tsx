import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useEvent, useHosts } from '@/state/hooks';
import { useHostActions } from '@/state/actions';
import { formatClock, formatEventDate, instantToWallClock } from '@/lib/format';
import { instantFrom, zoneChoices, zoneLabel } from '@/lib/eventForm';
import { TIERS } from '@/domain/tiers';
import type { HostRole } from '@/data/types';
import { alpha, border, eyebrow, radius, useTheme, weight } from '@/theme';

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
  const { tokens, fade } = useTheme();
  const event = useEvent();
  const { saveEventDetails, rotateHostKey, invite } = useHostActions();
  const hosts = useHosts();

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
          three fields COMBINE to is what catches a zone nobody meant to pick. */}
      <Text testID="event-starts-preview" style={[s.reading, { color: alpha(tokens.baseContent, fade.body) }]}>
        {startsAt
          ? `${formatEventDate(startsAt, zone)} · ${formatClock(startsAt, zone)}`
          : 'Date and time read as 2026-09-11 and 19:00.'}
      </Text>

      {label('TIME ZONE')}
      <View style={s.zoneRow}>
        {zones.map((z) => {
          const on = z === zone;
          return (
            <Pressable
              key={z}
              onPress={() => setZone(z)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Time zone ${zoneLabel(z)}`}
              testID={`event-zone-${z}`}
              style={[
                s.zone,
                { borderColor: tokens.base300, backgroundColor: on ? tokens.primary : 'transparent' },
              ]}
            >
              <Text style={[s.zoneText, { color: on ? tokens.primaryContent : tokens.baseContent }]}>
                {zoneLabel(z)}
              </Text>
            </Pressable>
          );
        })}
      </View>

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

          <View style={s.zoneRow}>
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
                    s.zone,
                    { borderColor: tokens.base300, backgroundColor: on ? tokens.primary : 'transparent' },
                  ]}
                >
                  <Text style={[s.zoneText, { color: on ? tokens.primaryContent : tokens.baseContent }]}>
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
        </View>
      ) : null}

      {/* THE RECOVERY KEY, for the note that got lost or was shown to the wrong person.
          Issue #32.

          She did not need a key to get in -- create_event bound her seat to auth.uid()
          -- and she does not need one on this phone. It exists because that identity is
          an anonymous session in a keystore, and an Android reinstall wipes it. Without
          a key she loses her own event permanently while it carries on without her.

          Rotating RETIRES the old one, which is the half that makes rotation mean
          anything, and verify-policies.sql asserts exactly that. */}
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
  reading: { fontSize: 13, marginTop: 4 },
  zoneRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // 32 tall, over SC 2.5.8's 24 AA minimum, and the 8pt gap keeps neighbours from
  // needing slop that RN would not honour between flush siblings anyway.
  zone: {
    height: 32, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: border,
    alignItems: 'center', justifyContent: 'center',
  },
  zoneText: { fontSize: 13 },
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
