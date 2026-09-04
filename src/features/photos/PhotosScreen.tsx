import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { EventHeader } from '@/features/chat/EventHeader';
import { usePhotoActions } from '@/state/actions';
import { useActiveFolder, useApprovedPhotos, useFolders } from '@/state/hooks';
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
  const { capture, selectFolder } = usePhotoActions();

  const visible = approved.filter((p) => p.folderId === active?.id);
  const totalPhotos = folders.reduce((a, f) => a + f.photoCount, 0);
  const onCapture = () => capture(active?.name ?? 'the album');

  if (visible.length === 0) {
    return (
      <View style={s.wrap}>
        <EventHeader eyebrow="Shared album" />
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

        <View style={s.grid}>
          {visible.map((p) => (
            // The testID stays on the OUTER node deliberately. The e2e suite
            // counts `tile-*` and asserts their order; wrapping the image in a
            // new parent and moving the testID would break both. The hue tile is
            // not a placeholder to be replaced -- it is the layer underneath, and
            // it stays the permanent rendering for the nine seeded rows, which
            // have no bytes and never will.
            <View
              key={p.id}
              testID={`tile-${p.id}`}
              style={[
                s.tile,
                { width: tileSize, height: tileSize, backgroundColor: albumTileColor(p.hue, isDark) },
              ]}
            >
              {p.localUri ? (
                <Image source={{ uri: p.localUri }} style={s.tileImage} resizeMode="cover" />
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>

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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    paddingVertical: 8,
    paddingHorizontal: GRID_PADDING,
  },
  // Width and height are supplied at the call site -- see the note above.
  tile: { borderRadius: 6 },
  // Fills the tile it sits inside; the tile owns the size.
  tileImage: { width: '100%', height: '100%' },

  albumBar: { alignItems: 'center', paddingTop: 14, paddingBottom: 10, borderTopWidth: border },
  shutterSmall: {
    width: 84, height: 84, borderRadius: 42, borderWidth: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  shutterSmallInner: { width: 62, height: 62, borderRadius: 31 },
});
