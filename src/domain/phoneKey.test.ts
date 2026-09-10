import { readFileSync } from 'fs';
import { join } from 'path';

import { phoneKey } from './phoneKey';

/**
 * THE THIRD DESIGN-SOURCE GUARD, and the same doctrine as the two before it: the fold that
 * decides "same person" lives in SQL under a unique index, and this file exists only so the
 * in-memory adapter agrees with it. If they drift, Lane B goes green over a guest list the
 * real backend deduplicates differently.
 */
const SQL = readFileSync(join(__dirname, '../../supabase/migrations/00000000000000_schema.sql'), 'utf8');

describe('phoneKey mirrors the migration', () => {
  it('the migration still defines phone_key, and still folds to the last ten digits', () => {
    // A coverage floor. If the function is renamed or its body rewritten, the mirroring
    // below is comparing this file to itself and proving nothing at all.
    const at = SQL.indexOf('create or replace function public.phone_key');
    expect(at).toBeGreaterThan(-1);
    const body = SQL.slice(at, SQL.indexOf('$$;', at));
    expect(body).toContain("regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')");
    expect(body).toContain('right(');
    expect(body).toContain(', 10)');
  });

  it('the index that enforces it is PARTIAL, or a phone-only list collides on NULL', () => {
    // Two invitees with no phone must not conflict with each other. A non-partial unique
    // index over an expression of a nullable column is a different bug in each engine;
    // this one is explicit.
    expect(SQL).toContain(
      'create unique index invitees_event_phone on public.invitees (event_id, public.phone_key(phone))',
    );
    const at = SQL.indexOf('create unique index invitees_event_phone');
    expect(SQL.slice(at, at + 200)).toContain('where phone is not null');
  });

  it('a row must carry at least one way to reach somebody', () => {
    expect(SQL).toContain('check (email is not null or phone is not null)');
  });
});

describe('the fold itself', () => {
  it('folds the shapes one address book holds for one person', () => {
    const same = ['(555) 010-1234', '555-010-1234', '+1 555 010 1234', '5550101234', '1-555-010-1234'];
    const keys = new Set(same.map(phoneKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('5550101234');
  });

  it('keeps different people apart', () => {
    expect(phoneKey('555-010-1234')).not.toBe(phoneKey('555-010-1235'));
  });

  it('never throws on the junk an address book actually contains', () => {
    // Contact entries are free text. A label, an extension, an empty string — none of these
    // may crash an import of forty rows because one of them is odd.
    for (const junk of ['', '   ', 'n/a', 'ext. 4', '+', '☎️']) {
      expect(() => phoneKey(junk)).not.toThrow();
    }
    expect(phoneKey('n/a')).toBe('');
  });

  it('agrees with SQL that fewer than ten digits is simply itself', () => {
    // `right(x, 10)` on a shorter string returns the whole string; `slice(-10)` matches.
    expect(phoneKey('010-1234')).toBe('0101234');
  });
});
