import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useMusicActions } from '@/state/actions';
import { useAccepted, useIncoming, useNowPlaying } from '@/state/hooks';
import { playSong, serviceLabel } from '@/lib/music';
import { useToast } from '@/state/ToastProvider';
import { alpha, border, eyebrow, radius, useTheme, weight } from '@/theme';

/** Artboard 03, DJ queue segment. */
export function DjQueuePanel() {
  const { tokens, fade, depth, depthCss } = useTheme();
  const nowPlaying = useNowPlaying();
  const accepted = useAccepted();
  const incoming = useIncoming();
  const { playNext, markPlayed, accept, decline } = useMusicActions();
  const { show } = useToast();

  /**
   * ADVANCE THE CURSOR, THEN ACTUALLY PLAY IT.
   *
   * `playNext` moves the room's Now-Playing card, which is what every guest sees. It is not
   * what makes sound: RunIt has no audio path and cannot have one without a catalogue
   * licence (#8). So this also hands the song to whatever music app the host already has
   * open and connected to the speakers, which is the part RunIt was making the host do by
   * hand -- reading the queue and retyping it into Spotify.
   *
   * THE CURSOR MOVES FIRST and is never blocked on the handoff. A host whose phone has no
   * music app installed still gets a working queue; the room still sees what is on. The
   * reverse order would make a missing app break the feature that does work.
   */
  const onStart = async () => {
    // What the cursor will land on: the next accepted song, or the first one if nothing has
    // started yet. Read BEFORE the advance, because after it the queue has moved.
    const next = accepted[0];
    await playNext();
    if (!next) return;
    const used = await playSong(next.title, next.artist);
    show(
      used
        ? `Opening in ${serviceLabel[used]}.`
        : `Queued "${next.title}". No music app here — play it on whatever is on the speakers.`,
    );
  };

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content} testID="host-dj">
      {/* A CLOSED LOOP, AND NOTHING COULD EVER OPEN IT. This whole bar was gated on
          `nowPlaying`, and the ONLY control that sets `nowPlaying` is the button inside it.
          So on every event this app can create -- where nothing is playing yet -- "Play
          next" was undrawable, no song ever became the current one, and no guest ever saw a
          Now Playing card on the Music tab. The host could accept songs and mark them
          played and never once start one.

          It draws whenever there is something to start OR something already started. The
          `nowPlaying` half stays conditional inside it, because "Nothing playing yet" is a
          real state with an honest sentence rather than a blank. */}
      {(nowPlaying || accepted.length > 0) && (
        <View style={[s.nowBar, { backgroundColor: tokens.neutral }]}>
          <View style={s.nowText}>
            <Text style={[s.nowEyebrow, { color: alpha(tokens.neutralContent, fade.body) }]}>
              {nowPlaying ? 'Now playing' : 'Nothing playing yet'}
            </Text>
            <Text style={[s.nowTitle, { color: tokens.neutralContent }]} numberOfLines={1}>
              {nowPlaying ? nowPlaying.title : accepted[0]!.title}
            </Text>
            <Text style={[s.nowArtist, { color: alpha(tokens.neutralContent, 0.75) }]} numberOfLines={1}>
              {nowPlaying ? nowPlaying.artist : `${accepted[0]!.artist} · up first`}
            </Text>
          </View>
          <Pressable
            onPress={onStart}
            accessibilityRole="button"
            accessibilityLabel={nowPlaying ? 'Play the next accepted song' : 'Start the first accepted song'}
            testID="play-next"
            style={[s.playNext, { backgroundColor: tokens.base100 }]}
          >
            <Text style={[s.playNextText, { color: tokens.baseContent }]}>
              {nowPlaying ? 'Play next ▶' : 'Start ▶'}
            </Text>
          </Pressable>
        </View>
      )}

      <Text style={[s.section, { color: alpha(tokens.baseContent, fade.muted) }]}>
        Up next · accepted
      </Text>
      {accepted.map((r) => (
        <View key={r.id} style={[s.row, { borderColor: tokens.base300, boxShadow: depth.well }]}>
          <View style={s.rowBody}>
            <Text style={[s.rowTitle, { color: tokens.baseContent }]} numberOfLines={1}>{r.title}</Text>
            <Text style={[s.rowSub, { color: alpha(tokens.baseContent, fade.muted) }]} numberOfLines={1}>
              {r.artist} · ▲{r.voteCount} · {r.requestedByName}
            </Text>
          </View>
          <Pressable
            onPress={() => markPlayed(r.id)}
            accessibilityRole="button"
            testID={`played-${r.id}`}
            style={[s.ghostButton, { borderColor: tokens.base300 }]}
          >
            <Text style={[s.ghostText, { color: tokens.baseContent }]}>Mark played</Text>
          </Pressable>
        </View>
      ))}

      <Text style={[s.section, { color: alpha(tokens.baseContent, fade.muted), marginTop: 6 }]}>
        Incoming · {incoming.length}
      </Text>
      {incoming.map((r) => (
        <View
          key={r.id}
          style={[s.row, { borderColor: tokens.base300, backgroundColor: tokens.base200 }]}
        >
          <View style={s.rowBody}>
            <Text style={[s.rowTitle, { color: tokens.baseContent }]} numberOfLines={1}>{r.title}</Text>
            <Text style={[s.rowSub, { color: alpha(tokens.baseContent, fade.muted) }]} numberOfLines={1}>
              {r.artist} · ▲{r.voteCount} · {r.requestedByName}
            </Text>
          </View>
          <Pressable
            onPress={() => decline(r.id)}
            accessibilityRole="button"
            accessibilityLabel={`Decline ${r.title}`}
            testID={`decline-${r.id}`}
            style={[s.circle, { borderColor: tokens.base300, borderWidth: border }]}
          >
            <Text style={{ color: tokens.error, fontSize: 14 }}>✕</Text>
          </Pressable>
          <Pressable
            onPress={() => accept(r.id)}
            accessibilityRole="button"
            accessibilityLabel={`Accept ${r.title}`}
            testID={`accept-${r.id}`}
            style={[s.circle, { backgroundColor: tokens.success }]}
          >
            <Text style={{ color: tokens.successContent, fontSize: 14 }}>✓</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingVertical: 16, paddingHorizontal: 20, gap: 12 },
  nowBar: {
    borderRadius: radius.box, paddingVertical: 16, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  nowText: { flex: 1, minWidth: 0 },
  nowEyebrow: { ...eyebrow.card },
  nowTitle: { fontSize: 17, fontWeight: weight.semibold, marginTop: 2 },
  nowArtist: { fontSize: 13 },
  playNext: { height: 38, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  playNextText: { fontSize: 13, fontWeight: weight.semibold },
  section: { ...eyebrow.section, fontSize: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: radius.selector, borderWidth: border,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: weight.medium },
  rowSub: { fontSize: 12 },
  ghostButton: { height: 34, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: border, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 12 },
  circle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
