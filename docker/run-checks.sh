#!/usr/bin/env bash
# Every gate, in the order that fails fastest first. Any failure stops the run.
set -euo pipefail

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

# A LANE THAT SKIPPED MEASURED NOTHING, AND THE LAST LINE USED TO SAY "All checks passed"
# EITHER WAY.
#
# Two lanes skip by design rather than fail: lane E needs a database password and lane G
# needed a host that did not exist. Skipping is right -- a gate that fails for want of a
# credential gets switched off within a week, which is written down in both tools. What was
# wrong is that the SUMMARY did not distinguish them. Lane E skipped on every run for the
# life of this repo while the board said everything passed, and a duplicate variable
# declaration meant it had not compiled for a day underneath that green line.
#
# So the skips are collected and named at the end. `grep -q` on the lane's own SKIPPED
# marker rather than a second source of truth: the lane already prints what went unchecked,
# and this only makes sure the last thing on screen cannot contradict it.
SKIPPED_LANES=()
lane() {
  local label="$1"; shift
  local out rc
  set +e
  out="$("$@" 2>&1)"
  rc=$?
  set -e
  printf '%s\n' "$out"
  [ "$rc" -ne 0 ] && return "$rc"
  case "$out" in *SKIPPED:*) SKIPPED_LANES+=("$label") ;; esac
  return 0
}

# The image's Node must be the Node this repo declares. Without this assertion
# the Playwright base tag silently selects the runtime: the checks ran on
# v22.18.0 while development ran on v24.13.0, and nothing said a word.
step "node version matches .nvmrc"
want="$(tr -d '[:space:]' < .nvmrc)"
have="$(node -p 'process.versions.node')"
if [ "$want" != "$have" ]; then
  printf '\033[31mFAIL\033[0m: .nvmrc wants Node %s, this container has %s.\n' "$want" "$have" >&2
  printf 'Bump NODE_VERSION and NODE_SHA256 in docker/checks.Dockerfile to match .nvmrc,\n' >&2
  printf 'or change .nvmrc. Do not let the base image decide.\n' >&2
  exit 1
fi
echo "  Node $have (matches .nvmrc)"

step "install (frozen lockfile)"
pnpm install --frozen-lockfile

# Same doctrine as the Node assertion, on the axis that was left unguarded: the base
# image ships exactly ONE browser set, and pnpm blocks the post-install download that
# would otherwise heal a mismatch -- so @playwright/test and the image tag have to
# agree. This fails loudly and prints the fix, unlike the Node drift which was silent.
#
# IT MUST RUN AFTER THE INSTALL, and it used to run before it. The assertion reads
# node_modules/@playwright/test/package.json, and on a COLD machine there is no
# node_modules yet -- which is EVERY CI run, because the named volume is created fresh
# each time. It passed locally only because that volume survives between runs. So the
# gate worked on a warm machine and failed on a cold one, and CI was red here, at step
# two, before reaching a single real check. The Node assertion above stays first
# because it reads process.versions.node and needs nothing installed.
step "playwright version matches the base image"
want_pw="$(grep -oP 'playwright:v\K[0-9]+\.[0-9]+\.[0-9]+' docker/checks.Dockerfile)"
have_pw="$(node -p "require('@playwright/test/package.json').version")"
if [ "$want_pw" != "$have_pw" ]; then
  printf '\033[31mFAIL\033[0m: docker/checks.Dockerfile is on playwright v%s, node_modules has %s.\n' \
    "$want_pw" "$have_pw" >&2
  printf 'The image ships one browser set and pnpm blocks the healing download.\n' >&2
  printf 'Pin them together: the image tag, and "@playwright/test" in package.json.\n' >&2
  exit 1
fi
echo "  Playwright $have_pw (matches the base image tag)"

step "typecheck"
pnpm typecheck

step "lint"
pnpm exec eslint src tools tests

step "native style audit  (colours React Native cannot parse)"
pnpm audit:styles

# Same static band, same doctrine, different failure. This is the ONLY lane that
# can see a touch target at all: react-native-web drops hitSlop, so Lane B would
# keep failing after a correct fix, and uiautomator reports a11y-tree bounds
# rather than touch rects, so Lane C is blind too.
step "touch target audit  (WCAG 2.2 SC 2.5.8, Level AA)"
pnpm audit:targets

# Static, and in the same band as the two audits above for the same reason: no
# other lane can see this. A tier that grants a feature nothing reads sells
# nothing, and the failure is invisible until money changes hands -- which is
# precisely when nobody is re-reading tiers.ts.
# Third in the static band, and for the same reason as the two above: no lane that
# runs in CI can see a soft keyboard. Chromium has none to raise, react-native-web
# renders KeyboardAvoidingView as a plain View with `behavior` stripped, and its View
# filters keyboardShouldPersistTaps/submitBehavior out before they reach the DOM -- so
# a Playwright assertion passes identically on a correct fix and on no fix at all.
step "keyboard audit  (a text field the keyboard covers is a screen you cannot use)"
pnpm audit:keyboard

step "tier claim audit  (the ladder may not advertise what nothing enforces)"
pnpm audit:tiers

step "brand casing audit  (the product is RunIt; eight strings said Runit)"
pnpm audit:brand

step "tests"
pnpm test

step "SQL declare audit  (lane E cannot compile with a duplicate, and skips silently)"
pnpm audit:sql

step "policy verification  (lane E -- skips LOUDLY without SUPABASE_DB_URL)"
lane "lane E -- row-level security behaviour (needs SUPABASE_DB_URL, or a local stack: docs/lane-e.md)" \
  node tools/verify-policies.mjs

step "iOS bundle  (catches import cycles and missing modules without a Mac)"
pnpm exec expo export --platform ios --output-dir .export-check --clear
rm -rf .export-check

step "web export + screenshots + colour gate"
EXPO_PUBLIC_FIDELITY=1 pnpm exec expo export --platform web --output-dir dist --clear
pnpm shots

# Reuses the dist/ built directly above -- and depends on it having been built
# with EXPO_PUBLIC_FIDELITY=1, because the `scheme-probe` element every test
# waits on only renders under that flag (src/app/_layout.tsx:48). Exporting
# without it produces a bundle whose every test times out on the first await.
step "QR decode  (the only check that reads what the QR actually encodes)"
node tools/verify-qr.mjs

# Lane G. Skips LOUDLY until Cloudflare Pages is connected, like lane E -- the host has to
# be created by a human in a browser, and a gate nobody can turn green gets deleted.
#
# It reads the BODY back, not the status. `runit.pages.dev` was in INVITE_ORIGIN for one
# commit and answers 200 on every path with a stranger's OAuth callback page, so a status
# check would have passed while every QR pointed at somebody else's website.
step "invitation host  (lane G -- skips LOUDLY until Cloudflare Pages is connected)"
lane "lane G -- the invitation host serves OUR association file" \
  node tools/verify-links.mjs

step "end-to-end journeys  (Playwright, 402x874, dark + light)"
pnpm exec playwright test

if [ "${#SKIPPED_LANES[@]}" -eq 0 ]; then
  printf '\n\033[32mAll checks passed.\033[0m\n'
else
  # GREEN, BECAUSE NOTHING FAILED -- and qualified, because not everything ran. Saying
  # "All checks passed" over a lane that measured nothing is the sentence this repo has
  # spent a session removing from its other gates.
  printf '\n\033[32mEvery check that RAN passed\033[0m \033[33m-- %s lane(s) skipped and measured nothing:\033[0m\n' \
    "${#SKIPPED_LANES[@]}"
  for l in "${SKIPPED_LANES[@]}"; do printf '\033[33m  · %s\033[0m\n' "$l"; done
fi
