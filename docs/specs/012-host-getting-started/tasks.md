# 012 — Tasks

Built 2026-10-05. Each line was a test first, then the code that turned it green.

- [x] T1 `hostStart.test.ts`: all open on the fresh shape; invite done by `invitedCount` alone and
      by `guestCount` alone; `firstOpen` walks invite, announce, plan; all done returns no card.
- [x] T2 `hints` helper: native and web halves; a throwing `localStorage` reads as "not hidden".
- [x] T3 `HostStartCard` + `BroadcastPanel` wiring; `empty-room-share` testID moves to the invite
      button; grep `tests/e2e` for every use first.
- [x] T4 Journey `host-start.spec.ts` on `?fresh=1`: three open items and one button; join a guest
      and the invite item ticks; send a broadcast; add a schedule row; card gone.
- [x] T5 Journey: Hide, reload, still hidden; another event shows it.
- [x] T6 Journey: `weddingSeed` never renders `host-start`. `[aria-disabled="true"]` count 0.
- [x] T7 FIDELITY note BF; banked for the next native build.

Notes from building it:
- T2's web half is what lane B runs; the native half (`expo-secure-store`) is proven only on a
  device.
- T5 is mutation-checked: a web hint that never saves turns the hide journey red in both schemes.
  The reload step waits 500ms for a read that resolves in a microtask, and a different party
  showing the card in the same browser is its positive control.
