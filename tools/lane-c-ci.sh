#!/usr/bin/env bash
# LANE C, THE CI HALF -- everything that happens once the emulator is up.
#
# WHY THIS IS A FILE AND NOT A `script:` BLOCK, which is the whole reason it exists.
# `reactivecircus/android-emulator-runner` splits its `script:` input on newlines and runs
# EACH LINE in its own `sh -c`. The run log proves it -- consecutive lines of one block
# appear as separate `[command] /usr/bin/sh -c ...` entries. So a multi-line block is not a
# script, it is a list of unrelated one-liners, and everything carried by shell state is
# silently lost:
#
#   set -eu                    applied to a shell that exited immediately
#   export ADB_LIBUSB=0        never reached `pnpm scan:device`
#   pnpm start &               backgrounded in a shell that then exited
#   for i in $(seq 1 60); do   torn from its `done` -- "Syntax error: end of file unexpected"
#
# Only the last of those was visible in the log, which is why the first fix (dropping the
# `set -o pipefail` bashism, f010edd) corrected a real bug and still did not reach this one.
# Three of the four failed silently, and the silent three are the dangerous ones: a lane
# that runs `scan:device` with ADB_LIBUSB unset can hang for the whole 45-minute timeout
# producing no output at all.
#
# A file also makes these semantics testable HERE. In YAML they were reachable only by
# dispatching a 22-minute job, so nothing on this machine could have caught them.
# `bash tools/lane-c-ci.sh` runs the same path locally against a running emulator.
set -euo pipefail

# adb blocks enumerating USB on WSL2 and then returns nothing, ever -- no output, no exit.
# Inert on a hosted runner and load-bearing locally, which is precisely the point of having
# one script serve both.
export ADB_LIBUSB=0

# A clean prebuild, because CAMERA and its usage strings come from config plugins and
# /android is gitignored output -- an in-place prebuild can leave a stale manifest, which is
# the exact trap #42 was filed behind.
npx expo prebuild -p android --clean

# --no-bundler: Metro is started below instead, so this script owns its lifetime.
npx expo run:android --no-bundler

# Into the workspace, not /tmp: upload-artifact cannot reasonably collect an
# absolute path outside the checkout, and `*.log` is already gitignored.
pnpm start > metro.log 2>&1 &
metro=$!
# Leave no bundler behind on any exit path, including the failing ones. Without this a
# failed scan strands a process holding 8081 for the rest of the job.
trap 'kill "$metro" 2>/dev/null || true' EXIT

# `if`, not `curl ... && break`: an AND-list whose left side fails is exactly the shape
# `set -e` reasons about differently across shells, and the readiness probe is expected to
# fail dozens of times. A condition context is exempt by specification, so this cannot
# become a silent early exit the way the block it replaces could.
ready=
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8081/status >/dev/null; then ready=1; break; fi
  sleep 2
done

if [ -z "$ready" ]; then
  echo "lane C: Metro never answered on 8081 after 120s" >&2
  tail -40 metro.log >&2
  exit 1
fi

pnpm scan:device
