# 012 — Tasks

Not started. Each line is a test first, then the code that turns it green.

- [ ] T1 `hostStart.test.ts`: all open on the fresh shape; invite done by `invitedCount` alone and
      by `guestCount` alone; `firstOpen` walks invite, announce, plan; all done returns no card.
- [ ] T2 `hints` helper: native and web halves; a throwing `localStorage` reads as "not hidden".
- [ ] T3 `HostStartCard` + `BroadcastPanel` wiring; `empty-room-share` testID moves to the invite
      button; grep `tests/e2e` for every use first.
- [ ] T4 Journey `host-start.spec.ts` on `?fresh=1`: three open items and one button; join a guest
      and the invite item ticks; send a broadcast; add a schedule row; card gone.
- [ ] T5 Journey: Hide, reload, still hidden; another event shows it.
- [ ] T6 Journey: `weddingSeed` never renders `host-start`. `[aria-disabled="true"]` count 0.
- [ ] T7 `pnpm checks:docker` green; FIDELITY note for the divergence from the canvas; bank for
      the next native build.
