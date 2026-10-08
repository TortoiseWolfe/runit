import { useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { EventHeader } from '@/features/chat/EventHeader';
import { PhotoViewer } from './PhotoViewer';
import { followViewing, viewerList, type Viewing } from './viewerList';
import { ReportLink } from '@/components/ui/ReportLink';
import { ReportSheet } from '@/features/moderation/ReportSheet';
import { usePhotoActions } from '@/state/actions';
import {
  useActiveFolder, useApprovedPhotos, useEntitlements, useEvent, useFolders, useMyReports,
  useMyUploads,
} from '@/state/hooks';
import { subjectKey, type Photo, type PhotoId } from '@/data/types';
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
  /**
   * THE PHOTO'S ID, PLUS THE INDEX IT WAS LAST SEEN AT (spec 001b). Before 001b this was an
   * index into `visible`; the viewer's list is now own-waiting-then-approved, and the viewer
   * must follow the photo when the host approves or hides it while it is open, which an
   * index cannot do. See `followViewing`.
   */
  const [viewing, setViewing] = useState<Viewing | null>(null);
  /**
   * `null` means unlimited -- the $599 tier -- and there is nothing honest to warn about
   * then, so the line is not drawn at all rather than saying "kept forever", which is a
   * promise nobody should make about somebody else's storage bill.
   */
  const retentionDays = useEntitlements().tier.limits.albumRetentionDays;
  /**
   * WHY A PHOTO IS NOT IN THE ROOM'S ALBUM YET.
   *
   * On a moderated event every upload lands `pending` and stays invisible to everyone but
   * its uploader and the hosts until a host approves it. The uploader sees it here, in
   * `mine`, marked "Waiting for host" (spec 001) -- the toast at upload time is a
   * one-off and a guest who checks the album five minutes later must still find their
   * photo. The album's rule line below states the same rule for a guest with none yet.
   */
  /*
   * THE EVENT'S SWITCH, NOT THE TIER'S. It was `useEntitlements().tier.features
   * .photoModeration`, which is false on `house_party` -- the only tier `create_event`
   * mints -- so on every event this app can create the album promised the room that
   * photos go straight in, it was right, and nothing could change that.
   *
   * `?? false` for the cold open: before an event is loaded there is no album to
   * describe, and guessing `true` would print "once a host approves them" on a screen
   * with no host.
   */
  const moderated = useEvent()?.photoModeration ?? false;

  const visible = approved.filter((p) => p.folderId === active?.id);
  /*
   * SPEC 001 REQ 1: a waiting photo shows "in the folder they were filed into"
   * (docs/specs/001-own-pending-photos/spec.md:18-19). `photos.mine` is folder-agnostic in
   * both adapters, so the folder filter lives here, beside `visible`'s. Sending and failed
   * transfers are deliberately NOT filtered: req 4 keeps their behaviour unchanged, and Retry
   * must stay reachable from whichever folder the guest is looking at (#70).
   */
  const mineHere = mine.filter((p) => p.status !== 'pending' || p.folderId === active?.id);
  /*
   * SPEC 001b. The viewer's list is what the grid can open: this guest's own waiting photos
   * in this folder, then the approved ones, so "N of M" counts both (req 2).
   */
  const viewerPhotos = viewerList(mineHere, visible);
  /*
   * FOLLOW THE PHOTO, NOT THE SLOT (req 4). `followViewing` returns the same object when
   * nothing moved, so this is a conditional state adjustment during render -- React's
   * documented pattern -- and settles in one extra render. It must run BEFORE the early
   * return below: a hold left on a vanished photo would otherwise pop the viewer open on a
   * different photo the next time the list grows.
   */
  const followed = followViewing(viewerPhotos, viewing);
  if (followed !== viewing) setViewing(followed);
  const openViewer = (id: PhotoId) => {
    const at = viewerPhotos.findIndex((p) => p.id === id);
    if (at >= 0) setViewing({ id, at });
  };
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
   *
   * `s.chipsScroll` IS LOAD-BEARING IN THE EMPTY BRANCH (#118). There the ScrollView is a
   * direct child of a flex column, and React Native gives a ScrollView `flexGrow: 1` by
   * default -- so the row took half the screen, the chip stretched to ~312pt, its label was
   * clipped by the pill radius and the filing pill was pushed under the tab bar. The grid
   * branch never showed it: there the chips are the FlatList's header.
   */
  const folderChips = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.chipsScroll}
      contentContainerStyle={s.chips}
    >
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

  /*
   * THE SHUTTER PANE ONLY WHEN THERE IS GENUINELY NOTHING TO SHOW -- #70.
   *
   * This read `visible.length === 0` alone, and `visible` is APPROVED photos filtered to
   * the active folder. `mine` -- this guest's own uploading and failed transfers -- is
   * referenced nowhere in the branch below, and the Retry control exists in exactly one
   * place in the whole app: inside `mine.map` in the grid branch.
   *
   * So a guest whose upload failed on an album with no approved photos was told
   * "Upload failed. Your photo is saved -- tap Retry." (`actions.ts:277`) on a screen with
   * no Retry on it, and no way to reach one. `actions.ts:275-276` even asserts in a
   * comment that "the failed tile carries the reason and the Retry button"; it did not.
   *
   * ON A MODERATED EVENT THAT IS NOT A MOMENT, IT IS THE WHOLE NIGHT. Uploads land
   * `pending` and `pending` is not `approved`, so `visible` never fills from this guest's
   * own photos -- she would never see Retry at all. (Since spec 001 `mine` also carries
   * the guest's landed-and-waiting photos, so on that night the grid branch is reached
   * from the first upload and the guest sees the photo itself, not only its Retry.)
   *
   * The second thing it fixes was not in the issue: an upload IN FLIGHT from an empty
   * album showed nothing either. `mine` carries `uploading` as well as `failed`, so the
   * pane now hands over to the grid the moment there is a transfer, and the progress tile
   * at :215 is finally reachable from a cold album. In-memory transfers complete
   * instantly, which is why only `?flaky=1` can see that half.
   */
  if (visible.length === 0 && mineHere.length === 0) {
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

          {/* IT SAID THE APPROVAL SENTENCE UNCONDITIONALLY, AND IT WAS FALSE (#67).
              `create_event` mints `house_party`, whose photoModeration is false, so on
              every event this app can create the photo appears AT ONCE -- and the toast a
              second later says "Added to All photos" while the tile is already there. The
              app contradicted itself in about two seconds, on the first screen a guest
              meets at a party that has just started.

              The screen already knew how to say this correctly: `album-moderated` in the
              grid branch renders the same claim conditionally, off the same `moderated`.
              Only this one asserted it -- and this one is what a NEW party shows. */}
          <Text testID="album-blurb" style={[s.blurb, { color: alpha(tokens.baseContent, 0.75) }]}>
            {moderated
              ? 'One tap. Photos upload to the album and appear once a host approves them.'
              : 'One tap. Photos go straight into the album for everyone here.'}
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

  const renderMine = (p: Photo) => {
            const body = (
              <>
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
                ) : p.status === 'pending' ? (
                  // LANDED AND WAITING (spec 001). No scrim: this is the guest's own photo
                  // and the point is that they can see it. A solid chip rather than a
                  // translucent one, so its contrast is the token pair's and not whatever
                  // hue happens to be underneath.
                  <View style={s.waitingWrap} pointerEvents="none">
                    <View
                      testID={`waiting-${p.id}`}
                      style={[s.waiting, { backgroundColor: tokens.base100, borderColor: tokens.base300 }]}
                    >
                      <Text style={[s.waitingText, { color: tokens.baseContent }]}>Waiting for host</Text>
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
              </>
            );
            // SPEC 001b req 1 and 5: only a WAITING tile opens the viewer. Sending and failed
            // tiles keep their progress bar and Retry and are not controls.
            return p.status === 'pending' ? (
              <Pressable
                key={p.id}
                testID={`upload-${p.id}`}
                onPress={() => openViewer(p.id)}
                accessibilityRole="button"
                accessibilityLabel="Open your photo, waiting for host"
                style={[
                  s.tile,
                  { width: tileSize, height: tileSize, backgroundColor: albumTileColor(p.hue, isDark) },
                ]}
              >
                {body}
              </Pressable>
            ) : (
              <View
                key={p.id}
                testID={`upload-${p.id}`}
                style={[
                  s.tile,
                  { width: tileSize, height: tileSize, backgroundColor: albumTileColor(p.hue, isDark) },
                ]}
              >
                {body}
              </View>
            );
  };

  const renderApproved = (p: Photo) => (
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
              onPress={() => openViewer(p.id)}
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
  );

  /** Own transfers first, then the approved album: the order the grid has always drawn. */
  const gridItems: { kind: 'mine' | 'approved'; p: Photo }[] = [
    ...mineHere.map((p) => ({ kind: 'mine' as const, p })),
    ...visible.map((p) => ({ kind: 'approved' as const, p })),
  ];

  return (
    <View style={s.wrap}>
      <EventHeader eyebrow="Shared album" />
      {/*
        A FLATLIST, NOT .map IN A SCROLLVIEW (#93). The album is the one list in the app that
        grows without a bound a host notices: 100 photos on the free plan, 1,000 on Party,
        unlimited above, and a wedding is exactly where it fills. `.map` drew every tile as a
        live <Image> at once. Rows are virtualised now; the tiles, their testIDs and their
        order are untouched, because the album specs count `tile-*` and assert the order.
        No getItemLayout: the header (folder chips) and footer have no fixed height, and a
        wrong offset is worse than a measured one.
      */}
      <FlatList
        style={s.scroll}
        testID="album"
        data={gridItems}
        keyExtractor={(it) => it.p.id}
        numColumns={GRID_COLUMNS}
        columnWrapperStyle={s.gridRow}
        ItemSeparatorComponent={RowGap}
        ListHeaderComponent={<View style={s.gridHeader}>{folderChips}</View>}
        ListFooterComponent={
          <>
          {/*
            HOW LONG THIS ALBUM LASTS (#23).

            It sits at the FOOT of the album rather than the top, and that is deliberate: a
            deadline is not the first thing anyone should meet when they open a shared photo
            album at a party. It is the thing they should find when they scroll to the end
            and start thinking about which ones they want.

            IT SHIPS AFTER A SAVE CONTROL EXISTS (#39), not before. A deadline nobody can act
            on is not a warning, it is bad news -- so the sentence names the thing to do, and
            the thing is real.

            NOTHING DELETES ANYTHING YET, and the copy is careful not to claim otherwise: it
            says how long photos are KEPT, which is true, rather than promising a removal
            that no code performs. The sweep is separate work and irreversible.
          */}
          {retentionDays !== null ? (
            <Text
              testID="album-retention"
              style={[s.retention, { color: alpha(tokens.baseContent, fade.muted) }]}
            >
              Photos here are kept for {retentionDays} days after the event. Tap one and
              choose Save to keep it on your phone.
            </Text>
          ) : null}

          {moderated ? (
            <Text
              testID="album-moderated"
              style={[s.retention, { color: alpha(tokens.baseContent, fade.muted) }]}
            >
              Photos you add appear here once a host approves them.
            </Text>
          ) : null}

          {/* #77. The end of the tab where a guest notices a photo did not arrive. */}
          <ReportLink inset={20} />
          </>
        }
        renderItem={({ item }) => (item.kind === 'mine' ? renderMine(item.p) : renderApproved(item.p))}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
      />

      <PhotoViewer
        photos={viewerPhotos}
        index={followed === null ? null : followed.at}
        onIndex={(i) => {
          const p = viewerPhotos[i];
          if (p) setViewing({ id: p.id, at: i });
        }}
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

/** The space between album rows; a component because FlatList takes one. */
function RowGap() {
  return <View style={s.rowGap} />;
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

  // No growing: as a column's child a ScrollView defaults to `flexGrow: 1` (#118).
  chipsScroll: { flexGrow: 0, flexShrink: 0 },
  // `center`, not the row's default `stretch`, so a chip is a pill in any container.
  chips: { gap: 8, paddingTop: 14, paddingBottom: 6, paddingHorizontal: 20, alignItems: 'center' },
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
  // A FlatList row: the gap between columns and the gutter. Rows are separated by RowGap.
  gridRow: { gap: GRID_GAP, paddingHorizontal: GRID_PADDING },
  gridHeader: { paddingBottom: 8 },
  rowGap: { height: GRID_GAP },
  // Width and height are supplied at the call site -- see the note above.
  // The real size is `tileSize`, computed from the window width -- which lane A2 cannot
  // resolve, because it is a DECLARATION check rather than a geometry one and refuses to
  // pretend otherwise. This is the floor a tile never goes below, declared so the audit
  // can see it: a three-column grid at 402pt gives ~120.
  tile: { borderRadius: 6, minWidth: 44, minHeight: 44 },
  // GRID_PADDING, not a fresh number: this line is a sibling of the grid rather than a
  // child of it, so it inherits no gutter and would render flush at x=0. Caught by the
  // gutter gate added in note X -- which exists because exactly this shipped once.
  retention: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 18,
    marginBottom: 8,
    paddingHorizontal: GRID_PADDING,
  },
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
  waitingWrap: { position: 'absolute', left: 0, right: 0, bottom: 6, alignItems: 'center' },
  waiting: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: border },
  waitingText: { fontSize: 11 },
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
