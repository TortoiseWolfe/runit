import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { GuestList, GuestListMember, GuestListMemberId } from '@/data/types';
import { phoneKey } from '@/domain/phoneKey';
import { useHostActions } from '@/state/actions';
import { useInvitees } from '@/state/hooks';
import { alpha, border, radius, useTheme, weight } from '@/theme';

/**
 * WHO FROM THIS LIST IS COMING THIS TIME (spec 008).
 *
 * Tapping a saved list used to copy every member in at once. A list says who BELONGS; this
 * sheet says who is coming to THIS party -- a cousin who cannot make it is switched off here
 * and stays on Family. Somebody on no list is a one-off add (the field below the lists), and
 * a co-host is a role (the co-host section). None of the four stands in for another.
 *
 * EVERY SWITCH STARTS ON: a host leaves people out, she does not opt them in. Somebody already
 * on this event is TEXT, not a switch, because a switch that could only add a duplicate the
 * database discards is a control that does nothing (the `aria-disabled` rule). The confirm
 * button says the number that will land, and is not drawn at zero; Cancel always is.
 *
 * Mounted per list by the parent (keyed by id), so its state starts fresh every time.
 */
export function GuestListSheet({ list, onClose }: { list: GuestList; onClose: () => void }) {
  const { tokens, fade } = useTheme();
  const { guestListMembers, attachGuestList } = useHostActions();
  const invitees = useInvitees();
  const [members, setMembers] = useState<GuestListMember[] | null>(null);
  const [off, setOff] = useState<Set<GuestListMemberId>>(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void guestListMembers(list.id).then((m) => {
      if (live) setMembers(m);
    });
    return () => {
      live = false;
    };
  }, [guestListMembers, list.id]);

  // The same two keys the unique indexes deduplicate on, so "already invited" here means
  // exactly "attaching them would add nobody".
  const emails = new Set(invitees.filter((i) => i.email).map((i) => i.email!.toLowerCase()));
  const phones = new Set(invitees.filter((i) => i.phone).map((i) => phoneKey(i.phone!)));
  const already = (m: GuestListMember) =>
    (!!m.email && emails.has(m.email.toLowerCase())) || (!!m.phone && phones.has(phoneKey(m.phone)));

  const choosable = (members ?? []).filter((m) => !already(m));
  const chosen = choosable.filter((m) => !off.has(m.id));
  const label = (m: GuestListMember) => m.displayName ?? m.email ?? m.phone ?? '';

  const toggle = (id: GuestListMemberId) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = async () => {
    setBusy(true);
    const ok = await attachGuestList(list.id, list.name, chosen.map((m) => m.id));
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[s.backdrop, { backgroundColor: alpha(tokens.neutral, 0.6) }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        testID="list-sheet-backdrop"
      />
      <View style={[s.sheet, { backgroundColor: tokens.base200, borderTopColor: tokens.base300 }]} testID="list-sheet">
        <Text style={[s.title, { color: tokens.baseContent }]}>Who from {list.name} is coming?</Text>
        <Text style={[s.sub, { color: alpha(tokens.baseContent, fade.muted) }]}>
          Switch off anyone who is not. They stay on {list.name}.
        </Text>
        <ScrollView style={s.list} contentContainerStyle={s.listContent} keyboardShouldPersistTaps="handled">
          {members === null ? (
            <Text style={[s.sub, { color: alpha(tokens.baseContent, fade.muted) }]}>Loading…</Text>
          ) : (
            members.map((m) =>
              already(m) ? (
                <View key={m.id} style={[s.row, { borderColor: tokens.base300 }]} testID="list-member-invited">
                  <Text style={[s.name, { color: alpha(tokens.baseContent, fade.muted) }]} numberOfLines={1}>
                    {label(m)}
                  </Text>
                  <Text style={[s.note, { color: alpha(tokens.baseContent, fade.muted) }]}>already invited</Text>
                </View>
              ) : (
                <Pressable
                  key={m.id}
                  onPress={() => toggle(m.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !off.has(m.id) }}
                  accessibilityLabel={`${label(m)}, ${off.has(m.id) ? 'not coming' : 'coming'}`}
                  testID="list-member"
                  style={[s.row, { borderColor: tokens.base300, backgroundColor: tokens.base100 }]}
                >
                  <View
                    style={[
                      s.box,
                      off.has(m.id)
                        ? { borderColor: tokens.base300 }
                        : { borderColor: tokens.primary, backgroundColor: tokens.primary },
                    ]}
                  >
                    {off.has(m.id) ? null : <Text style={[s.tick, { color: tokens.primaryContent }]}>✓</Text>}
                  </View>
                  <Text
                    style={[
                      s.name,
                      { color: off.has(m.id) ? alpha(tokens.baseContent, fade.muted) : tokens.baseContent },
                    ]}
                    numberOfLines={1}
                  >
                    {label(m)}
                  </Text>
                </Pressable>
              ),
            )
          )}
          {members !== null && choosable.length === 0 ? (
            <Text style={[s.sub, { color: alpha(tokens.baseContent, fade.muted) }]} testID="list-sheet-all-in">
              Everyone on {list.name} is already invited.
            </Text>
          ) : null}
        </ScrollView>
        {chosen.length > 0 ? (
          <Pressable
            onPress={() => void add()}
            accessibilityRole="button"
            accessibilityLabel={`Add ${chosen.length} from ${list.name} to this party`}
            testID="list-sheet-add"
            style={[s.add, { backgroundColor: tokens.primary, opacity: busy ? 0.7 : 1 }]}
          >
            <Text style={[s.addText, { color: tokens.primaryContent }]}>
              Add {chosen.length} to this party
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close without adding anyone"
          testID="list-sheet-cancel"
          style={[s.cancel, { borderColor: tokens.base300 }]}
        >
          <Text style={[s.cancelText, { color: tokens.baseContent }]}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    borderTopWidth: border,
    borderTopLeftRadius: radius.selector,
    borderTopRightRadius: radius.selector,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '85%',
  },
  title: { fontSize: 18, fontWeight: weight.semibold },
  sub: { fontSize: 13, marginTop: 4, marginBottom: 12 },
  list: { flexGrow: 0 },
  listContent: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    borderWidth: border,
    borderRadius: radius.field,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: { fontSize: 15, fontWeight: weight.semibold },
  name: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: weight.semibold },
  note: { fontSize: 12 },
  add: { marginTop: 14, minHeight: 46, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
  addText: { fontSize: 15, fontWeight: weight.semibold },
  cancel: { marginTop: 10, minHeight: 46, borderWidth: border, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15, fontWeight: weight.semibold },
});
