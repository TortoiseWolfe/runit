import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * ONE IPHONE STORY ON EVERY PAGE -- #120.
 *
 * /beta/ sent iPhone to the public TestFlight link while /i/CODE and /help/ still said the host
 * must add your Apple ID by hand and an App Store Connect email would follow. Since the public
 * link was approved (2026-10-05) that second story is the exception, and telling it to a guest
 * standing at a party sends them to wait for an email that is not coming.
 *
 * Read from the files, minus HTML comments: the comments keep the history on purpose, and what
 * a visitor can read or run is the claim.
 */
const REPO = join(__dirname, '../..');
const live = (p: string) => readFileSync(join(REPO, p), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const PUBLIC_LINK = 'https://testflight.apple.com/join/sjVRunHc';
const PAGES = ['web/beta/index.html', 'web/i/index.html', 'web/help/index.html'];

describe('one iPhone install story (#120)', () => {
  it.each(PAGES)('%s points iPhone at the public TestFlight link', (p) => {
    expect(live(p)).toContain(PUBLIC_LINK);
  });

  it.each(PAGES)('%s no longer tells a guest the host must add their Apple ID', (p) => {
    const body = live(p);
    expect(body).not.toMatch(/Apple(&nbsp;|\s)ID/);
    expect(body).not.toContain('App Store Connect');
    expect(body).not.toContain('step from the host');
  });

  it('/beta offers the browser route outside the per-phone folds, so an iPhone sees it', () => {
    const body = live('web/beta/index.html');
    const beforeFolds = body.slice(0, body.indexOf('<div class="folds">'));
    expect(beforeFolds).toContain('href="/join"');
    expect(beforeFolds).toContain('Join in your browser');
  });
});
