import { useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { DateTimeField } from '@/components/ui/DateTimeField';
import { ZonePicker } from '@/components/ui/ZonePicker';
import { Toast } from '@/components/ui/Toast';
import { useCreateActions } from '@/state/actions';
import { formatClock, formatEventDate } from '@/lib/format';
import { deviceZone, instantFrom, zoneChoices } from '@/lib/eventForm';
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
  const { tokens, fade, depthCss } = useTheme();
  const router = useRouter();
  const { createEvent, copy } = useCreateActions();

  const [hostName, setHostName] = useState('');
  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [doorsLabel, setDoorsLabel] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('19:00');
  // THIS PHONE'S zone, not `zoneChoices('UTC')[0]` -- that is the literal 'UTC', because
  // `zoneChoices` puts `current` first on purpose. Seeding from it stored every new
  // event as UTC and showed a 6pm party as 10:00 PM.
  const [zone, setZone] = useState(deviceZone);
  const [busy, setBusy] = useState(false);
  /** Set once, and it holds the only copy of the key that will ever exist. */
  const [made, setMade] = useState<CreatedEvent | null>(null);
  // #113: set when Create was tapped before the form could make an event. From then on the line
  // under the button names what is missing and that field is outlined.
  const [tried, setTried] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  /**
   * THE FLOOR, IN THE EVENT'S OWN ZONE. Nothing anywhere refused an event in the past --
   * not this form, not `create_event` -- so you could make one for last Tuesday. Computing
   * it in `zone` rather than UTC matters at the edges: a host in Honolulu creating at 9pm
   * local is already tomorrow in UTC, and a UTC floor would refuse her own evening.
   */
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());

  const nameRef = useRef<TextInput>(null);
  const venueRef = useRef<TextInput>(null);
  const doorsRef = useRef<TextInput>(null);

  const zones = useMemo(() => zoneChoices(zone), [zone]);
  const startsAt = useMemo(() => instantFrom(date, time, zone), [date, time, zone]);
  const ready = name.trim().length > 0 && startsAt !== null && !busy;

  const missingName = name.trim().length === 0;
  const missingDate = startsAt === null;

  const onCreate = async () => {
    if (busy) return;
    if (missingName) {
      setTried(true);
      nameRef.current?.focus();
      return;
    }
    if (missingDate || !startsAt) {
      setTried(true);
      setDateOpen(true);
      return;
    }
    if (!ready) return;
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
    { boxShadow: depthCss.groove },
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
          {/* COPY BESIDE THE VALUE, and the value is selectable for a long press. These two
              strings are the whole point of this screen; a screen that only lets you read
              them asks a host to transcribe a twelve-character key by hand. */}
          <View style={s.copyRow}>
            <Text testID="created-code" selectable style={[s.code, s.copyValue, { color: tokens.baseContent }]}>
              {made.code}
            </Text>
            <Pressable
              onPress={() => copy(made.code, 'Code')}
              accessibilityRole="button"
              accessibilityLabel="Copy the join code"
              testID="created-code-copy"
              style={[s.copyButton, { borderColor: tokens.base300 }]}
            >
              <Text style={[s.copyText, { color: tokens.baseContent }]}>Copy</Text>
            </Pressable>
          </View>

          {label('YOUR KEY BACK IN')}
          <View style={s.copyRow}>
            <Text testID="created-key" selectable style={[s.code, s.copyValue, { color: tokens.baseContent }]}>
              {made.hostKey}
            </Text>
            <Pressable
              onPress={() => copy(made.hostKey, 'Recovery key')}
              accessibilityRole="button"
              accessibilityLabel="Copy the recovery key"
              testID="created-key-copy"
              style={[s.copyButton, { borderColor: tokens.base300 }]}
            >
              <Text style={[s.copyText, { color: tokens.baseContent }]}>Copy</Text>
            </Pressable>
          </View>
          <Text style={[s.helper, { color: alpha(tokens.baseContent, fade.body) }]}>
            Copy it somewhere safe — a note, a text to yourself. It is the only way back into
            this event on another phone, and it is not shown again: we keep a one-way hash of
            it, so nobody can look it up for you. You do not need it on this phone.
          </Text>

          <Button
            onPress={() => router.replace('/host/broadcast')}
            testID="created-continue"
            style={s.ctaGap}
            label="I have saved it"
          />
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
            {/* PICKED, NOT TYPED. This asked a person to type `2026-09-11`, and
                `instantFrom` refuses anything else -- deliberately, because coercing
                '11/09/2026' is how an event lands on the wrong evening. So an ordinary
                `09/11/2026` produced a form that silently would not make a date.
                The strict parser stays; what changed is that nobody has to satisfy it by
                hand. `minDate` is also the first thing anywhere to refuse a past event. */}
            <DateTimeField
              mode="date"
              value={date}
              onChange={setDate}
              placeholder="Pick a date"
              accessibilityLabel="Date of the event"
              testID="create-date"
              minDate={today}
              highlight={tried && !missingName && missingDate}
              open={dateOpen}
              onOpenChange={setDateOpen}
            />
          </View>
          <View style={s.half}>
            {label('TIME')}
            <DateTimeField
              mode="time"
              value={time}
              onChange={setTime}
              placeholder="Pick a time"
              accessibilityLabel="Start time"
              testID="create-time"
            />
          </View>
        </View>

        {/* What the fields MEAN, before anything is created. The defence against a zone
            nobody meant to pick, and against the disagreement that shipped: HOUSE7 held
            an 11:13 AM start under a "Doors 7:00 PM" label because nothing rendered it.
            The zone control sits ON this line because this line is what it interprets. */}
        <ZonePicker
          reading={
            <Text
              testID="create-starts-preview"
              style={[s.reading, { color: alpha(tokens.baseContent, fade.body) }]}
            >
              {startsAt
                ? `${formatEventDate(startsAt, zone)} · ${formatClock(startsAt, zone)}`
                : 'Pick a date and a time.'}
            </Text>
          }
          value={zone}
          onChange={setZone}
          choices={zones}
          testIDPrefix="create-zone"
        />

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

        {/* ALWAYS DRAWN, AND NEVER DISABLED (#113). It used to be drawn only once a name and a
            date were set, because a greyed Create "reads as broken software" -- true, and the
            missing button read as "there is no way to finish": the owner, creating his own
            party, asked how to actually create it. So the button is there from the start and
            a tap too early is answered rather than refused in silence: it names the missing
            thing, outlines that field, focuses the name or opens the date picker (native). It
            always does something, so `?empty=1`'s rule -- nothing aria-disabled -- holds. */}
        <Button
          onPress={onCreate}
          testID="create-submit"
          style={s.ctaGap}
          label={busy ? 'Creating…' : 'Create it'}
        />
        {!ready && !busy ? (
          <Text
            testID="create-blocked"
            style={[s.helper, { color: tried ? tokens.accent : alpha(tokens.baseContent, fade.muted) }]}
          >
            {!tried
              ? 'A name and a date are all it needs.'
              : missingName
                ? 'Give the party a name first.'
                : 'Pick a date first, just above.'}
          </Text>
        ) : null}

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
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copyValue: { flex: 1, minWidth: 0 },
  copyButton: { minHeight: 44, paddingHorizontal: 16, borderWidth: border, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
  copyText: { fontSize: 14, fontWeight: weight.semibold },
  // paddingHorizontal 20, the same gutter every other scrolling screen sets --
  // ChatScreen, MusicScreen, BroadcastPanel, DjQueuePanel, PhotoApprovalsPanel and
  // EventDetailsPanel, which this screen was derived from. <Screen> deliberately sets
  // VERTICAL insets only (its docblock says so: the artboards' 66/70/28 are top and
  // bottom), so a content container that omits this renders flush against x=0 -- labels
  // at the bezel and field borders clipped off both edges. That shipped, on the one
  // screen with no canvas render to compare against.
  content: { paddingVertical: 16, paddingHorizontal: 20, gap: 10 },
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
  // 32 tall, over SC 2.5.8's 24 AA minimum, and the 8pt gap keeps neighbours from
  // needing slop that RN would not honour between flush siblings anyway.
  // Tabular so the groups line up, and large because it gets read aloud across a room.
  code: { fontSize: 26, fontWeight: weight.semibold, letterSpacing: 2, fontVariant: ['tabular-nums'] },
  helper: { fontSize: 12, lineHeight: 18 },
  ctaGap: { marginTop: 10 },
});
