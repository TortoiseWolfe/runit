# Open-source building blocks (canvas section 05)

Transcribed from the design canvas. These are first-look notes by the designer,
not decisions. Verify licences and current state before committing to any.

The recurring theme: use these as **backends behind a thin Expo app**, rather
than forking a large client.

| Project | Licence | Fit | Note |
|---|---|---|---|
| **Nextcloud** | AGPL server · GPL iOS client (Swift) | Backend, not fork | Its iOS app is open source but is a general file-sync client and a heavy codebase to bend into a three-tab guest app. Better: run Nextcloud as the photo store and talk to it over WebDAV / the Photos API. Per-event folders map cleanly to shares. |
| **Immich** | AGPL · Flutter mobile | Photo backend | Self-hosted photo platform with shared albums, upload links and a solid API. Closer to what guests expect than Nextcloud Files. Still a backend play; the Flutter client is not Expo. |
| **Gancio** | AGPL · Node | Post-MVP calendar | Federated (ActivityPub) event calendar for local communities. The in-app run of show covers what happens tonight; Gancio covers finding the event in the first place. Hosts publish from the app; guests never see Gancio. |
| **Matrix / Synapse** | Apache-2.0 | Broadcast channel | Rooms with power levels give announcement-only channels, push and read receipts for free. `matrix-js-sdk` works in React Native. Over-powered for 3 guests, right-sized for 3,000. |
| **Supabase / PocketBase** | Apache-2.0 / MIT | Fastest MVP | Realtime Postgres (or a single Go binary) with auth, storage and row-level security. Anonymous nickname join, upvote counts and approval flags are a few tables. |
| **Mopidy / Snapcast** | Apache-2.0 / GPL | DJ integration, later | If the DJ wants the queue to drive playback rather than be a request list, Mopidy exposes a JSON-RPC tracklist you can push accepted requests into. Most DJs will keep their own software. |

**Where this lands for Runit:** the app is being built against a
`RunitRepository` interface with an in-memory implementation, so the backend
choice stays deferred. Supabase is the presumed first adapter — see
`src/data/supabase/README.md`.
