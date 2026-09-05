import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useEvent } from '@/state/hooks';
import { useHostActions } from '@/state/actions';
import {
  formatClock,
  formatEventDate,
  instantToWallClock,
  wallClockToInstant,
} from '@/lib/format';
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
 * Zones a host can pick from, plus wherever this phone thinks it is.
 *
 * NOT `Intl.supportedValuesOf('timeZone')`. It would be the complete answer and its
 * Hermes support is unverified here -- and this repo's own history is that "works on
 * web, wrong on device" is the recurring failure. A short list plus the device's own
 * zone covers the host who is standing at their own venue, which is nearly all of
 * them, and it degrades to a visible list rather than an empty picker.
 *
 * A host whose venue is somewhere else entirely is a real gap, and the honest place to
 * close it is a searchable list, not a longer constant.
 */
const COMMON_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'UTC',
];

function zoneChoices(current: string): string[] {
  let device = 'UTC';
  try {
    device = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // A resolvedOptions() that throws is not a reason to render no picker at all.
  }
  // `current` first so the event's own zone is always offered, even if it is neither
  // common nor this phone's -- otherwise editing the venue would silently move the
  // event to whichever zone happened to be listed first.
  return [...new Set([current, device, ...COMMON_ZONES])];
}

/** 'America/New_York' -> 'New York'. The prefix is noise on a button this size. */
const zoneLabel = (z: string) => z.split('/').pop()?.replace(/_/g, ' ') ?? z;

export function EventDetailsPanel() {
  const { tokens, fade } = useTheme();
  const event = useEvent();
  const { saveEventDetails } = useHostActions();

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
  const startsAt = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
    try {
      return wallClockToInstant(date, time, zone);
    } catch {
      return null;
    }
  }, [date, time, zone]);

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
  save: { height: 52, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  saveText: { fontSize: 16, fontWeight: weight.semibold },
});
