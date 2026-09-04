#!/usr/bin/env bash
# Every gate, in the order that fails fastest first. Any failure stops the run.
set -euo pipefail

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

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

# Same doctrine, the axis that was left unguarded. The base image ships exactly
# ONE browser set, and pnpm blocks the post-install download that would otherwise
# heal a mismatch -- so @playwright/test and the image tag have to agree. This
# fails loudly and prints the fix, unlike the Node drift which was silent.
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

step "install (frozen lockfile)"
pnpm install --frozen-lockfile

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

step "tests"
pnpm test

step "policy verification  (lane E -- skips LOUDLY without SUPABASE_DB_URL)"
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

step "end-to-end journeys  (Playwright, 402x874, dark + light)"
pnpm exec playwright test

printf '\n\033[32mAll checks passed.\033[0m\n'
