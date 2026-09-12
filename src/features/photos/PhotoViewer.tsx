import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import type { Photo, PhotoId } from '@/data/types';
import { savePhotoToLibrary } from '@/lib/save';
import { useRepository } from '@/state/RepositoryProvider';
import { useToast } from '@/state/ToastProvider';
import { albumTileColor } from '@/theme/oklch';
import { alpha, useTheme, weight } from '@/theme';

/**
 * A photo, full screen — issue #38.
 *
 * Until this, tapping a photo did NOTHING. The tile was a plain `View`; only the small `⋯`
 * badge inside it was pressable, and that opens the report sheet. So a shared photo album
 * had no way to actually look at a photo — invisible while the album rendered coloured
 * placeholders (#10), and the first thing anyone reaches for now that it renders images.
 *
 * IT ASKS FOR THE FULL-SIZE COPY, and only here. The grid renders 400px thumbnails because
 * that is all a 120pt tile needs; signing the 1600px original for every tile would be ~20x
 * the bytes for pixels nobody sees. `photos.fullUrl()` resolves it on open, so the cost is
 * paid by the person who chose to look.
 *
 * THE THUMBNAIL IS SHOWN WHILE THE FULL SIZE LOADS, over the hue tile. Three layers, each
 * a real state rather than a spinner: the colour a guest already associates with this photo
 * from the grid, then the small copy they were just looking at, then the real thing. A
 * photo that cannot be signed at all stays at whichever layer it reached, which is correct
 * — it is what a pending photo somebody else uploaded is supposed to look like.
 */
/**
 * How far a finger must travel before it counts as a swipe rather than a tap that wandered.
 * 60pt is roughly a thumb's width and is what stops a mis-tap on the backdrop -- which
 * dismisses -- from being read as navigation.
 */
const SWIPE_MIN = 60;

export function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
  onReport,
}: {
  /** The album as it is on screen, in the order it is on screen. */
  photos: Photo[];
  /** Which one is open. `null` closes the viewer -- the old `photo: null` contract. */
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  onReport: (p: Photo) => void;
}) {
  const { tokens, fade, isDark } = useTheme();
  const repo = useRepository();
  /**
   * A LIST AND AN INDEX, NOT A PHOTO -- and the swap is smaller than it looks because this
   * component already coped with its photo changing underneath it. `resolved` has been keyed
   * to the photo id since it was written, precisely so a stale url cannot flash under the
   * next one's thumbnail; nothing had ever handed it a different photo.
   */
  const photo = index === null ? null : (photos[index] ?? null);
  const hasPrev = index !== null && index > 0;
  const hasNext = index !== null && index < photos.length - 1;
  /**
   * KEYED TO THE PHOTO, rather than reset when it changes.
   *
   * The obvious shape is `setFull(null)` at the top of the effect, and the React Compiler
   * rejects it -- setState synchronously inside an effect triggers cascading renders. The
   * rejection is right, and holding the id alongside the url gets the same property for
   * free: a stale url simply does not match, so the PREVIOUS photo's full-size can never
   * flash under the next one's thumbnail.
   */
  const [resolved, setResolved] = useState<{ id: PhotoId; url: string } | null>(null);
  const { show } = useToast();
  const [saving, setSaving] = useState(false);
  const full = resolved && resolved.id === photo?.id ? resolved.url : null;

  useEffect(() => {
    if (!photo) return;
    let live = true;
    void repo.photos
      .fullUrl(photo.id)
      .then((url) => {
        if (live && url) setResolved({ id: photo.id, url });
      })
      .catch(() => {
        // Staying on the thumbnail is the right outcome. A viewer that throws a toast
        // because the larger copy is slow would be worse than one that shows the smaller.
      });
    return () => {
      live = false;
    };
  }, [photo, repo]);

  /**
   * WARM THE NEIGHBOURS, because without this a carousel feels broken on a phone.
   *
   * Thumbnails are signed in bulk after every recompute, but the FULL size is resolved one
   * at a time on demand (`SignedUrls.resolveOne`) -- so every step would otherwise be a
   * fresh network round trip that nothing had started. Asking for index +/- 1 and throwing
   * the answer away costs one request and fills the same cache the next step reads;
   * `SignedUrls.resolve` already de-dupes against its in-flight set, so a fast swipe does
   * not stack requests.
   *
   * Deliberately fire-and-forget and deliberately unasserted: it changes latency, not
   * behaviour, so a test that noticed it would be asserting a timing accident.
   */
  useEffect(() => {
    if (index === null) return;
    for (const i of [index - 1, index + 1]) {
      const p = photos[i];
      if (p) void repo.photos.fullUrl(p.id).catch(() => {});
    }
  }, [index, photos, repo]);

  const shown = full ?? photo?.displayUrl ?? photo?.localUri ?? null;

  /**
   * SWIPE, the gesture every phone user reaches for first.
   *
   * `react-native-gesture-handler` is already a dependency and `GestureHandlerRootView` is
   * already mounted at the app root, so this adds nothing to the bundle -- but it is the
   * first hand-written gesture in this codebase, so it stays as small as a gesture can be: a
   * horizontal pan, one distance threshold, no spring and no shared value. The photo does
   * not track the finger; it changes when the finger lifts.
   *
   * `activeOffsetX` is what keeps it from fighting a vertical scroll, and `runOnJS` is
   * required because the handler runs on the UI thread while `onIndex` is React state.
   *
   * NO LANE HERE CAN PROVE THIS. Chromium cannot swipe, and Lane B is the only lane that
   * renders a screen in CI -- which is exactly why the buttons exist beside it and carry
   * the coverage. Witnessed on a device or not at all.
   */
  const swipe = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .onEnd((e) => {
      if (e.translationX <= -SWIPE_MIN && hasNext) runOnJS(onIndex)((index ?? 0) + 1);
      else if (e.translationX >= SWIPE_MIN && hasPrev) runOnJS(onIndex)((index ?? 0) - 1);
    });

  return (
    <Modal
      visible={index !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      {/*
        THE BACKDROP IS THE DISMISS CONTROL, matching ReportSheet. A full-screen photo with
        no visible way out is the one place a modal genuinely traps someone, so there is
        also a labelled Close button below -- `onRequestClose` alone covers Android's back
        gesture and nothing on iOS.
      */}
      <Pressable
        style={[s.backdrop, { backgroundColor: alpha(tokens.neutral, 0.92) }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close the photo"
        testID="viewer-backdrop"
      >
        <GestureDetector gesture={swipe}>
          <View
            style={[
              s.stage,
              { backgroundColor: photo ? albumTileColor(photo.hue, isDark) : 'transparent' },
            ]}
            testID="viewer-stage"
          >
            {shown ? (
              <Image
                source={{ uri: shown }}
                style={s.image}
                // `contain`, not `cover`: the grid crops to a square because a grid must,
                // and this is the one place the whole photo is meant to be visible.
                resizeMode="contain"
                testID="viewer-image"
              />
            ) : null}

            {/* THE ARROWS SIT ON THE STAGE, INSIDE THE BACKDROP'S CHILD, and that placement
                is the whole reason they work. `viewer-backdrop` is a full-screen Pressable
                whose job is to dismiss; a sibling laid over it would be fighting it for the
                same tap, and on overlap the later sibling wins rather than the smaller one.
                Nested here, the arrow is hit first and the backdrop never sees the press.

                MEASURED SIZE, NOT hitSlop. `audit:targets` accepts either, but its own
                failure text warns that slop never extends past parent bounds and that a
                sibling's z-index wins on overlap -- which is exactly this situation. 44x44
                is a real rect, well over SC 2.5.8's 24pt AA floor.

                HIDDEN AT THE ENDS RATHER THAN DISABLED. A control that is drawn and does
                nothing is the defect `aria-disabled` is this repo's gate for. The slot keeps
                its width either way, so nothing shifts when one disappears. */}
            {hasPrev ? (
              <Pressable
                onPress={() => onIndex((index ?? 0) - 1)}
                accessibilityRole="button"
                accessibilityLabel="Previous photo"
                testID="viewer-prev"
                style={[s.arrow, s.arrowLeft, { backgroundColor: alpha(tokens.neutral, 0.55) }]}
              >
                <Text style={[s.arrowText, { color: tokens.neutralContent }]}>‹</Text>
              </Pressable>
            ) : null}
            {hasNext ? (
              <Pressable
                onPress={() => onIndex((index ?? 0) + 1)}
                accessibilityRole="button"
                accessibilityLabel="Next photo"
                testID="viewer-next"
                style={[s.arrow, s.arrowRight, { backgroundColor: alpha(tokens.neutral, 0.55) }]}
              >
                <Text style={[s.arrowText, { color: tokens.neutralContent }]}>›</Text>
              </Pressable>
            ) : null}
          </View>
        </GestureDetector>
      </Pressable>

      <View style={[s.bar, { backgroundColor: tokens.base100, borderTopColor: tokens.base300 }]}>
        {/* testID'd because it is the ONLY thing on this screen that says which photo is
            open: the stage is a hue tile in every lane that runs in CI, so a carousel test
            has nothing else to compare. */}
        <Text
          testID="viewer-by"
          style={[s.by, { color: alpha(tokens.baseContent, fade.muted) }]}
          numberOfLines={1}
        >
          {photo ? photo.uploadedByName : ''}
        </Text>
        {/* WHERE YOU ARE AND HOW MUCH IS LEFT. Without it a carousel is a corridor with no
            end: a guest cannot tell whether the next tap does nothing because she is at the
            last photo or because the control is broken. `tabular-nums` so it does not jitter
            as the numbers change width. */}
        {index !== null && photos.length > 0 ? (
          <Text
            testID="viewer-position"
            style={[s.position, { color: alpha(tokens.baseContent, fade.faint) }]}
          >
            {index + 1} of {photos.length}
          </Text>
        ) : null}
        <View style={s.actions}>
          {/* Reporting stays reachable from here too. Guideline 1.2 asks that it be
              available, and a guest who has just enlarged something is the likeliest
              person to want it. */}
          {/*
            SAVE (#39). A RunIt photo exists nowhere else -- capture writes to the app's
            cache, there is no share sheet, and retention is coming. This is the only way
            anybody keeps a picture they took.

            IT SAVES WHAT IS ON SCREEN, which is the full size once it has resolved. The
            grid's 400px thumbnail would be a worse photo than the one they took, so the
            control waits rather than saving the small copy: `shown` is the full size when
            it is there and the thumbnail before that, and saving early is the one case
            where a moment's patience is obviously right.
          */}
          <Pressable
            onPress={async () => {
              const uri = full ?? photo?.localUri ?? null;
              if (!uri || saving) return;
              setSaving(true);
              const result = await savePhotoToLibrary(uri);
              setSaving(false);
              // Each outcome says something DIFFERENT and true. A refusal is not a
              // failure: they chose it, and telling them it broke would be a lie about
              // their own decision.
              show(
                result === 'saved'
                  ? 'Saved to your photos.'
                  : result === 'denied'
                    ? 'RunIt needs permission to add to your photos.'
                    : 'Could not save that photo.',
              );
            }}
            accessibilityRole="button"
            accessibilityLabel="Save this photo to your phone"
            testID="viewer-save"
            hitSlop={10}
          >
            <Text style={[s.action, { color: alpha(tokens.baseContent, fade.muted) }]}>
              {saving ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (photo) onReport(photo);
            }}
            accessibilityRole="button"
            accessibilityLabel="Report this photo or block whoever posted it"
            testID="viewer-report"
            hitSlop={10}
          >
            <Text style={[s.action, { color: alpha(tokens.baseContent, fade.muted) }]}>Report</Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            testID="viewer-close"
            hitSlop={10}
          >
            <Text style={[s.action, { color: tokens.baseContent }]}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stage: { width: '100%', aspectRatio: 1, maxHeight: '80%' },
  image: { width: '100%', height: '100%' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
  },
  by: { flex: 1, fontSize: 14 },
  position: { fontSize: 13, fontVariant: ['tabular-nums'] },
  /* 44x44 is a real measured rect, which is what `audit:targets` reads -- and what the
     audit's own warning asks for over hitSlop where a control overlaps another. */
  arrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowLeft: { left: 8 },
  arrowRight: { right: 8 },
  arrowText: { fontSize: 26, lineHeight: 30, fontWeight: weight.semibold },
  actions: { flexDirection: 'row', gap: 20 },
  action: { fontSize: 15, fontWeight: weight.semibold },
});
