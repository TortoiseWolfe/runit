/**
 * "The same person", when what you have is a phone number — issue #60.
 *
 * THE AUTHORITY IS SQL. `public.phone_key(phone)` sits under a partial unique index on
 * `invitees`, and that index is what actually stops one person appearing twice: a check in a
 * client is bypassed by the second client, and a host importing her contacts twice would
 * otherwise double every row.
 *
 * This exists so `MemoryRepository` behaves the same way, and `phoneKey.test.ts` pins the two
 * together by re-parsing the migration's own function body — the same shape as `songKey.ts`,
 * `tokens.test.ts` re-parsing `theme.css`, and `tiers.test.ts` re-parsing the caps seed.
 *
 * DE-DUPLICATION, NOT VALIDATION. It never refuses a number. It decides whether two of them
 * are the same person, which is the only question `invitees` asks. Nothing in this product
 * dials anything, so a wrong fold costs a duplicate row — never a message to a stranger.
 *
 * LAST TEN DIGITS, AND THAT IS US-CENTRIC ON PURPOSE. One person's number appears in an
 * address book as `(555) 010-1234`, `555-010-1234` and `+1 555 010 1234` across a decade of
 * phones, and all three must fold together. An international number folds on its final ten
 * digits, which is enough to stop one person entering twice from one phone and is not enough
 * to be a general identity. Said out loud here rather than discovered later.
 */
export function phoneKey(phone: string): string {
  return (phone ?? '').replace(/[^0-9]/g, '').slice(-10);
}
