import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

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
export function PhotoViewer({
  photo,
  onClose,
  onReport,
}: {
  photo: Photo | null;
  onClose: () => void;
  onReport: (p: Photo) => void;
}) {
  const { tokens, fade, isDark } = useTheme();
  const repo = useRepository();
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

  const shown = full ?? photo?.displayUrl ?? photo?.localUri ?? null;

  return (
    <Modal
      visible={photo !== null}
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
        </View>
      </Pressable>

      <View style={[s.bar, { backgroundColor: tokens.base100, borderTopColor: tokens.base300 }]}>
        <Text style={[s.by, { color: alpha(tokens.baseContent, fade.muted) }]} numberOfLines={1}>
          {photo ? photo.uploadedByName : ''}
        </Text>
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
                    ? 'Runit needs permission to add to your photos.'
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
  actions: { flexDirection: 'row', gap: 20 },
  action: { fontSize: 15, fontWeight: weight.semibold },
});
