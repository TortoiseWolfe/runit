import { MemoryRepository } from './MemoryRepository';
import { weddingSeed } from './fixtures/wedding';
import { emptySeed } from './fixtures/empty';

/**
 * #17 — the list of events this identity is staff at, and the switch between them.
 *
 * `create_event` has allowed ten events per identity since it shipped and nothing could
 * list them, so a host who closed the app could only get back to her own party by
 * remembering the code she gave her guests.
 */
const build = (seed = weddingSeed) => MemoryRepository.create(seed, { now: () => "2026-09-11T12:00:00Z" });

const read = <T,>(o: { get(): T }) => o.get();

describe('the events this identity hosts', () => {
  it('lists them, and the one you are standing in is among them', async () => {
    const repo = build();
    await repo.event.loadMine();
    const mine = read(repo.event.mine);
    expect(mine.map((e) => e.code)).toEqual(['SR1017', 'RH2210']);
    // The current event is IN the list rather than filtered out of it — a host with one
    // event would otherwise be shown an empty box while standing in the party it omitted.
    expect(mine[0]!.id).toBe(read(repo.event.current)!.id);
  });

  it('is empty for someone who hosts nothing, which is most people', async () => {
    const repo = build(emptySeed);
    await repo.event.loadMine();
    expect(read(repo.event.mine)).toEqual([]);
  });

  it('carries the seat and a headcount that excludes staff', async () => {
    const repo = build();
    await repo.event.loadMine();
    const wedding = read(repo.event.mine)[0]!;
    expect(wedding.roleLabel).toBe('Bride');
    // 172, the same number the header pill shows, because both come from guest_seats()
    // which excludes staff. A mismatch here would be a real defect, so the fixture must
    // agree with the event it describes.
    expect(wedding.guestCount).toBe(read(repo.event.current)!.guestCount);
  });

  it('opens another event, and the session holds a host seat there', async () => {
    const repo = build();
    await repo.event.loadMine();
    await repo.event.open('evt_rehearsal');

    const ev = read(repo.event.current)!;
    expect(ev.code).toBe('RH2210');
    expect(ev.name).toBe('Rehearsal Dinner');
    expect(read(repo.session.current).kind).toBe('host');
    expect(read(repo.session.holdsHostSeat)).toBe(true);
  });

  it('does not carry the last event\'s content into the next one', async () => {
    const repo = build();
    await repo.event.loadMine();
    expect(read(repo.chat.feed).length).toBeGreaterThan(0);

    await repo.event.open('evt_rehearsal');
    // Empty rather than pretend: Memory holds one event's rows. Carrying the wedding's
    // announcements into the rehearsal dinner would be worse than showing none.
    expect(read(repo.chat.feed)).toEqual([]);
    expect(read(repo.music.queue)).toEqual([]);
    expect(read(repo.photos.approved)).toEqual([]);
  });

  it('refuses an event this identity holds no seat at', async () => {
    const repo = build();
    await repo.event.loadMine();
    await expect(repo.event.open('evt_somebody_elses')).rejects.toThrow(/do not hold a host seat/i);
    // And leaves you where you were, rather than half-switched.
    expect(read(repo.event.current)!.code).toBe('SR1017');
  });
});
