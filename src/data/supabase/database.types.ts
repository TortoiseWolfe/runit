/**
 * GENERATED from the live database. Do not hand-edit.
 *
 * Regenerate with the Supabase MCP `generate_typescript_types` against project
 * `qwusbxallkbzfladvgfx`, or `supabase gen types typescript --project-id <ref>`.
 *
 * Generated rather than transcribed on purpose: a mistyped snake_case column does
 * not raise. PostgREST returns the row without it and the mapper reads
 * `undefined`, so the failure surfaces as a blank name three screens away.
 *
 * THE Insert / Update / Relationships KEYS ARE LOAD-BEARING. An earlier version of
 * this file kept only `Row`, on the reasoning that writes are typed at their call
 * sites anyway. That silently broke every write: supabase-js constrains its client
 * generic to `GenericSchema`, whose `GenericTable` requires all four keys, so a
 * table missing them fails the constraint, the whole `Database` type is discarded,
 * and `.insert()`, `.update()` and `.rpc()` all degrade to `never` / `undefined`.
 * The apparent noise in a generated file is the file doing its job.
 *
 * `Relationships` is `[]` throughout because this adapter never uses PostgREST
 * embeds -- and could not usefully: `guests` has no SELECT policy, so any embed of
 * it resolves to null for every client. The denormalised `*_name` columns exist
 * for exactly that reason.
 */

export type Database = {
  public: {
    Tables: {
      broadcast_reads: {
        Row: { broadcast_id: string; guest_id: string; read_at: string };
        Insert: { broadcast_id: string; guest_id: string; read_at?: string };
        Update: { broadcast_id?: string; guest_id?: string; read_at?: string };
        Relationships: [];
      };
      broadcasts: {
        Row: {
          id: string; event_id: string; author_host_id: string | null; author_name: string;
          author_role_label: string; kind: string; body: string; pinned: boolean;
          seen_count: number; created_at: string;
        };
        Insert: {
          id?: string; event_id: string; author_host_id?: string | null; author_name: string;
          author_role_label: string; kind?: string; body: string; pinned?: boolean;
          seen_count?: number; created_at?: string;
        };
        Update: {
          id?: string; event_id?: string; author_host_id?: string | null; author_name?: string;
          author_role_label?: string; kind?: string; body?: string; pinned?: boolean;
          seen_count?: number; created_at?: string;
        };
        Relationships: [];
      };
      events: {
        Row: {
          id: string; code: string; name: string; venue: string; starts_at: string;
          timezone: string; doors_label: string; tier: string; active_folder_id: string | null;
          now_schedule_item_id: string | null; guest_count: number; invited_count: number;
          created_at: string;
        };
        Insert: {
          id?: string; code: string; name: string; venue: string; starts_at: string;
          timezone?: string; doors_label?: string; tier?: string; active_folder_id?: string | null;
          now_schedule_item_id?: string | null; guest_count?: number; invited_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string; code?: string; name?: string; venue?: string; starts_at?: string;
          timezone?: string; doors_label?: string; tier?: string; active_folder_id?: string | null;
          now_schedule_item_id?: string | null; guest_count?: number; invited_count?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      folders: {
        Row: { id: string; event_id: string; name: string; position: number; photo_count: number };
        Insert: { id?: string; event_id: string; name: string; position?: number; photo_count?: number };
        Update: { id?: string; event_id?: string; name?: string; position?: number; photo_count?: number };
        Relationships: [];
      };
      guest_blocks: {
        Row: {
          event_id: string; blocker_guest_id: string; blocked_guest_id: string;
          blocked_name: string; created_at: string;
        };
        Insert: {
          event_id: string; blocker_guest_id: string; blocked_guest_id: string;
          blocked_name?: string; created_at?: string;
        };
        Update: {
          event_id?: string; blocker_guest_id?: string; blocked_guest_id?: string;
          blocked_name?: string; created_at?: string;
        };
        Relationships: [];
      };
      guests: {
        Row: { id: string; event_id: string; auth_user_id: string; nickname: string; push_token: string | null; created_at: string };
        Insert: { id?: string; event_id: string; auth_user_id: string; nickname: string; push_token?: string | null; created_at?: string };
        Update: { id?: string; event_id?: string; auth_user_id?: string; nickname?: string; push_token?: string | null; created_at?: string };
        Relationships: [];
      };
      hosts: {
        Row: {
          id: string; event_id: string; auth_user_id: string | null; display_name: string;
          role: string; role_label: string; created_at: string;
        };
        Insert: {
          id?: string; event_id: string; auth_user_id?: string | null; display_name: string;
          role: string; role_label: string; created_at?: string;
        };
        Update: {
          id?: string; event_id?: string; auth_user_id?: string | null; display_name?: string;
          role?: string; role_label?: string; created_at?: string;
        };
        Relationships: [];
      };
      invitees: {
        Row: {
          id: string; event_id: string; email: string; display_name: string | null;
          invited_at: string | null; joined_guest_id: string | null; created_at: string;
        };
        Insert: {
          id?: string; event_id: string; email: string; display_name?: string | null;
          invited_at?: string | null; joined_guest_id?: string | null; created_at?: string;
        };
        Update: {
          id?: string; event_id?: string; email?: string; display_name?: string | null;
          invited_at?: string | null; joined_guest_id?: string | null; created_at?: string;
        };
        Relationships: [];
      };
      now_playing: {
        Row: {
          event_id: string; title: string; artist: string;
          from_request_id: string | null; started_at: string | null;
        };
        Insert: {
          event_id: string; title: string; artist?: string;
          from_request_id?: string | null; started_at?: string | null;
        };
        Update: {
          event_id?: string; title?: string; artist?: string;
          from_request_id?: string | null; started_at?: string | null;
        };
        Relationships: [];
      };
      photos: {
        Row: {
          id: string; event_id: string; folder_id: string; uploaded_by_guest_id: string | null;
          uploaded_by_name: string; status: string; hue: number; storage_path: string | null; thumb_path: string | null;
          created_at: string;
        };
        Insert: {
          id?: string; event_id: string; folder_id: string; uploaded_by_guest_id?: string | null;
          uploaded_by_name: string; status?: string; hue?: number; storage_path?: string | null; thumb_path?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string; event_id?: string; folder_id?: string; uploaded_by_guest_id?: string | null;
          uploaded_by_name?: string; status?: string; hue?: number; storage_path?: string | null; thumb_path?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          id: string; event_id: string; reporter_guest_id: string | null; reporter_name: string;
          subject_kind: string; subject_photo_id: string | null;
          subject_request_id: string | null; subject_guest_id: string | null;
          reason: string; note: string; subject_label: string;
          resolved_at: string | null; resolution: string | null;
          resolved_by_host_id: string | null; created_at: string;
        };
        Insert: {
          id?: string; event_id: string; reporter_guest_id?: string | null; reporter_name: string;
          subject_kind: string; subject_photo_id?: string | null;
          subject_request_id?: string | null; subject_guest_id?: string | null;
          reason: string; note?: string; subject_label: string;
          resolved_at?: string | null; resolution?: string | null;
          resolved_by_host_id?: string | null; created_at?: string;
        };
        Update: {
          id?: string; event_id?: string; reporter_guest_id?: string | null;
          reporter_name?: string; subject_kind?: string; subject_photo_id?: string | null;
          subject_request_id?: string | null; subject_guest_id?: string | null;
          reason?: string; note?: string; subject_label?: string;
          resolved_at?: string | null; resolution?: string | null;
          resolved_by_host_id?: string | null; created_at?: string;
        };
        Relationships: [];
      };
      schedule_items: {
        Row: {
          id: string; event_id: string; position: number; time_label: string | null;
          title: string; place: string; started_at: string | null;
        };
        Insert: {
          id?: string; event_id: string; position: number; time_label?: string | null;
          title: string; place?: string; started_at?: string | null;
        };
        Update: {
          id?: string; event_id?: string; position?: number; time_label?: string | null;
          title?: string; place?: string; started_at?: string | null;
        };
        Relationships: [];
      };
      song_requests: {
        Row: {
          id: string; event_id: string; title: string; artist: string;
          requested_by_guest_id: string | null; requested_by_name: string; status: string;
          vote_count: number; created_at: string;
        };
        Insert: {
          id?: string; event_id: string; title: string; artist?: string;
          requested_by_guest_id?: string | null; requested_by_name: string; status?: string;
          vote_count?: number; created_at?: string;
        };
        Update: {
          id?: string; event_id?: string; title?: string; artist?: string;
          requested_by_guest_id?: string | null; requested_by_name?: string; status?: string;
          vote_count?: number; created_at?: string;
        };
        Relationships: [];
      };
      song_votes: {
        Row: { request_id: string; guest_id: string; created_at: string };
        Insert: { request_id: string; guest_id: string; created_at?: string };
        Update: { request_id?: string; guest_id?: string; created_at?: string };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      claim_host: { Args: { p_code: string; p_secret: string }; Returns: string };
      file_report: {
        Args: {
          p_event_id: string; p_kind: string; p_subject_id: string;
          p_reason: string; p_note?: string;
        };
        // Null when this guest had already reported this subject -- ON CONFLICT DO
        // NOTHING returns no row. That is a success, not a failure.
        Returns: string | null;
      };
      /**
       * The FIRST RPC here that returns rows rather than a scalar.
       *
       * `returns table (...)` reaches PostgREST as an ARRAY -- zero elements for a
       * code that names no event, one for a hit. Typing it as a bare object would
       * compile and then read `undefined` off an array at runtime.
       */
      event_preview: {
        Args: { p_code: string };
        Returns: {
          id: string;
          code: string;
          name: string;
          venue: string;
          starts_at: string;
          timezone: string;
          doors_label: string;
        }[];
      };
      /** Returns exactly one row. The host_key is the only copy that will ever exist. */
      create_event: {
        Args: {
          p_name: string;
          p_starts_at: string;
          p_timezone: string;
          p_venue?: string;
          p_doors_label?: string;
          p_host_name?: string;
        };
        Returns: { event_id: string; code: string; host_id: string; host_key: string }[];
      };
      rotate_host_key: { Args: { p_event: string }; Returns: string };
      // `p_token` is NOT nullable here even though the SQL accepts null: Postgres does not
      // express argument nullability, so the generator emits `string`. The adapter passes
      // '' to clear, and `set_push_token` normalises '' to NULL with nullif(btrim(...)).
      set_push_token: { Args: { p_event: string; p_token: string }; Returns: undefined };
      /** Returns exactly one row. host_key is the only copy that will ever exist. */
      invite_host: {
        Args: {
          p_event: string;
          p_display_name: string;
          p_role: string;
          p_role_label?: string;
        };
        Returns: { host_id: string; host_key: string }[];
      };
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

/** `Row<'photos'>` — the one accessor the adapter needs beyond the client generic. */
export type Row<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

/** One row of `event_preview`. The RPC's own projection, narrower than `Row<'events'>`. */
export type PreviewRow = Database['public']['Functions']['event_preview']['Returns'][number];
