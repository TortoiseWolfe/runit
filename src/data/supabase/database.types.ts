/**
 * GENERATED from the live database. Do not hand-edit.
 *
 * Regenerate with the Supabase MCP `generate_typescript_types` against project
 * `qwusbxallkbzfladvgfx`, or `supabase gen types typescript --project-id <ref>`.
 *
 * This is the authoritative column list, and it is generated rather than
 * transcribed on purpose: a mistyped snake_case column does not raise -- PostgREST
 * returns the rows without it and the mapper reads `undefined`, so the failure
 * surfaces as a blank name or a missing count somewhere far away.
 *
 * Supabase's generator also emits Insert/Update variants and a page of conditional
 * generics for addressing them. Only `Row` and the function signatures are kept
 * here; `Row<'photos'>` below does the same job as their `Tables<>` helper in one
 * line, and writes are typed at their call sites where the column set is explicit.
 */

export type Database = {
  public: {
    Tables: {
      broadcast_reads: {
        Row: { broadcast_id: string; guest_id: string; read_at: string };
      };
      broadcasts: {
        Row: {
          id: string;
          event_id: string;
          author_host_id: string | null;
          author_name: string;
          author_role_label: string;
          kind: string;
          body: string;
          pinned: boolean;
          seen_count: number;
          created_at: string;
        };
      };
      events: {
        Row: {
          id: string;
          code: string;
          name: string;
          venue: string;
          starts_at: string;
          timezone: string;
          doors_label: string;
          tier: string;
          active_folder_id: string | null;
          now_schedule_item_id: string | null;
          guest_count: number;
          invited_count: number;
          created_at: string;
        };
      };
      folders: {
        Row: { id: string; event_id: string; name: string; position: number; photo_count: number };
      };
      guests: {
        Row: {
          id: string;
          event_id: string;
          auth_user_id: string;
          nickname: string;
          created_at: string;
        };
      };
      hosts: {
        Row: {
          id: string;
          event_id: string;
          auth_user_id: string | null;
          display_name: string;
          role: string;
          role_label: string;
          created_at: string;
        };
      };
      now_playing: {
        Row: {
          event_id: string;
          title: string;
          artist: string;
          from_request_id: string | null;
          started_at: string | null;
        };
      };
      photos: {
        Row: {
          id: string;
          event_id: string;
          folder_id: string;
          uploaded_by_guest_id: string | null;
          uploaded_by_name: string;
          status: string;
          hue: number;
          storage_path: string | null;
          created_at: string;
        };
      };
      schedule_items: {
        Row: {
          id: string;
          event_id: string;
          position: number;
          time_label: string | null;
          title: string;
          place: string;
          started_at: string | null;
        };
      };
      song_requests: {
        Row: {
          id: string;
          event_id: string;
          title: string;
          artist: string;
          requested_by_guest_id: string | null;
          requested_by_name: string;
          status: string;
          vote_count: number;
          created_at: string;
        };
      };
      song_votes: {
        Row: { request_id: string; guest_id: string; created_at: string };
      };
    };
    Views: Record<never, never>;
    Functions: {
      is_host: { Args: { p_event: string }; Returns: boolean };
      join_event: { Args: { p_code: string; p_nickname: string }; Returns: string };
      my_guest_id: { Args: { p_event: string }; Returns: string };
      play_next: { Args: { p_event: string }; Returns: undefined };
      start_schedule_item: { Args: { p_item: string; p_rewind?: boolean }; Returns: undefined };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

/** `Row<'photos'>` — the one accessor the adapter needs. */
export type Row<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

/** Table names that carry realtime, for channel wiring. Mirrors the publication. */
export type PublishedTable =
  | 'events'
  | 'broadcasts'
  | 'schedule_items'
  | 'song_requests'
  | 'now_playing'
  | 'folders'
  | 'photos';
