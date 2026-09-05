import { useMemo, useRef, useState } from 'react';
import {
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/ui/Screen';
import { Toast } from '@/components/ui/Toast';
import { useCreateActions } from '@/state/actions';
import { formatClock, formatEventDate } from '@/lib/format';
import { instantFrom, zoneChoices, zoneLabel } from '@/lib/eventForm';
import { alpha, border, eyebrow, radius, useTheme, weight } from '@/theme';
import type { CreatedEvent } from '@/data/repository';

/**
 * Making your own event -- issue #13, and the supply side that did not exist.
 *
 * Every event, host seat, folder and key in existence came from someone running
 * `seed-events.sql` with the database password. A host could OPERATE an event somebody
 * else conjured; she could not have one. Asked plainly: "where is the hostess supposed
 * to get a key to her own party."
 *
 * SHE NEEDS NO KEY. `create_event` binds her seat to `auth.uid()` in the same
 * transaction that makes the event, so she is the host because she made it. The key this
 * screen shows afterwards solves a different problem -- see the panel below.
 *
 * Not under `/host`, deliberately: `host/_layout` redirects anyone who is not already a
 * host, which is everyone who needs this screen.
 */
export function CreateEventScreen() {
  const { tokens, fade } = useTheme();
  const router = useRouter();
  const { createEvent } = useCreateActions();

  const [hostName, setHostName] = useState('');
  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [doorsLabel, setDoorsLabel] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('19:00');
  const [zone, setZone] = useState(() => zoneChoices('UTC')[0]!);
  const [busy, setBusy] = useState(false);
  /** Set once, and it holds the only copy of the key that will ever exist. */
  const [made, setMade] = useState<CreatedEvent | null>(null);

  const nameRef = useRef<TextInput>(null);
  const venueRef = useRef<TextInput>(null);
  const doorsRef = useRef<TextInput>(null);

  const zones = useMemo(() => zoneChoices(zone), [zone]);
  const startsAt = useMemo(() => instantFrom(date, time, zone), [date, time, zone]);
  const ready = name.trim().length > 0 && startsAt !== null && !busy;

  const onCreate = async () => {
    if (!ready || !startsAt) return;
    setBusy(true);
    try {
      const result = await createEvent({
        name, venue, startsAt, timezone: zone, doorsLabel, hostName,
      });
      if (result) setMade(result);
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
   * THE KEY, HANDED OVER ONCE.
   *
   * It replaces the form rather than arriving as a toast or a modal, because a toast is
   * gone in four seconds and a modal is dismissed by a stray tap on the backdrop -- and
   * this string exists nowhere else, ever. Only its bcrypt hash is stored. There is no
   * support route, no service-role dump and no backup that recovers it.
   *
   * It is not how she gets in. She is already the host. It is how she gets BACK in from
   * a different phone, which matters because her identity here is an anonymous session
   * in a keystore, and an Android reinstall wipes it.
   */
  if (made) {
    return (
      <Screen top="page" bottom="page">
        {/* keyboardShouldPersistTaps here too, and it matters MORE than on the form.
            The keyboard can still be up when this panel replaces it -- tapping Create
            from a focused field leaves it raised -- and under RN's 'never' default the
            first tap on "I have written it down" would be swallowed dismissing it. A
            host who reads that as a broken button and navigates away has lost the only
            copy of her key. Caught by pnpm audit:keyboard, not by looking at it. */}
        <ScrollView
          contentContainerStyle={s.content}
          testID="create-done"
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[s.eyebrow, { color: alpha(tokens.baseContent, fade.muted) }]}>
            Your event is live
          </Text>
          <Text style={[s.title, { color: tokens.baseContent }]}>{name.trim()}</Text>

          {label('GUESTS JOIN WITH')}
          <Text testID="created-code" style={[s.code, { color: tokens.baseContent }]}>
            {made.code}
          </Text>

          {label('YOUR KEY BACK IN')}
          <Text testID="created-key" style={[s.code, { color: tokens.baseContent }]}>
            {made.hostKey}
          </Text>
          <Text style={[s.helper, { color: alpha(tokens.baseContent, fade.body) }]}>
            Write this down. It is the only way back into this event on another phone, and
            it is not shown again — we keep a one-way hash of it, so nobody can look it up
            for you. You do not need it on this phone.
          </Text>

          <Pressable
            onPress={() => router.replace('/host/broadcast')}
            accessibilityRole="button"
            testID="created-continue"
            style={[s.cta, { backgroundColor: tokens.primary }]}
          >
            <Text style={[s.ctaText, { color: tokens.primaryContent }]}>
              I have written it down
            </Text>
          </Pressable>
        </ScrollView>
        <Toast />
      </Screen>
    );
  }

  return (
    <Screen top="page" bottom="page">
      {/*
        A plain scrolling document, so it insets itself rather than wrapping a
        KeyboardAvoidingView -- FIDELITY note Q's table. keyboardShouldPersistTaps is not
        a nicety here: Create sits in this ScrollView below six fields, so under RN's
        'never' default the first tap on it is swallowed dismissing the keyboard.
      */}
      <ScrollView
        contentContainerStyle={s.content}
        testID="create-event"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        <Text style={[s.eyebrow, { color: alpha(tokens.baseContent, fade.muted) }]}>
          You are running
        </Text>
        <Text style={[s.title, { color: tokens.baseContent }]}>A new event</Text>

        {label('YOUR NAME')}
        <TextInput
          value={hostName}
          onChangeText={setHostName}
          placeholder="Shown on your announcements"
          placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
          accessibilityLabel="Your name, as the host"
          testID="create-host-name"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => nameRef.current?.focus()}
          style={fieldStyle}
        />

        {label('EVENT NAME')}
        <TextInput
          ref={nameRef}
          value={name}
          onChangeText={setName}
          placeholder="Ruth's 40th"
          placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
          accessibilityLabel="Event name"
          testID="create-name"
          returnKeyType="next"
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
              testID="create-date"
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
              testID="create-time"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              autoCorrect={false}
              style={fieldStyle}
            />
          </View>
        </View>

        {/* What the fields MEAN, before anything is created. The defence against a zone
            nobody meant to pick, and against the disagreement that shipped: HOUSE7 held
            an 11:13 AM start under a "Doors 7:00 PM" label because nothing rendered it. */}
        <Text
          testID="create-starts-preview"
          style={[s.reading, { color: alpha(tokens.baseContent, fade.body) }]}
        >
          {startsAt
            ? `${formatEventDate(startsAt, zone)} · ${formatClock(startsAt, zone)}`
            : 'Add a date as 2026-09-11 and a time as 19:00.'}
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
                testID={`create-zone-${z}`}
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
          placeholder="The garden"
          placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
          accessibilityLabel="Venue"
          testID="create-venue"
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
          testID="create-doors"
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={onCreate}
          style={fieldStyle}
        />

        {/* Not drawn until it can act, the same rule as the calendar pill and the invite
            row. A greyed Create with no explanation reads as broken software -- three
            device reports' worth of evidence for that. `?empty=1` holds the general
            form: nothing visible anywhere may be aria-disabled. */}
        {ready ? (
          <Pressable
            onPress={onCreate}
            accessibilityRole="button"
            testID="create-submit"
            style={[s.cta, { backgroundColor: tokens.primary }]}
          >
            <Text style={[s.ctaText, { color: tokens.primaryContent }]}>
              {busy ? 'Creating…' : 'Create it'}
            </Text>
          </Pressable>
        ) : (
          <Text testID="create-blocked" style={[s.helper, { color: alpha(tokens.baseContent, fade.muted) }]}>
            A name and a date are all it needs.
          </Text>
        )}

        {/* Said plainly rather than discovered at the tenth guest. There is no purchase
            path (#30), so every new event runs on the free plan, and implying otherwise
            would be advertising something nobody can buy. */}
        <Text style={[s.helper, { color: alpha(tokens.baseContent, fade.muted) }]}>
          New events run on House party — up to 10 guests, one folder, no photo approvals.
        </Text>
      </ScrollView>
      <Toast />
    </Screen>
  );
}

const s = StyleSheet.create({
  content: { paddingVertical: 16, gap: 10 },
  eyebrow: { ...eyebrow.section, fontSize: 12 },
  title: { fontSize: 30, fontWeight: weight.semibold, marginBottom: 6 },
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
  // Tabular so the groups line up, and large because it gets read aloud across a room.
  code: { fontSize: 26, fontWeight: weight.semibold, letterSpacing: 2, fontVariant: ['tabular-nums'] },
  helper: { fontSize: 12, lineHeight: 18 },
  cta: { height: 52, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  ctaText: { fontSize: 16, fontWeight: weight.semibold },
});
