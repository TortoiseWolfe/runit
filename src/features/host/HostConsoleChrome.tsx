import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';

import { ConnectionPill } from '@/components/ui/ConnectionPill';
import { RoleSwitch } from '@/components/ui/RoleSwitch';
import { useEvent, useIncoming, usePendingPhotos, useReports, useSession } from '@/state/hooks';
import { border, insetDelta, radius, tracking, useTheme, weight } from '@/theme';

type Segment = {
  href: '/host/broadcast' | '/host/dj' | '/host/photos' | '/host/reports' | '/host/event';
  label: string;
  badge?: number;
};

/**
 * Canvas: `padding: 66px 20px 10px`, gap 12, a base-300 bottom border, the word
 * "Host" at 19/600 with a secondary-filled role pill, then a 3-up segmented
 * control on a base-200 track whose active button is base-100.
 *
 * The canvas models the segments as `hostTab` local state. They are routes here
 * so /host/dj is directly addressable -- which is what lets the screenshot
 * harness reach each one, and removes a second copy of navigation state.
 *
 * TWO MORE DIVERGENCES FROM THAT DESCRIPTION, both recorded rather than silent: the track
 * is five-up, not three (Reports and Event, see the segment list), and the title slot holds
 * the EVENT'S NAME rather than the word "Host" (#58, FIDELITY note AX).
 */
export function HostConsoleChrome() {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const event = useEvent();
  const incoming = useIncoming();
  const pending = usePendingPhotos();
  const reports = useReports();

  const segments: Segment[] = [
    { href: '/host/broadcast', label: 'Broadcast' },
    { href: '/host/dj', label: 'DJ queue', badge: incoming.length },
    { href: '/host/photos', label: 'Photos', badge: pending.length },
    // Fourth segment, and it earns the space: Guideline 1.2 asks for TIMELY responses
    // to reports, and a queue a host has to go looking for is not one they will answer.
    { href: '/host/reports', label: 'Reports', badge: reports.length },
    // Fifth. The canvas drew THREE (Broadcast, DJ queue, Photos) and did not model the
    // event's own details as editable at all -- they are hardcoded strings in its
    // `state` block. Reports was the first divergence, this is the second, and it is
    // where event-level settings will keep accumulating: tier, invitees, co-hosts.
    //
    // 'Event' rather than 'Details' because the track is a five-up grid at 402pt and
    // segmentText is numberOfLines-free but the buttons are not: the shortest true
    // label is the one that survives.
    { href: '/host/event', label: 'Event' },
  ];

  return (
    <View
      style={[
        s.header,
        { paddingTop: insets.top + insetDelta.header, borderBottomColor: tokens.base300 },
      ]}
    >
      <View style={s.titleRow}>
        {/*
          THE EVENT'S OWN NAME, not the word "Host" (#58).

          NOT IN THE CANVAS -- FIDELITY note AX. The canvas prints the literal `Host` here
          (`design/Runit.dc.html:212`) and names the event on every GUEST surface and no host
          one, which is a prototype's luxury: in a prototype there is one party. `create_event`
          has allowed TEN per identity since it shipped, and Broadcast is the first segment --
          so a host with two parties open was one tap from announcing to the wrong room, with
          no delete path for a sent announcement and #27's fan-out pushing it to every phone.

          `Host` survives as the null case rather than as a fallback: a host can stand here
          with no current event, and that is a real state with an honest word for it.
        */}
        <Text
          style={[s.title, { color: tokens.baseContent }]}
          numberOfLines={1}
          testID="host-console-title"
        >
          {event?.name ?? 'Host'}
        </Text>
        {/*
          THE HOST NEEDS THIS MOST, and `EventHeader` is not on her console -- so a
          guest-only pill would leave the person who POSTS the announcements without one.
          That is the shape of #29 and #37: the surface existed everywhere except where the
          affected person was standing. Renders nothing while live.
        */}
        <ConnectionPill />
        <RoleSwitch />
        {session.kind === 'host' && (
          <View style={[s.rolePill, { backgroundColor: tokens.secondary }]}>
            <Text style={[s.roleText, { color: tokens.secondaryContent }]}>
              {session.displayName} · {session.roleLabel}
            </Text>
          </View>
        )}
      </View>

      <View style={[s.track, { backgroundColor: tokens.base200 }]}>
        {segments.map(({ href, label, badge }) => {
          const active = pathname === href;
          return (
            <Pressable
              key={href}
              onPress={() => router.navigate(href)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              testID={`host-segment-${label.split(' ')[0]!.toLowerCase()}`}
              style={[s.segment, { backgroundColor: active ? tokens.base100 : 'transparent' }]}
            >
              <Text style={[s.segmentText, { color: tokens.baseContent }]} numberOfLines={1}>
                {label}
                {badge ? ` · ${badge}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 10, gap: 12, borderBottomWidth: border },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  /**
   * `flex: 1` IS LOAD-BEARING, and its absence is invisible until a real event name arrives.
   * This row is `space-between` at 402pt carrying the title, ConnectionPill, RoleSwitch and
   * the role pill inside 362pt. Without a flex basis a long name grows and crushes its
   * siblings -- "Guest view →" is how a host leaves the console, and the role pill is the
   * only thing saying which seat she holds. The name is what should truncate, so the name is
   * what flexes. `EventHeader` solved this first and its comment says the same in reverse:
   * "a long name cannot push the event's own name off the header."
   *
   * The tracking matches `EventHeader.tsx` deliberately. Same 19/600 slot, same string, and
   * two headers that differ only by an optical detail nobody chose is drift, not design.
   */
  title: {
    flex: 1,
    fontSize: 19,
    fontWeight: weight.semibold,
    letterSpacing: tracking(-0.01, 19),
  },
  rolePill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill },
  roleText: { fontSize: 12 },
  track: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: radius.selector }, // .75rem
  segment: {
    flex: 1,
    height: 34,
    borderRadius: radius.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: { fontSize: 13, fontWeight: weight.medium },
});
