#!/usr/bin/env bash
# Every gate, in the order that fails fastest first. Any failure stops the run.
set -euo pipefail

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step "install (frozen lockfile)"
pnpm install --frozen-lockfile

step "typecheck"
pnpm typecheck

step "lint"
pnpm exec eslint src tools

step "native style audit  (colours React Native cannot parse)"
pnpm audit:styles

step "tests"
pnpm test

step "iOS bundle  (catches import cycles and missing modules without a Mac)"
pnpm exec expo export --platform ios --output-dir .export-check --clear
rm -rf .export-check

step "web export + screenshots + colour gate"
EXPO_PUBLIC_FIDELITY=1 pnpm exec expo export --platform web --output-dir dist --clear
pnpm shots

printf '\n\033[32mAll checks passed.\033[0m\n'
