import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { EventHeader } from '@/features/chat/EventHeader';
import { ReportSheet } from '@/features/moderation/ReportSheet';
import { songKey } from '@/domain/songKey';
import { MIN_QUERY, searchSongs, type SongMatch } from '@/lib/musicSearch';
import { useMusicActions } from '@/state/actions';
import { useMyReports, useMyRequest, useMyVotes, useNowPlaying, useQueue } from '@/state/hooks';
import { subjectKey, type SongRequest, type SongRequestStatus } from '@/data/types';
import { alpha, border, eyebrow, radius, useTheme, weight } from '@/theme';

/**
 * The canvas's `statusText` map has no `declined` key, so a declined request
 * renders `undefined` -- and its `live` filter drops declined rows from the
 * queue, so the guest's request silently vanishes. FIDELITY note C.
 */
const STATUS_TEXT: Record<SongRequestStatus, string> = {
  pending: 'Waiting for DJ',
  accepted: 'Accepted ✓',
  played: 'Played',
  declined: 'Not this time',
};

function QueueRow({
  request, rank, mine, onReport,
}: {
  request: SongRequest; rank: number; mine: boolean; onReport: (r: SongRequest) => void;
}) {
  const { tokens, fade } = useTheme();
  const votes = useMyVotes();
  const { vote } = useMusicActions();
  const voted = votes.has(request.id);

  return (
    <View
      style={[
        s.row,
        { borderColor: tokens.base300, backgroundColor: mine ? tokens.base200 : 'transparent' },
      ]}
    >
      <Text style={[s.rank, { color: alpha(tokens.baseContent, fade.faint) }]}>{rank}</Text>
      <View style={s.rowBody}>
        <Text style={[s.rowTitle, { color: tokens.baseContent }]} numberOfLines={1}>
          {request.title}
        </Text>
        <Text style={[s.rowSub, { color: alpha(tokens.baseContent, fade.muted) }]} numberOfLines={1}>
          {request.artist} · {request.requestedByName}
        </Text>
      </View>
      <Pressable
        onPress={() => vote(request.id, !voted)}
        accessibilityRole="button"
        accessibilityLabel={`${voted ? 'Remove vote from' : 'Vote for'} ${request.title}`}
        accessibilityState={{ selected: voted }}
        testID={`vote-${request.id}`}
        style={[
          s.voteButton,
          {
            borderColor: tokens.base300,
            backgroundColor: voted ? tokens.primary : 'transparent',
          },
        ]}
      >
        <Text style={[s.voteText, { color: voted ? tokens.primaryContent : tokens.baseContent }]}>
          ▲ {request.voteCount}
        </Text>
      </Pressable>
      {/*
        Song requests are free text, so they are user-generated content in exactly the
        way Guideline 1.2 means -- a title field will carry abuse the moment someone
        wants it to. Not offered on your OWN request: there is nothing to report and
        nobody to block.
      */}
      {!mine && (
        <Pressable
          onPress={() => onReport(request)}
          accessibilityRole="button"
          accessibilityLabel={`Report or block, ${request.title} requested by ${request.requestedByName}`}
          testID={`request-report-${request.id}`}
          hitSlop={8}
          style={s.rowReport}
        >
          <Text style={[s.rowReportGlyph, { color: alpha(tokens.baseContent, fade.faint) }]}>⋯</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * 250ms. Long enough that a fast typist sends one request rather than eight, short enough
 * that the list feels like it is keeping up. The endpoint answers in 165-350ms, measured, so
 * a shorter debounce would mostly buy overlapping requests that abort each other.
 */
const DEBOUNCE_MS = 250;

export function MusicScreen() {
  const { tokens, fade, depthCss } = useTheme();
  const queue = useQueue();
  const nowPlaying = useNowPlaying();
  const mine = useMyRequest();
  const { request } = useMusicActions();
  const myReports = useMyReports();
  const [draft, setDraft] = useState('');
  const [reporting, setReporting] = useState<SongRequest | null>(null);

  /**
   * SUGGESTIONS, NOT A GATE. Picking one fills the field; typing something the catalogue has
   * never heard of still submits, because a local band, a mashup and an inside joke are all
   * real requests at a real party. The list is an accelerator and a speller, never a filter.
   *
   * Everything downstream is untouched: the tap writes `Title – Artist` into the same `draft`
   * the guest could have typed, `useMusicActions().request` splits it on the same regex, and
   * `song_key` decides identity exactly as before. No new repository method, no new column,
   * no SQL. The dedup win is a consequence rather than a mechanism -- two guests who pick the
   * same row send byte-identical strings, so the votes land on one song.
   */
  const [matches, setMatches] = useState<SongMatch[]>([]);
  /**
   * Suppressed after a pick, and this flag is load-bearing rather than tidy.
   *
   * Choosing a suggestion sets `draft`, which re-runs the effect below, which searches for
   * the thing just chosen and re-opens the list under the guest's finger -- over the Request
   * button she is reaching for next. `picked` closes that loop; any further typing clears it.
   */
  const [picked, setPicked] = useState(false);

  /**
   * DERIVED, NOT STORED, and the React Compiler is what insisted.
   *
   * The first draft cleared `matches` from inside the effect when the query got too short.
   * The compiler rejected it -- "calling setState synchronously within an effect can trigger
   * cascading renders" -- and it was right: whether the list should be on screen is a
   * function of what is in the field right now, not a second copy of that fact kept in sync
   * by hand. The effect only ever sets state asynchronously now, from inside the timer.
   */
  const term = draft.trim();
  const shown = picked || term.length < MIN_QUERY ? [] : matches;

  useEffect(() => {
    if (picked) return;
    const term = draft.trim();
    if (term.length < MIN_QUERY) return;
    // ABORT THE OVERTAKEN KEYSTROKE. Without this a slow answer for "dan" can land after a
    // fast one for "dancing" and replace a correct list with a stale one -- the classic
    // type-ahead race, and the reason `searchSongs` takes a signal at all.
    const ac = new AbortController();
    const t = setTimeout(() => {
      searchSongs(term, ac.signal).then(setMatches);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [draft, picked]);

  const submit = async () => {
    await request(draft);
    setDraft('');
    setMatches([]);
    setPicked(false);
  };

  /** The canonical pair, in the shape the composer's own parser already expects. */
  const pick = (m: SongMatch) => {
    // AN EN DASH WITH SPACES, because `actions.ts` splits on /\s[–-]\s/ and an artist with a
    // hyphen in it ("Jay-Z") must not be torn in half by the separator.
    setDraft(m.artist ? `${m.title} – ${m.artist}` : m.title);
    setPicked(true);
    setMatches([]);
  };

  return (
    /**
     * The composer is a flex sibling AFTER the ScrollView, so it sits on the visible
     * bottom -- and with the keyboard up it is covered, on both platforms. (Android
     * does not resize: edgeToEdgeEnabled + targetSdk 36 makes adjustResize inert.
     * Measured, see JoinScreen.tsx.) A KAV rather than the ScrollView's iOS keyboard
     * insets, because the thing that must move is outside the scroll view.
     *
     * keyboardVerticalOffset is 0 for the same reason as on /join: this is the
     * <Slot/> of (guest)/_layout.tsx, whose root View starts at window y=0. The KAV's
     * frame already ends above <GuestTabBar/> -- a sibling OUTSIDE it -- so the tab
     * bar is left under the keyboard, which is what iOS does with a tab bar during
     * text entry.
     */
    <KeyboardAvoidingView behavior="padding" style={s.wrap}>
      <EventHeader eyebrow="Requests" />
      {/* 'handled' so a vote or a report lands on the FIRST press while the composer
          is focused; RN's 'never' default would spend that tap dismissing the
          keyboard. 'on-drag' so scrolling the queue puts the keyboard away. */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        testID="music-queue"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {nowPlaying && (
          <View style={[s.nowPlaying, { backgroundColor: tokens.neutral }]}>
            <View style={[s.art, { backgroundColor: tokens.base300 }]} />
            <View style={s.npText}>
              <Text style={[s.npEyebrow, { color: alpha(tokens.neutralContent, fade.body) }]}>
                Now playing
              </Text>
              <Text style={[s.npTitle, { color: tokens.neutralContent }]} numberOfLines={1}>
                {nowPlaying.title}
              </Text>
              <Text style={[s.npArtist, { color: alpha(tokens.neutralContent, 0.75) }]} numberOfLines={1}>
                {nowPlaying.artist}
              </Text>
            </View>
          </View>
        )}

        {mine && (
          <View style={[s.mineStrip, { backgroundColor: tokens.secondary }]}>
            <Text style={[s.mineText, { color: tokens.secondaryContent }]}>
              Your request is <Text style={s.mineRank}>#{mine.rank}</Text> in the queue
            </Text>
            <Text style={[s.mineStatus, { color: alpha(tokens.secondaryContent, 0.8) }]}>
              {STATUS_TEXT[mine.request.status]}
            </Text>
          </View>
        )}

        <View style={s.sectionHead}>
          <Text style={[s.sectionTitle, { color: alpha(tokens.baseContent, fade.muted) }]}>
            Queue · ranked by votes
          </Text>
          <Text style={[s.sectionCount, { color: alpha(tokens.baseContent, fade.faint) }]}>
            {queue.length} requests
          </Text>
        </View>

        {queue.map((r, i) => (
          <QueueRow
            key={r.id}
            request={r}
            rank={i + 1}
            mine={mine?.request.id === r.id}
            onReport={setReporting}
          />
        ))}
      </ScrollView>

      <ReportSheet
        visible={reporting !== null}
        onClose={() => setReporting(null)}
        subject={reporting === null ? null : { kind: 'song_request', requestId: reporting.id }}
        subjectLabel={
          reporting === null
            ? ''
            : reporting.artist
              ? `${reporting.title} -- ${reporting.artist}`
              : reporting.title
        }
        author={
          reporting === null || reporting.requestedByGuestId === null
            ? null
            : { guestId: reporting.requestedByGuestId, nickname: reporting.requestedByName }
        }
        alreadyReported={
          reporting !== null &&
          myReports.has(subjectKey({ kind: 'song_request', requestId: reporting.id }))
        }
      />

      {/* ABOVE THE COMPOSER, NOT BELOW IT. The composer is pinned to the bottom of a
          KeyboardAvoidingView, so a list under it would open into the keyboard. Growing
          upward also keeps the guest's finger, the field and the first suggestion in the
          same place they already are.

          A `.map()` in a ScrollView, not a FlatList -- there is no FlatList anywhere in this
          repo and every list is a map. Eight rows do not need virtualisation, and a new list
          primitive on one screen is a second way of doing something the codebase already
          does one way. */}
      {shown.length > 0 && (
        <View
          testID="request-suggestions"
          style={[s.suggestions, { backgroundColor: tokens.base200, borderTopColor: tokens.base300 }]}
        >
          <ScrollView
            /* 'handled' so the FIRST tap picks a suggestion instead of being spent
               dismissing the keyboard -- RN's 'never' default eats it, which is the same
               trap the queue's own ScrollView documents above. */
            keyboardShouldPersistTaps="handled"
            style={s.suggestionScroll}
          >
            {shown.map((m) => (
              <Pressable
                key={`${m.title}|${m.artist}`}
                onPress={() => pick(m)}
                accessibilityRole="button"
                accessibilityLabel={m.artist ? `${m.title} by ${m.artist}` : m.title}
                testID={`suggest-${songKey(m.title, m.artist)}`}
                style={s.suggestion}
              >
                <Text style={[s.suggestTitle, { color: tokens.baseContent }]} numberOfLines={1}>
                  {m.title}
                </Text>
                <Text
                  style={[s.suggestArtist, { color: alpha(tokens.baseContent, fade.muted) }]}
                  numberOfLines={1}
                >
                  {m.artist}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={[s.composer, { borderTopColor: tokens.base300 }]}>
        <TextInput
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            // Typing after a pick means she is editing it, so the list comes back.
            setPicked(false);
          }}
          onSubmitEditing={submit}
          returnKeyType="send"
          /* The real defect on this line. RN's default ('blurAndSubmit') drops the
             keyboard after EVERY request, which is wrong for a field a guest uses
             three times in a row at a party. With 'submit' the keyboard stays up, and
             an empty Return does nothing at all -- useMusicActions().request already
             trims and returns early, and guest-music.spec.ts pins that the composer
             still clears, so do NOT add a guard to submit() here. */
          submitBehavior="submit"
          placeholder="Song – artist"
          placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
          accessibilityLabel="Song and artist"
          testID="request-input"
          style={[
            s.input,
            { boxShadow: depthCss.groove },
            { borderColor: tokens.base300, backgroundColor: tokens.base200, color: tokens.baseContent },
          ]}
        />
        <Pressable
          onPress={submit}
          accessibilityRole="button"
          testID="request-submit"
          style={[s.requestButton, { backgroundColor: tokens.primary }]}
        >
          <Text style={[s.requestText, { color: tokens.primaryContent }]}>Request</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingVertical: 16, paddingHorizontal: 20, gap: 12 },

  nowPlaying: { borderRadius: radius.box, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 },
  art: { width: 64, height: 64, borderRadius: 12 },
  npText: { flex: 1, minWidth: 0 },
  npEyebrow: { ...eyebrow.card },
  npTitle: { fontSize: 17, fontWeight: weight.semibold, marginTop: 2 },
  npArtist: { fontSize: 13 },

  mineStrip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.selector,
  },
  mineText: { fontSize: 14, flexShrink: 1 },
  mineRank: { fontWeight: weight.bold },
  mineStatus: { fontSize: 12 },

  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { ...eyebrow.list },
  sectionCount: { fontSize: 12 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: radius.selector, borderWidth: border,
  },
  rank: { width: 22, fontSize: 13, textAlign: 'center' },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: weight.medium },
  // 32 wide clears SC 2.5.8 (24, AA); hitSlop 8 takes the real target to 48, past
  // SC 2.5.5's 44, because it sits next to the vote button and a mis-tap there is
  // the difference between muting someone and upvoting them.
  rowReport: { width: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  rowReportGlyph: { fontSize: 18, lineHeight: 20, fontWeight: weight.bold },
  rowSub: { fontSize: 12 },
  voteButton: {
    height: 36, minWidth: 56, paddingHorizontal: 10,
    borderRadius: radius.pill, borderWidth: border,
    alignItems: 'center', justifyContent: 'center',
  },
  voteText: { fontSize: 13, fontWeight: weight.semibold },

  /* Capped so the list never swallows the queue behind it: four rows at 44 plus the
     container's own border. 44 is an explicit height, which is what `audit:targets` reads --
     comfortably over SC 2.5.8's 24pt AA floor without relying on hitSlop between rows that
     sit flush against each other, where slop would overlap its neighbour. */
  suggestions: { borderTopWidth: border, maxHeight: 4 * 44 },
  suggestionScroll: { flexGrow: 0 },
  suggestion: { height: 44, paddingHorizontal: 20, justifyContent: 'center' },
  suggestTitle: { fontSize: 15 },
  suggestArtist: { fontSize: 12 },
  composer: {
    flexDirection: 'row', gap: 8, borderTopWidth: border,
    paddingTop: 12, paddingBottom: 10, paddingHorizontal: 20,
  },
  input: { flex: 1, height: 46, borderRadius: radius.field, borderWidth: border, paddingHorizontal: 14, fontSize: 15 },
  requestButton: { height: 46, paddingHorizontal: 18, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
  requestText: { fontSize: 15, fontWeight: weight.semibold },
});
