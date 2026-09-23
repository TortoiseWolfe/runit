import { readFileSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '..', '..', 'supabase', 'templates');
const read = (f: string) => readFileSync(join(dir, f), 'utf8');

/**
 * THREE TEMPLATES, AND GOTRUE PICKS BY SITUATION: `confirmation` the first time an address
 * is seen, `magic_link` every time after, `email_change` for the attach branch. The first
 * two are byte-identical ON PURPOSE -- a host's first sign-in and her second must read the
 * same -- and nothing guarded that. Edit one and not the other and the product reads as
 * intermittent: the code arrives in a different shape depending on whether GoTrue has met
 * the address before. A duplicate-file sweep would flag them; this is why it must not.
 */
describe('the sign-in email templates', () => {
  it('show a first-time host and a returning host the same email', () => {
    expect(read('confirmation.html')).toBe(read('magic_link.html'));
  });

  /**
   * No `{{ .ConfirmationURL }}` in any of them -- not for tidiness, but because tapping it
   * SPENDS the one-use token the person is about to type, so the link destroys the code.
   * Five real sign-in emails once landed carrying Supabase's default body with that link
   * and no six-digit code at all (FIDELITY AZ).
   */
  it.each(['confirmation.html', 'magic_link.html', 'email_change.html'])(
    '%s carries the code and never the link that would consume it',
    (file) => {
      const html = read(file);
      expect(html).not.toMatch(/\.ConfirmationURL/);
      expect(html).toMatch(/\{\{\s*\.Token\s*\}\}/);
    },
  );
});
