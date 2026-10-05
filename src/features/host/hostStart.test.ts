import { hostStartItems } from './hostStart';

const fresh = { invitedCount: 0, guestCount: 0, broadcasts: 0, scheduleRows: 0 };

describe('hostStartItems (spec 012)', () => {
  it('opens all three on a party nobody has touched, starting with the invitation', () => {
    const r = hostStartItems(fresh);
    expect(r.items.map((i) => i.done)).toEqual([false, false, false]);
    expect(r.firstOpen).toBe('invite');
  });

  // The two halves of the invite rule are tested apart, because deleting either clause
  // must fail something: the share sheet leaves no record, so an arrival is the only proof.
  it('counts an invitation list as inviting', () => {
    expect(hostStartItems({ ...fresh, invitedCount: 1 }).items[0]!.done).toBe(true);
  });
  it('counts somebody having joined as inviting, since sharing leaves no record', () => {
    expect(hostStartItems({ ...fresh, guestCount: 1 }).items[0]!.done).toBe(true);
  });

  it('moves the one drawn button along as each thing happens', () => {
    expect(hostStartItems({ ...fresh, guestCount: 3 }).firstOpen).toBe('announce');
    expect(hostStartItems({ ...fresh, guestCount: 3, broadcasts: 1 }).firstOpen).toBe('plan');
  });

  it('skips a step done out of order rather than insisting on the order', () => {
    expect(hostStartItems({ ...fresh, scheduleRows: 2 }).firstOpen).toBe('invite');
    expect(hostStartItems({ ...fresh, guestCount: 1, scheduleRows: 2 }).firstOpen).toBe('announce');
  });

  it('has nothing open once all three are done, which is what hides the card', () => {
    expect(hostStartItems({ invitedCount: 180, guestCount: 172, broadcasts: 4, scheduleRows: 6 }).firstOpen).toBeNull();
  });
});
