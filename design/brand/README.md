# Brand source

`runit-logo.svg` is the source of truth for every icon the app ships. `tools/make-icons.mjs`
rasterises it; `pnpm icons` runs that and checks the output. **Nothing in `assets/` is drawn
by hand** — regenerate it, never edit it.

```
pnpm icons        # rewrites assets/*.png from this SVG, and asserts each one
```

## The mark

The capital `I` of RunIt **is** a spotlight: a squared amber stem standing on the baseline,
wearing a glowing lens where a capital has no business carrying a dot. The beam it throws
crosses `Run` and pools under the word.

The trick is that the light source and the letter are the same object — remove the lamp and
the word is misspelled. It reads as a wordmark whether or not anyone notices, which was the
brief.

`Run` and `t` are outlined glyph paths, not text, so **nothing here depends on a font**. That
matters in this repo specifically: no font is pinned, and the host and the checks container
render type about 5.5% differently (FIDELITY note 6). A wordmark set as live text would
rasterise differently depending on which machine ran the generator.

## Two things that were measured, not assumed

**The wordmark survives icon sizes, and the previous icon's rationale was wrong about this.**
`8f97859` rejected a wordmark because it "would not survive being 40px on a home screen" —
but a home-screen icon is 60 **points**, which is **180px** on a 3× device. Rendered at the
sizes iOS actually uses, it is crisp at 180 and 120, readable at 80 and 60. Only 40px, which
is notification scale, fails — and that is why the notification icon is a different mark.

**Cropping to the spotlight alone does not work.** The lamp is 86×392 units, so no square
crop contains it without clipping it or importing the `n` and the `t` — which spells `nIt`.
The notification mark is therefore *drawn* from the lamp's coordinates rather than cropped
out of the logo. Recorded so it is not retried.

## The trap in generating from this file

**The artwork animates.** A 6.4s SMIL beam-swing with `fill="freeze"`. Screenshot it at t=0
and you get a mid-swing beam and a dim lens — a wrong icon that looks entirely plausible.
`make-icons.mjs` waits `SETTLE_MS = 7500`. Verified rather than trusted: the t=0 and settled
renders differ, 621,790 vs 628,666 bytes.

`letterform.html` beside this file is the decision record for the letterform, with both
candidates live at every icon size.

## The palette is brand-only

The amber does **not** enter `design/theme.css` or `src/theme/tokens.ts`, and no screen uses
it. `theme.css` is the imported canvas spec and `tokens.test.ts` re-parses it, so adding a
token there is a change to the design source of truth rather than a branding tweak.

The mark does reach into the app's palette in two places, deliberately: `#E8D4B8` is
`tokens.dark.secondary` and `#38BDF8` is `tokens.dark.accent`, so the ivory letterforms and
the cool atmospheric wash are the app's own colours rather than near-misses of them.
