import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { EventHeader } from '@/features/chat/EventHeader';
import { ReportSheet } from '@/features/moderation/ReportSheet';
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

export function MusicScreen() {
  const { tokens, fade } = useTheme();
  const queue = useQueue();
  const nowPlaying = useNowPlaying();
  const mine = useMyRequest();
  const { request } = useMusicActions();
  const myReports = useMyReports();
  const [draft, setDraft] = useState('');
  const [reporting, setReporting] = useState<SongRequest | null>(null);

  const submit = async () => {
    await request(draft);
    setDraft('');
  };

  return (
    <View style={s.wrap}>
      <EventHeader eyebrow="Requests" />
      <ScrollView style={s.scroll} contentContainerStyle={s.content} testID="music-queue">
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

      <View style={[s.composer, { borderTopColor: tokens.base300 }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          placeholder="Song – artist"
          placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
          accessibilityLabel="Song and artist"
          testID="request-input"
          style={[
            s.input,
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
    </View>
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

  composer: {
    flexDirection: 'row', gap: 8, borderTopWidth: border,
    paddingTop: 12, paddingBottom: 10, paddingHorizontal: 20,
  },
  input: { flex: 1, height: 46, borderRadius: radius.field, borderWidth: border, paddingHorizontal: 14, fontSize: 15 },
  requestButton: { height: 46, paddingHorizontal: 18, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
  requestText: { fontSize: 15, fontWeight: weight.semibold },
});
