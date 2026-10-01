import type { Photo } from '@/data/types';
import { followViewing, viewerControls, viewerList } from './viewerList';

const photo = (id: string, status: Photo['status'], folderId = 'f1'): Photo =>
  ({
    id,
    folderId,
    status,
    uploadedByGuestId: 'g1',
    uploadedByName: 'Ada',
    hue: 0,
    localUri: null,
    createdAt: '2026-10-17T20:00:00.000Z',
  }) as unknown as Photo;

describe('viewer list (spec 001b)', () => {
  it('puts own waiting photos first, then the approved ones, and leaves sending and failed out', () => {
    const mineHere = [photo('u1', 'uploading'), photo('w1', 'pending'), photo('x1', 'failed'), photo('w2', 'pending')];
    const visible = [photo('a1', 'approved'), photo('a2', 'approved')];
    expect(viewerList(mineHere, visible).map((p) => p.id)).toEqual(['w1', 'w2', 'a1', 'a2']);
  });

  it('never lists a photo twice', () => {
    const ids = viewerList([photo('w1', 'pending')], [photo('w1', 'approved'), photo('a1', 'approved')]).map((p) => p.id);
    expect(ids).toEqual(['w1', 'a1']);
  });

  it('a waiting photo shows the mark and offers neither Save nor Report', () => {
    expect(viewerControls(photo('w1', 'pending'))).toEqual({ waiting: true, save: false, report: false });
  });

  it('an approved photo is unchanged: no mark, Save and Report', () => {
    expect(viewerControls(photo('a1', 'approved'))).toEqual({ waiting: false, save: true, report: true });
  });

  it('follows the id when the photo moves (approve while open)', () => {
    const list = [photo('a1', 'approved'), photo('w1', 'approved')];
    expect(followViewing(list, { id: 'w1', at: 0 })).toEqual({ id: 'w1', at: 1 });
  });

  it('returns the same object when nothing moved', () => {
    const v = { id: 'a1', at: 0 };
    expect(followViewing([photo('a1', 'approved')], v)).toBe(v);
  });

  it('moves to the next photo when the open one is hidden', () => {
    const list = [photo('a1', 'approved'), photo('a3', 'approved')];
    expect(followViewing(list, { id: 'a2', at: 1 })).toEqual({ id: 'a3', at: 1 });
  });

  it('closes when the hidden photo had no next', () => {
    expect(followViewing([photo('a1', 'approved')], { id: 'a2', at: 1 })).toBeNull();
  });

  it('stays closed', () => {
    expect(followViewing([photo('a1', 'approved')], null)).toBeNull();
  });
});
