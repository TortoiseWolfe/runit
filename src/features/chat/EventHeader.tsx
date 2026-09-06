import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionPill } from '@/components/ui/ConnectionPill';
import { NameSheet } from '@/features/session/NameSheet';
import { useBlocked, useConnection, useEvent, useSession } from '@/state/hooks';
import { alpha, border, insetDelta, radius, tracking, useTheme, weight } from '@/theme';

/**
 * Canvas: `padding: 66px 20px 12px`, a base-300 bottom border, an 11px
 * uppercase eyebrow over the event name at 19/600, and a "{n} here" pill on the
 * right filled base-200 with a base-300 hairline.
 */
export function EventHeader({ eyebrow: eyebrowText }: { eyebrow: string }) {
  const { tokens, fade } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const event = useEvent();
  const blocked = useBlocked();
  const session = useSession();
  const connection = useConnection();
  const [renaming, setRenaming] = useState(false);
  // A host has no nickname to show -- she has a display name and a role pill on her own
  // console. This is the guest's identity surface and nobody else's.
  const nickname = session.kind === 'guest' ? session.nickname.trim() : '';

  return (
    <View
      style={[
        s.header,
        { paddingTop: insets.top + insetDelta.header, borderBottomColor: tokens.base300 },
      ]}
    >
      <View style={s.titles}>
        <Text style={[s.eyebrow, { color: alpha(tokens.baseContent, fade.soft) }]}>
          {eyebrowText}
        </Text>
        <Text style={[s.title, { color: tokens.baseContent }]} numberOfLines={1}>
          {event?.name ?? ''}
        </Text>
      </View>
      {/*
        SHOWN ONLY WHEN IT IS NON-EMPTY, which is the whole design. Most guests block
        nobody, so a permanent fourth tab would cost every one of them a slot to carry
        an empty list. Appearing the moment there is something to manage puts the way
        back exactly where someone who just blocked a person will look for it.
      */}
      {blocked.length > 0 && (
        <Pressable
          onPress={() => router.navigate('/blocked')}
          accessibilityRole="button"
          accessibilityLabel={`Manage ${blocked.length} blocked ${blocked.length === 1 ? 'person' : 'people'}`}
          testID="blocked-pill"
          hitSlop={8}
          style={[s.pill, { backgroundColor: tokens.base200, borderColor: tokens.base300 }]}
        >
          <Text style={[s.pillText, { color: tokens.baseContent }]}>
            {blocked.length} blocked
          </Text>
        </Pressable>
      )}
      {/*
        YOUR OWN NAME, which no screen has ever shown you (#43).

        NOT IN THE CANVAS -- FIDELITY note AM. The canvas has no identity surface at all,
        because in a prototype the nickname is whatever the designer typed. In a shipped
        app it is denormalised onto every song request and photo you send, and a guest who
        typo'd it on the join screen had no way to find that out, let alone fix it.

        It follows the existing conditional-pill pattern beside it rather than inventing
        chrome: drawn only for a guest session, and only when there is a name, so a host
        console and the moment before a join are both unchanged. Truncated to one line so
        a long name cannot push the event's own name off the header.
      */}
      {nickname !== '' && (
        <Pressable
          onPress={() => setRenaming(true)}
          accessibilityRole="button"
          accessibilityLabel={`You are ${nickname}. Change your name.`}
          testID="name-pill"
          hitSlop={8}
          style={[s.pill, s.namePill, { backgroundColor: tokens.base200, borderColor: tokens.base300 }]}
        >
          <Text style={[s.pillText, { color: tokens.baseContent }]} numberOfLines={1}>
            {nickname}
          </Text>
        </Pressable>
      )}
      {/*
        THE CONNECTION PILL REPLACES THE HEADCOUNT while the connection is not live (#45),
        rather than joining it. Two reasons, and the second is the real one.

        Layout: this row already carries up to three pills beside a flexing event name, and
        a fourth does not fit at 402pt.

        Honesty: a headcount fed by a dead channel is STALE. Showing "172 here" from a
        snapshot that stopped updating is a small lie of exactly the kind this app keeps
        closing, and swapping it for "reconnecting" puts a true thing in the space the false
        thing was using.
      */}
      {connection === 'live' ? (
        <View
          testID="guest-count-pill"
          style={[s.pill, { backgroundColor: tokens.base200, borderColor: tokens.base300 }]}
        >
          <Text style={[s.pillText, { color: tokens.baseContent }]}>{event?.guestCount ?? 0} here</Text>
        </View>
      ) : (
        <ConnectionPill />
      )}
      {/* Rendered only while open, so every opening is a fresh mount and the field starts
          from the name the room is seeing. See NameSheet's own note. */}
      {renaming && <NameSheet nickname={nickname} onClose={() => setRenaming(false)} />}
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: border,
  },
  titles: { flex: 1 },
  eyebrow: { fontSize: 11, letterSpacing: tracking(0.12, 11), textTransform: 'uppercase' },
  title: { fontSize: 19, fontWeight: weight.semibold, letterSpacing: tracking(-0.01, 19) },
  pill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: border,
  },
  // A cap rather than a flex: the pills sit in a row with the event name, and a 40-character
  // nickname would otherwise take the header.
  namePill: { maxWidth: 110 },
  pillText: { fontSize: 12 },
});
