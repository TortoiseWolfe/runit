#!/usr/bin/env node
/**
 * THE GUEST BUILD IS NOT THE HARNESS BUILD, AND ONE ENVIRONMENT VARIABLE IS THE ONLY
 * DIFFERENCE BETWEEN THEM (#78).
 *
 * `EXPO_PUBLIC_FIDELITY=1` is this repo's seam for "the browser is not the phone". It is
 * correct in a harness and catastrophic in front of a person, because several web halves
 * branch on it:
 *
 *   capture.web.ts:113          a synthetic 1x1 PNG instead of their camera roll
 *   musicSearch.web.ts:67       four fixture songs instead of a catalogue
 *   QrScanner.web.tsx:27        a fake scan button feeding a hardcoded code
 *   save.web.ts:19              a save that reports success and writes nothing
 *
 * `export:web:live` sets BOTH flags, because lane H drives the shipping ADAPTER through the
 * harness. It is therefore the obvious script to copy when somebody wants "the Supabase web
 * build", and copying it ships every stub above to a guest. Nothing else here can tell the
 * two apart: the flag is inlined by Metro at bundle time, so by the time there is a bundle
 * the decision is already made and invisible.
 *
 * STATIC AND CREDENTIAL-FREE, so it runs in the normal sequence -- the shape `audit:cli-pin`
 * established. It reads the DECLARATIONS in package.json rather than exporting anything,
 * because an export costs minutes to learn what one line already says. When a build happens
 * to be on disk it checks that too, which is the only way to catch a flag reaching the bundle
 * by some route other than the script.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts ?? {};
const problems = [];

/** Every script that produces a web bundle, and what each one is FOR. */
const GUEST = 'export:web:guest';
const exports_ = Object.entries(scripts).filter(([, cmd]) => /expo export --platform web/.test(cmd));

/*
 * COVERAGE FLOOR, the doctrine lanes A, A2 and E all carry: a matcher that stops matching
 * reports no problems having read nothing. Three web exports exist -- the harness, lane H's,
 * and the guest one. Fewer than that means this gate has gone blind rather than green.
 */
const MIN_EXPORTS = 3;
if (exports_.length < MIN_EXPORTS) {
  problems.push(
    `only ${exports_.length} web export script(s) matched, expected at least ${MIN_EXPORTS}. ` +
      'Either one was renamed out of this gate\'s sight, or the guest build is gone.',
  );
}

const guestCmd = scripts[GUEST];
if (!guestCmd) {
  problems.push(`there is no \`${GUEST}\` script. The shippable browser build is what #78 added.`);
} else {
  if (/EXPO_PUBLIC_FIDELITY/.test(guestCmd)) {
    problems.push(
      `\`${GUEST}\` sets EXPO_PUBLIC_FIDELITY. That is the harness flag, and it is the whole ` +
        'reason this gate exists -- see the table above for what a guest would get.',
    );
  }
  if (!/EXPO_PUBLIC_BACKEND=supabase/.test(guestCmd)) {
    problems.push(
      `\`${GUEST}\` does not set EXPO_PUBLIC_BACKEND=supabase, so it would ship ` +
        'MemoryRepository -- a fixture wedding, to a real guest, with no backend at all.',
    );
  }
  const out = guestCmd.match(/--output-dir\s+(\S+)/)?.[1];
  if (!out) {
    problems.push(`\`${GUEST}\` names no --output-dir, so it cannot be told apart from a harness build.`);
  } else {
    for (const [name, cmd] of exports_) {
      if (name === GUEST) continue;
      if (cmd.match(/--output-dir\s+(\S+)/)?.[1] === out) {
        problems.push(
          `\`${GUEST}\` and \`${name}\` both write to ${out}. Whichever ran last is what gets ` +
            'deployed, which is the confusion this gate exists to prevent.',
        );
      }
    }
  }
}

/*
 * AND THE ARTEFACT, WHEN THERE IS ONE. The script is a declaration; this is the bundle. A
 * flag could reach it from `.env`, from a shell export, or from a CI job that sets it for
 * every step -- none of which package.json can see. Absent, this says so rather than passing:
 * a check that silently measures nothing is the thing lane E spent a year being.
 */
const DIST = join(ROOT, 'dist-guest');
let bundleVerdict;
if (!existsSync(DIST)) {
  bundleVerdict = `no dist-guest/ on disk, so the BUNDLE was not checked. Run \`pnpm ${GUEST}\` to include it.`;
} else {
  const jsDir = join(DIST, '_expo/static/js/web');
  const bundles = existsSync(jsDir) ? readdirSync(jsDir).filter((f) => f.endsWith('.js')) : [];
  if (bundles.length === 0) {
    problems.push('dist-guest/ exists but holds no web bundle. A half-written export is not a build.');
  } else {
    for (const b of bundles) {
      const src = readFileSync(join(jsDir, b), 'utf8');
      /*
       * THE MARKERS WERE MEASURED IN BOTH DIRECTIONS, not guessed -- and the first guess was
       * wrong, which is why this comment carries numbers. `EXPO_PUBLIC_FIDELITY` is INLINED
       * by Metro, so the flag NAME is absent from every bundle and matching on it would pass
       * identically on both builds. What differs is what survives minification once the
       * inlined comparison folds to a constant:
       *
       *                                            dist/ (harness)   dist-guest/
       *   qr-simulate                                     1               0
       *   scheme-probe                                    1               0
       *   "Scanning needs the RunIt app on a phone"        1               1
       *
       * TWO PRESENCE MARKERS, NOT ONE, and they live in different files -- QrScanner.web.tsx
       * and _layout.tsx. A single marker that gets renamed leaves this gate green having
       * measured nothing; two make that take two unrelated edits.
       *
       * AND ONE ABSENCE MARKER, which is the half that catches a STALE gate: the honest web
       * copy is in both builds, so if it ever stops matching the strings have moved and this
       * whole check has gone blind. That fails rather than passing.
       */
      for (const marker of ['qr-simulate', 'scheme-probe']) {
        if (src.includes(marker)) {
          problems.push(
            `${b} contains \`${marker}\`, which survives minification only when ` +
              'EXPO_PUBLIC_FIDELITY=1 was set at build time. This is a harness bundle.',
          );
        }
      }
      if (!src.includes('Scanning needs the RunIt app on a phone')) {
        problems.push(
          `${b} does not carry the honest web scanner copy, which is in BOTH builds. Either ` +
            'QrScanner.web.tsx was reworded or these markers have gone stale -- and a stale ' +
            'marker is a gate that reports green having measured nothing.',
        );
      }
    }
    bundleVerdict = `${bundles.length} bundle(s) in dist-guest/ carry the honest web copy and no harness control.`;
  }
}

if (problems.length) {
  console.error(red('FAIL: the guest web build is not distinguishable from the harness one.'));
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(green(`OK: ${exports_.length} web export scripts; \`${GUEST}\` carries the backend flag and not the harness one.`));
console.log(bundleVerdict.startsWith('no dist-guest') ? yellow(`  note: ${bundleVerdict}`) : `  ${bundleVerdict}`);
