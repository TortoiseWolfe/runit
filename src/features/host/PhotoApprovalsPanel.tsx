import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatRelative } from '@/lib/format';
import { usePhotoActions } from '@/state/actions';
import { useActiveFolder, useEvent, useFolders, usePendingPhotos } from '@/state/hooks';
import { TIERS } from '@/domain/tiers';
import { capLabel } from '@/domain/entitlements';
import {
  alpha, border, eyebrow, fade, pendingPhotoColor, radius, useTheme, weight,
} from '@/theme';

/** Artboard 03, Photos segment. */
export function PhotoApprovalsPanel() {
  const { tokens, isDark } = useTheme();
  const pending = usePendingPhotos();
  const folders = useFolders();
  const active = useActiveFolder();
  const event = useEvent();
  const { approve, hide, addFolder, selectFolder } = usePhotoActions();

  const tier = TIERS[event?.tier ?? 'house_party'];
  const folderCap = capLabel(
    { tier, usage: { guests: event?.guestCount ?? 0, hosts: 0, photosStored: 0, folders: folders.length } },
    'folders',
  );
  const atFolderCap = folders.length >= tier.limits.maxFolders;

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content} testID="host-photos">
      <Text style={[s.section, { color: alpha(tokens.baseContent, fade.muted) }]}>
        Awaiting approval · {pending.length}
      </Text>

      {pending.map((p) => (
        <View
          key={p.id}
          style={[s.row, { borderColor: tokens.base300, backgroundColor: tokens.base200 }]}
        >
          <View style={[s.thumb, { backgroundColor: pendingPhotoColor(p.hue, isDark) }]} />
          <View style={s.rowBody}>
            <Text style={[s.by, { color: tokens.baseContent }]} numberOfLines={1}>
              {p.uploadedByName}
            </Text>
            <Text style={[s.meta, { color: alpha(tokens.baseContent, fade.muted) }]} numberOfLines={1}>
              {formatRelative(p.createdAt)} · → {folders.find((f) => f.id === p.folderId)?.name ?? ''}
            </Text>
          </View>
          <Pressable
            onPress={() => hide(p.id)}
            accessibilityRole="button"
            accessibilityLabel={`Hide photo from ${p.uploadedByName}`}
            testID={`hide-${p.id}`}
            style={[s.ghost, { borderColor: tokens.base300 }]}
          >
            <Text style={[s.ghostText, { color: tokens.baseContent }]}>Hide</Text>
          </Pressable>
          <Pressable
            onPress={() => approve(p.id)}
            accessibilityRole="button"
            accessibilityLabel={`Approve photo from ${p.uploadedByName}`}
            testID={`approve-${p.id}`}
            style={[s.approve, { backgroundColor: tokens.success }]}
          >
            <Text style={[s.approveText, { color: tokens.successContent }]}>Approve</Text>
          </Pressable>
        </View>
      ))}

      {pending.length === 0 && (
        <View style={[s.empty, { borderColor: tokens.base300 }]}>
          <Text style={[s.emptyText, { color: alpha(tokens.baseContent, fade.muted) }]}>
            All caught up.
          </Text>
        </View>
      )}

      <View style={s.sectionHead}>
        <Text style={[s.section, { color: alpha(tokens.baseContent, fade.muted) }]}>Folders</Text>
        <Pressable
          onPress={() => addFolder(`Folder ${folders.length + 1}`)}
          disabled={atFolderCap}
          accessibilityRole="button"
          accessibilityState={{ disabled: atFolderCap }}
          accessibilityHint={atFolderCap ? `Your plan allows ${folderCap} folders` : undefined}
          testID="add-folder"
        >
          <Text style={[s.link, { color: atFolderCap ? alpha(tokens.baseContent, fade.faint) : tokens.accent }]}>
            {atFolderCap ? `${folderCap} · Upgrade` : '+ New folder'}
          </Text>
        </Pressable>
      </View>

      {folders.map((f) => {
        const on = f.id === active?.id;
        return (
          <Pressable
            key={f.id}
            onPress={() => selectFolder(f.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            testID={`host-folder-${f.id}`}
            style={[
              s.folderRow,
              { borderColor: tokens.base300, backgroundColor: on ? tokens.primary : 'transparent' },
            ]}
          >
            <Text style={[s.folderName, { color: on ? tokens.primaryContent : tokens.baseContent }]}>
              {f.name}
            </Text>
            <Text
              style={[
                s.folderMeta,
                { color: alpha(on ? tokens.primaryContent : tokens.baseContent, fade.body) },
              ]}
            >
              {f.photoCount} photos · {on ? 'active' : 'closed'}
            </Text>
          </Pressable>
        );
      })}

      <Text style={[s.helper, { color: alpha(tokens.baseContent, fade.faint) }]}>
        Guest uploads land in the active folder. {tier.name} plan:{' '}
        {Number.isFinite(tier.limits.maxFolders) ? `${tier.limits.maxFolders} folders` : 'unlimited folders'},{' '}
        {Number.isFinite(tier.limits.maxPhotos) ? `${tier.limits.maxPhotos} photos` : 'unlimited photos'}.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingVertical: 16, paddingHorizontal: 20, gap: 12 },
  section: { ...eyebrow.section, fontSize: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10,
    borderRadius: radius.selector, borderWidth: border,
  },
  thumb: { width: 64, height: 64, borderRadius: 10 },
  rowBody: { flex: 1, minWidth: 0 },
  by: { fontSize: 14, fontWeight: weight.medium },
  meta: { fontSize: 12 },
  ghost: { height: 34, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: border, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 12 },
  approve: { height: 34, paddingHorizontal: 12, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  approveText: { fontSize: 12, fontWeight: weight.semibold },
  empty: {
    padding: 24, alignItems: 'center', borderRadius: radius.selector,
    borderWidth: border, borderStyle: 'dashed',
  },
  emptyText: { fontSize: 14 },
  link: { fontSize: 13 },
  folderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.selector, borderWidth: border,
  },
  folderName: { fontSize: 15, fontWeight: weight.medium },
  folderMeta: { fontSize: 12 },
  helper: { fontSize: 12, lineHeight: 18 },
});
