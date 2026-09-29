# 001 — Tasks

- [x] T1 Failing test: SupabaseRepository `photos.mine` includes own pending row, excludes
      another guest's pending row and any host's view
- [x] T2 Failing test: overlay row and landed row for the same id appear once
- [x] T3 Implement in SupabaseRepository.recompute (sigMine)
- [x] T4 Mirror in MemoryRepository + its test
- [x] T5 PhotosScreen: "Waiting for host" tile mark (viewer: follow-up 001b)
- [x] T6 Delete the "real gap" docblock
- [x] T7 Lane B journey (flaky/moderated seed): mark shown, absent for second context,
      cleared on approve, removed on hide
- [ ] T8 Lane H: two-context check against the live project
- [ ] T9 `pnpm checks:docker` green; update CLAUDE.md photo paragraph

NOTE: T1-T7 were written in a session with NO npm registry access (403), so NONE of them has
been run. T8 and T9 are open, and T9 must run before this is trusted.
