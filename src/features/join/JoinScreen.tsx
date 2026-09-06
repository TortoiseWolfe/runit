import { useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { Screen } from "@/components/ui/Screen";
import { Toast } from "@/components/ui/Toast";
import { useEvent, useLookUpInvite, usePreview } from "@/state/hooks";
import { useJoinActions } from "@/state/actions";
import { useToast } from "@/state/ToastProvider";
import { icsFilename, icsFor } from "@/lib/invite";
import { formatEventDate } from "@/lib/format";
import { shareIcs } from "@/lib/share";
import {
  alpha,
  border,
  eyebrow,
  radius,
  tracking,
  useTheme,
  weight,
} from "@/theme";

/**
 * Artboard 01.
 *
 * Canvas: `padding: 70px 24px 40px`, column, gap 28. The 70 and 40 include the
 * mockup's fake status bar and home indicator, so <Screen top="page"
 * bottom="page"> re-derives them from real insets. Everything else is verbatim.
 */
export function JoinScreen() {
  const { tokens, fade } = useTheme();
  const router = useRouter();
  const event = useEvent();
  const preview = usePreview();
  const { join } = useJoinActions();
  const { show } = useToast();

  /**
   * `?code=` FIRST, and the order matters more than it looks.
   *
   * The canvas pre-fills the code and calls it "scanned the QR", and until now the
   * seeded event supplied that. Against Supabase it cannot: `events_read` admits
   * members only, so `event` is NULL until you have already joined. A guest arriving
   * at this screen for the first time would see an empty field and no event name --
   * the canvas's promise, broken by the backend that makes the app real.
   *
   * A link carrying the code is what restores it, which is why this is the param
   * rather than the seed that wins. Three shapes land here: `https://<origin>/i/HOUSE7`
   * via `src/app/i/[code].tsx`, the `runit://join?code=HOUSE7` scheme, and a plain
   * `/join?code=HOUSE7`. Before any of it the route read no params at all and dropped the
   * code on the floor.
   */
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(
    (typeof params.code === "string" ? params.code : undefined) ??
      event?.code ??
      "",
  );
  // One lookup, on arrival, for the code the link carried. `params.code` is stable
  // for the life of this screen, so this fires once. Typing into the field below does
  // NOT re-run it -- see useLookUpInvite.
  useLookUpInvite(typeof params.code === "string" ? params.code : undefined);

  /**
   * The invitation, from whichever source can supply one.
   *
   * `current` first: once you are in, it is the same event plus everything a member is
   * allowed to see, and it stays live. `preview` is the half a non-member can have.
   * Before this existed there was only `current`, so an invitation showed nothing at
   * all until it had already been accepted.
   */
  const invite = event ?? preview;

  /**
   * "Fri, Sep 11 · Doors 7:00 PM · The living room", assembled here rather than stored.
   *
   * The canvas drew this as one string and the fixtures copied it whole --
   * `doorsLabel` used to read "Sat, Oct 17 · Doors 4:00 PM · Willow Barn". It carried
   * the date and the venue because nothing could derive either, which also meant the
   * date could not be wrong: it was never computed from `startsAt`, so it never
   * disagreed with it out loud. It disagreed silently instead. HOUSE7 on the live
   * project holds a start time of 11:13 AM under a label reading "Doors 7:00 PM".
   *
   * Composed from the parts, an event that has not had its time set now says so.
   */
  const subtitle = invite
    ? [formatEventDate(invite.startsAt, invite.timezone), invite.doorsLabel, invite.venue]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" · ")
    : "";

  const [nickname, setNickname] = useState("");
  const [hostKey, setHostKey] = useState("");
  const [joined, setJoined] = useState(false);
  const nicknameRef = useRef<TextInput>(null);
  const hostKeyRef = useRef<TextInput>(null);

  const onAddToCalendar = async () => {
    // `invite`, not `event`: the whole point of the preview is that this works from a
    // link, before joining. `icsFor` takes a Pick<RunitEvent, ...> that an
    // EventPreview satisfies exactly -- including `id`, which is the calendar UID, so
    // adding the invitation and then joining does not produce two entries.
    if (!invite) return;
    const shared = await shareIcs(icsFilename(invite), icsFor(invite));
    // Reporting the outcome rather than assuming it. On a desktop browser there is no
    // share sheet at all, and a button that silently does nothing is the failure this
    // pill spent months demoted to a View to avoid.
    show(
      shared
        ? "Calendar file ready."
        : "Calendar export needs the app on a phone.",
    );
  };

  const onJoin = async () => {
    // The form is submitted; the keyboard has no remaining job -- and it is now
    // POSSIBLE to press this with the keyboard up, which it was not before. <Toast>
    // sits 126pt off the floor (tabBar.contentHeight + inset + 29) and the keyboard
    // is ~291, so every join failure would render behind it. Measured on device: the
    // window does not resize, so nothing moves the toast out from under the IME.
    Keyboard.dismiss();
    const ok = await join(code, nickname, hostKey);
    if (ok) setJoined(true);
  };

  const inputStyle = [
    s.input,
    {
      borderColor: tokens.base300,
      backgroundColor: tokens.base100,
      color: tokens.baseContent,
    },
  ];

  return (
    /**
     * The KAV is OUTSIDE <Screen>, and that is derived rather than preferred.
     *
     * RN computes its padding as `frame.y + frame.height - keyboardTop`, where
     * `frame` comes from its own onLayout -- PARENT-relative -- while keyboardTop is
     * screen-absolute. Inside <Screen> the frame would start below the safe-area
     * padding and under-pad by exactly `insets.top + insetDelta.page`, forcing
     * keyboardVerticalOffset to become a live expression of the top inset. Outermost,
     * its parent is the router's screen container, which starts at window y=0 because
     * `headerShown: false` is global -- so the arithmetic lands on the keyboard height
     * exactly and the offset is 0. If a header is ever added to /join, that stops
     * being true and the offset becomes the header height.
     *
     * behavior is 'padding' on ANDROID TOO, which is not the conventional choice and
     * was measured rather than assumed: this app sets `edgeToEdgeEnabled=true` and
     * targets SDK 36, which makes `android:windowSoftInputMode="adjustResize"` INERT.
     * On the emulator with the IME shown, the app window stayed (0,0,1080,2400) and
     * "Run it" stayed at y 1566-1627 while the keyboard's top edge was ~1494 -- the
     * button was painted underneath and unreachable, exactly as on iOS. Evidence:
     * design/device/android-join-keyboard.BROKEN-before-fix.png. Do not "correct"
     * this to iOS-only without re-running that measurement.
     */
    <KeyboardAvoidingView behavior="padding" style={s.avoid}>
      <Screen top="page" bottom="page" style={s.screen}>
        {/*
          keyboardShouldPersistTaps is not optional here -- it is part of the same
          edit. Introducing a ScrollView imports RN's 'never' default, under which the
          FIRST tap on "Run it" with the keyboard up is swallowed to dismiss the
          keyboard and never reaches the button. Without it this change would make the
          reported symptom worse, not better.

          contentContainerStyle carries flexGrow:1 because s.footer pins itself with
          marginTop:'auto', and that only has free space to absorb if the content
          container fills the scroll frame the way Screen's flex:1 filled it before.
          If the footer creeps up under the CTA, this is what is missing.
        */}
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Text
              style={[
                s.eyebrow,
                { color: alpha(tokens.baseContent, fade.muted) },
              ]}
            >
              You&apos;re invited to
            </Text>
            <Text style={[s.title, { color: tokens.baseContent }]}>
              {invite?.name ?? "An event"}
            </Text>
            <Text
              style={[
                s.subtitle,
                { color: alpha(tokens.baseContent, fade.body) },
              ]}
            >
              {subtitle}
            </Text>
            {/* An aggregate count, and deliberately nothing more -- no names, no
                avatars. It reads as social proof before you commit, and it is what
                makes the e2e suite able to prove that joining INCREMENTS the room
                rather than merely that the room reads 173 afterwards. Before this
                existed there was no screen showing the count pre-join, so a seed of
                173 that never incremented was indistinguishable from a seed of 172
                that did. See tests/e2e/join.spec.ts and FIDELITY note J.

                `event`, NOT `invite`, and that is the one place the two must differ on
                this screen. `event_preview` withholds guest_count deliberately -- a
                headcount for a room you have not entered is the first crack in "guests
                can't see each other", three lines further down this same screen. So an
                invitation from a link shows the name, the date and the venue, and does
                not tell you how many people are already there. */}
            {event ? (
              <Text
                testID="join-guest-count"
                style={[
                  s.alreadyHere,
                  { color: alpha(tokens.baseContent, fade.muted) },
                ]}
              >
                {event.guestCount} already here
              </Text>
            ) : null}
            {/* PRESSABLE AT LAST. This was a View with the comment "wire it back up when
                expo-calendar lands" -- and it turns out expo-calendar was the wrong target.
                Handing over an .ics needs no calendar permission, works with whatever app the
                guest actually uses, and is a string plus a temp file. FIDELITY note K makes
                the same argument about the microphone: do not ask for a permission the
                feature does not need. */}
            {/* RENDERED ONLY WHEN THERE IS SOMETHING TO ADD, and that is the fix for a
                device report. It used to be `disabled={!event}`, and against Supabase
                `events_read` admits members only -- so on a cold open `event` is null,
                the title falls back to "An event", the date and venue are blank, and
                this pill sits there inert. It was reported as "the first button doesn't
                even work", which is exactly how a disabled control with no explanation
                reads: as broken software.

                A control that cannot act should not be drawn. `tests/e2e/empty-world.spec.ts`
                holds the general form of this -- nothing visible may be aria-disabled --
                because the same boolean also made Show QR and Share invite inert, and
                each was found separately, on a phone. */}
            {invite ? (
            <Pressable
              onPress={onAddToCalendar}
              accessibilityRole="button"
              accessibilityLabel="Add this event to your calendar"
              hitSlop={8}
              style={[s.calendarPill, { borderColor: tokens.base300 }]}
              testID="join-add-calendar"
            >
              <Text
                style={[
                  s.calendarText,
                  { color: alpha(tokens.baseContent, fade.muted) },
                ]}
              >
                + Add to calendar
              </Text>
            </Pressable>
            ) : null}
          </View>

          <View style={[s.card, { backgroundColor: tokens.base200 }]}>
            <Text
              style={[s.hint, { color: alpha(tokens.baseContent, fade.body) }]}
            >
              Scanned the QR? Your code is filled in. Otherwise type it.
            </Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="Event code"
              placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Event code"
              testID="join-code"
              returnKeyType="next"
              /* 'submit' keeps the keyboard UP while focus moves. RN 0.86's default,
                 'blurAndSubmit', drops it and re-raises it for the next field -- a
                 visible flicker on iOS and a focus race on Android. */
              submitBehavior="submit"
              onSubmitEditing={() => nicknameRef.current?.focus()}
              style={[...inputStyle, s.codeInput]}
            />
            <TextInput
              value={nickname}
              onChangeText={setNickname}
              placeholder="Nickname (shown with your requests)"
              placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
              accessibilityLabel="Nickname"
              testID="join-nickname"
              ref={nicknameRef}
              autoCorrect={false}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => hostKeyRef.current?.focus()}
              style={[...inputStyle, s.nickInput]}
            />
            {/* OPTIONAL, and last, because almost nobody types in it: at a party of ten
                there is one host and nine guests. It is a plain field rather than a
                separate screen because the host has to join as a guest first anyway --
                there is no auth user to bind a host seat to until the anonymous sign-in
                inside joinAsGuest has run. */}
            <TextInput
              value={hostKey}
              onChangeText={setHostKey}
              placeholder="Host key (optional)"
              placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Host key, optional"
              accessibilityHint="Leave empty unless you are running this event."
              testID="join-host-key"
              ref={hostKeyRef}
              /* 'go' and not 'next': this is the LAST field, and the return key has to
                 mean something here because this is where people press it. It is
                 optional, so an empty one submits and joins as a guest -- which
                 tests/e2e/join.spec.ts already pins as correct. Giving the submit to
                 nickname instead would make the host path unreachable from the keyboard,
                 and a host reading a key off a note at a venue is the person most likely
                 to be typing one-handed.

                 submitBehavior is spelled out rather than inherited: 'blurAndSubmit' IS
                 the default, and it is what we want here (the keyboard closes as onJoin
                 runs, revealing the CTA's "You're in" and any toast) -- but a default is
                 invisible in review, which is the whole argument tools/audit-keyboard.mjs
                 makes. Say it. */
              submitBehavior="blurAndSubmit"
              returnKeyType="go"
              onSubmitEditing={onJoin}
              style={[...inputStyle, s.nickInput]}
            />
            <Text
              style={[s.fine, { color: alpha(tokens.baseContent, fade.soft) }]}
            >
              No account, no phone number. Hosts can see nicknames; guests
              can&apos;t see each other.
            </Text>

            {/* THE SUPPLY SIDE'S ONE DOOR, and it is deliberately quiet.
                Nearly everyone arriving here is a guest holding a code, so this must not
                compete with the field above it. But before this link there was no path
                to making an event at all: every event in existence came from someone
                running seed-events.sql with the database password, which is why "where
                is the hostess supposed to get a key to her own party" had no good
                answer. Issue #13.

                An input here was rejected. The fine print directly above is a product
                promise about accounts, and a sign-in field underneath it would make that
                promise read as false. A link keeps it literally true. */}
            <Pressable
              onPress={() => router.push("/create")}
              accessibilityRole="button"
              accessibilityLabel="Create an event you are hosting"
              hitSlop={10}
              testID="join-create-event"
            >
              <Text style={[s.createLink, { color: tokens.primary }]}>
                Running an event? Make one →
              </Text>
            </Pressable>
          </View>

          <Pressable
            onPress={onJoin}
            accessibilityRole="button"
            testID="join-submit"
            style={[s.cta, { backgroundColor: tokens.primary }]}
          >
            <Text style={[s.ctaText, { color: tokens.primaryContent }]}>
              {joined ? "You're in ✓" : "Run it"}
            </Text>
          </Pressable>

          <Text
            style={[s.footer, { color: alpha(tokens.baseContent, fade.faint) }]}
          >
            RunIt · Event plan
          </Text>

          {/* join() reports both outcomes through the toast -- the welcome on the
              way to Chat, and "That code doesn't match an event." when it doesn't.
              The guest and host layouts each mount a <Toast>, but /join sits
              outside both, so the rejection message had nowhere to render and a bad
              code failed silently. Mounted here so the failure is visible on the
              screen that causes it. */}
        </ScrollView>

        {/* OUTSIDE the ScrollView on purpose: it is position:'absolute' with a bottom
            offset measured from the screen floor, so inside a scroll container it
            would scroll away from the place it is aligned to. */}
        <Toast />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  avoid: { flex: 1 },
  // paddingHorizontal stays on <Screen> rather than moving to the content
  // container: it is the containing block <Toast>'s left/right:20 resolves
  // against, and moving it would widen the toast by 48pt.
  screen: { paddingHorizontal: 24 },
  content: { flexGrow: 1, gap: 28 },
  eyebrow: { ...eyebrow.section, fontSize: 12 },
  title: {
    fontSize: 34,
    fontWeight: weight.semibold,
    letterSpacing: tracking(-0.02, 34),
    lineHeight: 37,
    marginTop: 6,
  },
  subtitle: { fontSize: 15, marginTop: 8 },
  // 13pt of text, under SC 2.5.8's 24 minimum, hence the hitSlop on the Pressable. It
  // has no interactive neighbour, which is the condition under which slop is safe --
  // RN's own docs note slop never extends past the parent and loses to sibling z-order.
  createLink: { fontSize: 13, fontWeight: weight.semibold, marginTop: 10 },
  alreadyHere: { fontSize: 13, marginTop: 6 },
  calendarPill: {
    alignSelf: "flex-start",
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: border,
  },
  calendarText: { fontSize: 13 },
  card: { borderRadius: radius.box, padding: 20, gap: 14 },
  hint: { fontSize: 13 },
  input: {
    height: 48,
    borderRadius: radius.field,
    borderWidth: border,
    paddingHorizontal: 14,
  },
  codeInput: { fontSize: 18, letterSpacing: tracking(0.2, 18) },
  nickInput: { fontSize: 16 },
  fine: { fontSize: 12, lineHeight: 18 },
  cta: {
    height: 56,
    borderRadius: radius.field,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontSize: 17, fontWeight: weight.semibold },
  footer: { marginTop: "auto", textAlign: "center", fontSize: 12 },
});
