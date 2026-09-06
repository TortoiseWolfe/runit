import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { EventHeader } from '@/features/chat/EventHeader';
import { PhotoViewer } from './PhotoViewer';
import { ReportSheet } from '@/features/moderation/ReportSheet';
import { usePhotoActions } from '@/state/actions';
import {
  useActiveFolder, useApprovedPhotos, useFolders, useMyReports, useMyUploads,
} from '@/state/hooks';
import { subjectKey, type Photo } from '@/data/types';
import { albumTileColor, alpha, border, radius, tracking, useTheme, weight } from '@/theme';

/**
 * Artboard 02, Photos tab.
 *
 * The canvas exposes `photosVariant: shutter | album` as a prop. Those are real
 * product states, not mockup toggles: a full-bleed shutter when the album is
 * empty, the grid once it is not. Driven off the data here rather than a prop.
 */
/** Screen padding and inter-tile gap, from the canvas. */
const GRID_PADDING = 20;
const GRID_GAP = 3;
const GRID_COLUMNS = 3;

export function PhotosScreen() {
  const { tokens, isDark, fade } = useTheme();
  const { width } = useWindowDimensions();

  // Tile size is computed, not a percentage.
  //
  // `width: '32.4%'` renders correctly in react-native-web -- the browser
  // resolves the percentage against the wrapping row -- and renders NOTHING on
  // a real device, because in Yoga a percentage width inside a `flexWrap` row
  // that also sets `gap` has no determinate basis. The album came up empty on
  // Android while every web screenshot showed nine tiles.
  //
  // This is the exact failure class the style audit and the colour gate exist
  // for, and neither could see it: it is a layout bug, not a colour, and Lane B
  // runs through the browser that gets it right.
  const tileSize = Math.floor(
    (width - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS,
  );
  const folders = useFolders();
  const active = useActiveFolder();
  const approved = useApprovedPhotos();
  // This guest's own transfers -- in flight or failed. Nobody else's.
  const mine = useMyUploads();
  const { capture, retry, selectFolder } = usePhotoActions();
  const myReports = useMyReports();
  // The photo whose sheet is open, or null. Holding the ROW rather than the id keeps
  // the label and the author available after a realtime update removes it from the
  // grid -- otherwise reporting the thing that just got hidden crashes the sheet.
  const [reporting, setReporting] = useState<Photo | null>(null);
  const [viewing, setViewing] = useState<Photo | null>(null);

  const visible = approved.filter((p) => p.folderId === active?.id);
  const totalPhotos = folders.reduce((a, f) => a + f.photoCount, 0);
  const onCapture = () => capture(active?.name ?? 'the album');

  /**
   * The folder chips, rendered by BOTH branches.
   *
   * They used to live only inside the grid branch, so selecting a folder with no
   * approved photos unmounted the chips along with the grid and stranded the
   * guest -- with no way back, because an upload lands `pending` and never flips
   * the pane. Two of the three seeded folders are empty, so it was one tap away,
   * and the only escape was a force-quit, which loses everything.
   */
  const folderChips = (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
      {folders.map((f) => {
        const on = f.id === active?.id;
        return (
          <Pressable
            key={f.id}
            onPress={() => selectFolder(f.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            testID={`folder-${f.id}`}
            style={[
              s.chip,
              { borderColor: tokens.base300, backgroundColor: on ? tokens.primary : 'transparent' },
            ]}
          >
            <Text style={[s.chipText, { color: on ? tokens.primaryContent : tokens.baseContent }]}>
              {f.name} · {f.photoCount}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  if (visible.length === 0) {
    return (
      <View style={s.wrap}>
        <EventHeader eyebrow="Shared album" />
        {folderChips}
        <View style={[s.shutterPane, { backgroundColor: tokens.base200 }]}>
          <View style={s.countBlock}>
            <Text style={[s.count, { color: tokens.baseContent }]}>{totalPhotos}</Text>
            <Text style={[s.countLabel, { color: alpha(tokens.baseContent, fade.muted) }]}>
              photos in the album
            </Text>
          </View>

          <Pressable
            onPress={onCapture}
            accessibilityRole="button"
            accessibilityLabel="Take a photo"
            testID="shutter"
            style={({ pressed }) => [
              s.shutter,
              {
                borderColor: tokens.base300,
                backgroundColor: tokens.base100,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              },
            ]}
          >
            <View style={[s.shutterInner, { backgroundColor: tokens.primary }]} />
          </Pressable>

          <Text style={[s.blurb, { color: alpha(tokens.baseContent, 0.75) }]}>
            One tap. Photos upload to the album and appear once a host approves them.
          </Text>

          <View style={[s.filingPill, { backgroundColor: tokens.base100, borderColor: tokens.base300 }]}>
            <Text style={[s.filingText, { color: tokens.baseContent }]}>
              Filing into · <Text style={s.filingName}>{active?.name ?? '—'}</Text>
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <EventHeader eyebrow="Shared album" />
      <ScrollView style={s.scroll} testID="album">
        {folderChips}

        <View style={s.grid}>
          {/* Own transfers first: they are the newest thing the guest did, and a
              failed one needs to be found without hunting. They sit in the same
              grid rather than a separate list so the album still reads as one
              roll -- which is also why they keep the hue tile underneath. */}
          {mine.map((p) => (
            <View
              key={p.id}
              testID={`upload-${p.id}`}
              style={[
                s.tile,
                { width: tileSize, height: tileSize, backgroundColor: albumTileColor(p.hue, isDark) },
              ]}
            >
              {/*
                LOCAL BYTES FIRST, then the signed URL (#10). A guest who just took this
                photo has it on disk and should not wait on a network round trip to see
                her own picture; everyone else gets the 400px copy from the bucket. The
                hue tile stays the layer underneath when there is neither -- a seeded row,
                a pending photo somebody else uploaded, and a signature still in flight
                all render identically, which is correct.
              */}
              {p.localUri ?? p.displayUrl ? (
                <Image
                  source={{ uri: (p.localUri ?? p.displayUrl)! }}
                  style={s.tileImage}
                  resizeMode="cover"
                />
              ) : null}
              {p.status === 'uploading' ? (
                <View style={[s.overlay, { backgroundColor: alpha(tokens.base100, 0.62) }]}>
                  {/* A determinate bar, not a spinner. The guest is waiting on a
                      known quantity of bytes, and a spinner cannot distinguish
                      "nearly there" from "stuck". */}
                  <View style={[s.track, { backgroundColor: alpha(tokens.baseContent, 0.25) }]}>
                    <View
                      testID={`upload-progress-${p.id}`}
                      style={[
                        s.fill,
                        { width: `${Math.round((p.progress ?? 0) * 100)}%`, backgroundColor: tokens.primary },
                      ]}
                    />
                  </View>
                </View>
              ) : (
                <View style={[s.overlay, { backgroundColor: alpha(tokens.base100, 0.72) }]}>
                  <Pressable
                    onPress={() => retry(p.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Retry upload${p.failureReason ? `. ${p.failureReason}` : ''}`}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    testID={`retry-${p.id}`}
                    style={[s.retry, { borderColor: tokens.base300 }]}
                  >
                    <Text style={[s.retryText, { color: tokens.baseContent }]}>Retry</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
          {visible.map((p) => (
            // The testID stays on the OUTER node deliberately. The e2e suite
            // counts `tile-*` and asserts their order; wrapping the image in a
            // new parent and moving the testID would break both. The hue tile is
            // not a placeholder to be replaced -- it is the layer underneath, and
            // it stays the permanent rendering for the nine seeded rows, which
            // have no bytes and never will.
            /*
              THE TILE IS THE CONTROL NOW (#38). It was a plain View: tapping a photo did
              nothing at all, and only the `⋯` badge inside it responded.

              The testID stays on this node, which is why it is a Pressable rather than a
              Pressable wrapped around a View -- guest-photos.spec.ts counts the album with
              getByTestId(/^tile-/), and a second element per tile matching that prefix
              silently doubled the count from 9 to 18 once already. The report badge keeps
              its deliberate `report-tile-` name for the same reason.
            */
            <Pressable
              key={p.id}
              testID={`tile-${p.id}`}
              onPress={() => setViewing(p)}
              accessibilityRole="button"
              accessibilityLabel={`Open the photo from ${p.uploadedByName}`}
              style={[
                s.tile,
                { width: tileSize, height: tileSize, backgroundColor: albumTileColor(p.hue, isDark) },
              ]}
            >
              {/*
                LOCAL BYTES FIRST, then the signed URL (#10). A guest who just took this
                photo has it on disk and should not wait on a network round trip to see
                her own picture; everyone else gets the 400px copy from the bucket. The
                hue tile stays the layer underneath when there is neither -- a seeded row,
                a pending photo somebody else uploaded, and a signature still in flight
                all render identically, which is correct.
              */}
              {p.localUri ?? p.displayUrl ? (
                <Image
                  source={{ uri: (p.localUri ?? p.displayUrl)! }}
                  style={s.tileImage}
                  resizeMode="cover"
                />
              ) : null}
              {/*
                A VISIBLE control, not a long-press. Guideline 1.2 asks that reporting
                be available, and a gesture with no affordance is not available to a
                reviewer who does not know to try it -- nor to a guest upset enough to
                want it. It sits on the tile because that is the thing being reported.
              */}
              <Pressable
                onPress={() => setReporting(p)}
                accessibilityRole="button"
                accessibilityLabel={`Report or block, photo from ${p.uploadedByName}`}
                // NOT `tile-report-...`: guest-photos.spec.ts counts the album with
                // getByTestId(/^tile-/), and a second element per tile matching that
                // prefix silently doubled the count from 9 to 18.
                testID={`report-tile-${p.id}`}
                hitSlop={6}
                // SOLID, not alpha. A translucent chip composites against whatever hue
                // the tile happens to be, so its contrast is a different number on every
                // photo -- the colour gate measured six tiles at 1.75:1 to 1.83:1 against
                // a 4.5:1 bar. neutral/neutralContent is a designed pair and passes by
                // construction, whatever is underneath it.
                style={[s.tileReport, { backgroundColor: tokens.neutral }]}
              >
                <Text style={[s.tileReportGlyph, { color: tokens.neutralContent }]}>⋯</Text>
              </Pressable>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <PhotoViewer
        photo={viewing}
        onClose={() => setViewing(null)}
        onReport={(p) => {
          // Close the viewer FIRST. Two modals stacked leaves the report sheet behind a
          // full-screen photo on iOS, which reads as a frozen app.
          setViewing(null);
          setReporting(p);
        }}
      />

      <ReportSheet
        visible={reporting !== null}
        onClose={() => setReporting(null)}
        subject={reporting === null ? null : { kind: 'photo', photoId: reporting.id }}
        subjectLabel={reporting === null ? '' : `Photo from ${reporting.uploadedByName}`}
        // Null for a row nobody owns -- the seeded album has nine. Hiding the block
        // option is correct there: there is no person to stop seeing.
        author={
          reporting === null || reporting.uploadedByGuestId === null
            ? null
            : { guestId: reporting.uploadedByGuestId, nickname: reporting.uploadedByName }
        }
        alreadyReported={
          reporting !== null && myReports.has(subjectKey({ kind: 'photo', photoId: reporting.id }))
        }
      />

      <View style={[s.albumBar, { borderTopColor: tokens.base300 }]}>
        <Pressable
          onPress={onCapture}
          accessibilityRole="button"
          accessibilityLabel="Take a photo"
          testID="shutter-small"
          style={({ pressed }) => [
            s.shutterSmall,
            {
              borderColor: tokens.base300,
              backgroundColor: tokens.base100,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            },
          ]}
        >
          <View style={[s.shutterSmallInner, { backgroundColor: tokens.primary }]} />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  scroll: { flex: 1 },

  shutterPane: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28, padding: 24 },
  countBlock: { alignItems: 'center' },
  count: { fontSize: 40, fontWeight: weight.semibold, letterSpacing: tracking(-0.03, 40) },
  countLabel: { fontSize: 13 },
  shutter: {
    width: 168, height: 168, borderRadius: 84, borderWidth: 6,
    alignItems: 'center', justifyContent: 'center',
    boxShadow: '0px 20px 40px rgba(0, 0, 0, 0.25)',
  },
  shutterInner: { width: 132, height: 132, borderRadius: 66 },
  blurb: { fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 260 },
  filingPill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: border },
  filingText: { fontSize: 12 },
  filingName: { fontWeight: weight.bold },

  chips: { gap: 8, paddingTop: 14, paddingBottom: 6, paddingHorizontal: 20 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: border },
  chipText: { fontSize: 13 },
  // 28 clears WCAG 2.2 SC 2.5.8 (24, AA) on its own, and hitSlop 6 takes the real
  // target to 40 -- close to SC 2.5.5's 44 without covering a third of the tile.
  tileReport: {
    position: 'absolute', top: 4, right: 4,
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  tileReportGlyph: { fontSize: 16, lineHeight: 18, fontWeight: weight.bold },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    paddingVertical: 8,
    paddingHorizontal: GRID_PADDING,
  },
  // Width and height are supplied at the call site -- see the note above.
  // The real size is `tileSize`, computed from the window width -- which lane A2 cannot
  // resolve, because it is a DECLARATION check rather than a geometry one and refuses to
  // pretend otherwise. This is the floor a tile never goes below, declared so the audit
  // can see it: a three-column grid at 402pt gives ~120.
  tile: { borderRadius: 6, minWidth: 44, minHeight: 44 },
  // Fills the tile it sits inside; the tile owns the size.
  tileImage: { width: '100%', height: '100%' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  track: { width: '100%', height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%' },
  // 28pt tall clears the 24x24 AA minimum on its own; the hitSlop is headroom
  // for a thumb, not the thing that gets it over the bar.
  retry: { minHeight: 28, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.pill, borderWidth: border },
  retryText: { fontSize: 12 },

  albumBar: { alignItems: 'center', paddingTop: 14, paddingBottom: 10, borderTopWidth: border },
  shutterSmall: {
    width: 84, height: 84, borderRadius: 42, borderWidth: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  shutterSmallInner: { width: 62, height: 62, borderRadius: 31 },
});
