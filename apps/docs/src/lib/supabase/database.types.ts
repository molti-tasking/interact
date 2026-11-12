export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      design_probes: {
        Row: {
          closed_reason: string | null
          created_at: string | null
          dimension_id: string | null
          dimension_name: string | null
          edit_count: number
          edited_at: string | null
          edited_by: string | null
          explanation: string | null
          id: string
          layer: string
          options: Json
          portfolio_id: string
          preview_status: string | null
          previous_selected_option: string | null
          priority: number
          resolved_at: string | null
          resolved_by: string | null
          selected_option: string | null
          source: string
          status: string
          text: string
        }
        Insert: {
          closed_reason?: string | null
          created_at?: string | null
          dimension_id?: string | null
          dimension_name?: string | null
          edit_count?: number
          edited_at?: string | null
          edited_by?: string | null
          explanation?: string | null
          id?: string
          layer?: string
          options?: Json
          portfolio_id: string
          preview_status?: string | null
          previous_selected_option?: string | null
          priority?: number
          resolved_at?: string | null
          resolved_by?: string | null
          selected_option?: string | null
          source?: string
          status?: string
          text: string
        }
        Update: {
          closed_reason?: string | null
          created_at?: string | null
          dimension_id?: string | null
          dimension_name?: string | null
          edit_count?: number
          edited_at?: string | null
          edited_by?: string | null
          explanation?: string | null
          id?: string
          layer?: string
          options?: Json
          portfolio_id?: string
          preview_status?: string | null
          previous_selected_option?: string | null
          priority?: number
          resolved_at?: string | null
          resolved_by?: string | null
          selected_option?: string | null
          source?: string
          status?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "design_probes_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolios: {
        Row: {
          base_id: string | null
          created_at: string | null
          creator_role: string | null
          field_count: number | null
          id: string
          intent: Json
          intent_sync: Json | null
          owner_id: string | null
          projection: Json | null
          revision: number
          schema: Json
          space_id: string | null
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          base_id?: string | null
          created_at?: string | null
          creator_role?: string | null
          field_count?: never
          id?: string
          intent: Json
          intent_sync?: Json | null
          owner_id?: string | null
          projection?: Json | null
          revision?: number
          schema: Json
          space_id?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          base_id?: string | null
          created_at?: string | null
          creator_role?: string | null
          field_count?: never
          id?: string
          intent?: Json
          intent_sync?: Json | null
          owner_id?: string | null
          projection?: Json | null
          revision?: number
          schema?: Json
          space_id?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolios_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolios_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      provenance_log: {
        Row: {
          action: string
          actor: string
          actor_user_id: string | null
          created_at: string | null
          creator_role: string | null
          diff: Json
          id: string
          layer: string
          portfolio_id: string
          prev_intent: Json | null
          prev_schema: Json | null
          rationale: string | null
          revision: number | null
        }
        Insert: {
          action: string
          actor: string
          actor_user_id?: string | null
          created_at?: string | null
          creator_role?: string | null
          diff: Json
          id?: string
          layer: string
          portfolio_id: string
          prev_intent?: Json | null
          prev_schema?: Json | null
          rationale?: string | null
          revision?: number | null
        }
        Update: {
          action?: string
          actor?: string
          actor_user_id?: string | null
          created_at?: string | null
          creator_role?: string | null
          diff?: Json
          id?: string
          layer?: string
          portfolio_id?: string
          prev_intent?: Json | null
          prev_schema?: Json | null
          rationale?: string | null
          revision?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "provenance_log_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      responses: {
        Row: {
          data: Json
          id: string
          portfolio_id: string
          respondent_id: string | null
          submitted_at: string | null
          schema_version: number | null
        }
        Insert: {
          data: Json
          id?: string
          portfolio_id: string
          respondent_id?: string | null
          submitted_at?: string | null
          schema_version?: number | null
        }
        Update: {
          data?: Json
          id?: string
          portfolio_id?: string
          respondent_id?: string | null
          submitted_at?: string | null
          schema_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "responses_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      spaces: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          origin: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          origin?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          origin?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      study_assignments: {
        Row: {
          condition: string | null
          created_at: string
          external_id: string | null
          external_session_id: string | null
          external_source: string | null
          external_study_id: string | null
          participant_id: string
          session_id: string
          task_order: number | null
          start_kind: string | null
        }
        Insert: {
          condition?: string | null
          created_at?: string
          external_id?: string | null
          external_session_id?: string | null
          external_source?: string | null
          external_study_id?: string | null
          participant_id: string
          session_id: string
          task_order?: number | null
          start_kind?: string | null
        }
        Update: {
          condition?: string | null
          created_at?: string
          external_id?: string | null
          external_session_id?: string | null
          external_source?: string | null
          external_study_id?: string | null
          participant_id?: string
          session_id?: string
          task_order?: number | null
          start_kind?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "study_assignments_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: true
            referencedRelation: "study_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_assignments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "study_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      study_events: {
        Row: {
          client_at: string | null
          created_at: string
          id: number
          participant_id: string | null
          payload: Json
          phase: string | null
          portfolio_id: string | null
          session_id: string
          type: string
        }
        Insert: {
          client_at?: string | null
          created_at?: string
          id?: number
          participant_id?: string | null
          payload?: Json
          phase?: string | null
          portfolio_id?: string | null
          session_id: string
          type: string
        }
        Update: {
          client_at?: string | null
          created_at?: string
          id?: number
          participant_id?: string | null
          payload?: Json
          phase?: string | null
          portfolio_id?: string | null
          session_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_events_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "study_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "study_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      study_participants: {
        Row: {
          display_name: string
          id: string
          joined_at: string
          last_seen_at: string
          portfolio_id: string | null
          rejoin_until: string | null
          session_id: string
          user_id: string
        }
        Insert: {
          display_name: string
          id?: string
          joined_at?: string
          last_seen_at?: string
          portfolio_id?: string | null
          rejoin_until?: string | null
          session_id: string
          user_id: string
        }
        Update: {
          display_name?: string
          id?: string
          joined_at?: string
          last_seen_at?: string
          portfolio_id?: string | null
          rejoin_until?: string | null
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_participants_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "study_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      study_progress: {
        Row: {
          completed_at: string | null
          consented_at: string | null
          outcome: string | null
          participant_id: string
          session_id: string
          step: string
          step_started_at: string
        }
        Insert: {
          completed_at?: string | null
          consented_at?: string | null
          outcome?: string | null
          participant_id: string
          session_id: string
          step?: string
          step_started_at?: string
        }
        Update: {
          completed_at?: string | null
          consented_at?: string | null
          outcome?: string | null
          participant_id?: string
          session_id?: string
          step?: string
          step_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_progress_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: true
            referencedRelation: "study_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_progress_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "study_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      study_questionnaire_responses: {
        Row: {
          answers: Json
          id: string
          instrument: string
          participant_id: string
          session_id: string
          submitted_at: string
        }
        Insert: {
          answers: Json
          id?: string
          instrument: string
          participant_id: string
          session_id: string
          submitted_at?: string
        }
        Update: {
          answers?: Json
          id?: string
          instrument?: string
          participant_id?: string
          session_id?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_questionnaire_responses_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "study_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_questionnaire_responses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "study_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      study_session_secrets: {
        Row: {
          completion_url: string | null
          session_id: string
          updated_at: string
        }
        Insert: {
          completion_url?: string | null
          session_id: string
          updated_at?: string
        }
        Update: {
          completion_url?: string | null
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_session_secrets_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "study_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      study_sessions: {
        Row: {
          created_at: string
          id: string
          join_code: string
          name: string
          phase: string
          phase_durations: Json
          phase_ends_at: string | null
          phase_started_at: string
          settings: Json
          space_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          join_code: string
          name: string
          phase?: string
          phase_durations?: Json
          phase_ends_at?: string | null
          phase_started_at?: string
          settings?: Json
          space_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          join_code?: string
          name?: string
          phase?: string
          phase_durations?: Json
          phase_ends_at?: string | null
          phase_started_at?: string
          settings?: Json
          space_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "study_sessions_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      study_snapshots: {
        Row: {
          created_at: string
          design_probes: Json
          id: string
          intent: Json | null
          label: string
          participant_id: string | null
          portfolio_id: string
          revision: number | null
          schema: Json | null
          session_id: string
          title: string | null
        }
        Insert: {
          created_at?: string
          design_probes?: Json
          id?: string
          intent?: Json | null
          label: string
          participant_id?: string | null
          portfolio_id: string
          revision?: number | null
          schema?: Json | null
          session_id: string
          title?: string | null
        }
        Update: {
          created_at?: string
          design_probes?: Json
          id?: string
          intent?: Json | null
          label?: string
          participant_id?: string | null
          portfolio_id?: string
          revision?: number | null
          schema?: Json | null
          session_id?: string
          title?: string | null
        }
        Relationships: []
      }
      study_tasks: {
        Row: {
          brief: string
          finished_at: string | null
          finished_by: string | null
          id: string
          participant_id: string
          portfolio_id: string | null
          position: number
          session_id: string
          started_at: string | null
          source_portfolio_id: string | null
          start_kind: string | null
        }
        Insert: {
          brief: string
          finished_at?: string | null
          finished_by?: string | null
          id?: string
          participant_id: string
          portfolio_id?: string | null
          position: number
          session_id: string
          started_at?: string | null
          source_portfolio_id?: string | null
          start_kind?: string | null
        }
        Update: {
          brief?: string
          finished_at?: string | null
          finished_by?: string | null
          id?: string
          participant_id?: string
          portfolio_id?: string | null
          position?: number
          session_id?: string
          started_at?: string | null
          source_portfolio_id?: string | null
          start_kind?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "study_tasks_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "study_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_tasks_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_tasks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "study_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_my_study_step: {
        Args: { p_from: string; p_reason?: string; p_session_id: string }
        Returns: string
      }
      advance_study_phase: {
        Args: { p_phase: string; p_session_id: string }
        Returns: {
          created_at: string
          id: string
          join_code: string
          name: string
          phase: string
          phase_durations: Json
          phase_ends_at: string | null
          phase_started_at: string
          settings: Json
          space_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "study_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_study_session: {
        Args: { p_name: string; p_phase_durations?: Json; p_settings?: Json }
        Returns: {
          created_at: string
          id: string
          join_code: string
          name: string
          phase: string
          phase_durations: Json
          phase_ends_at: string | null
          phase_started_at: string
          settings: Json
          space_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "study_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decline_my_study: { Args: { p_session_id: string }; Returns: undefined }
      force_my_study_arm: {
        Args: { p_arm: string; p_session_id: string }
        Returns: string | null
      }
      extend_study_phase: {
        Args: { p_seconds: number; p_session_id: string }
        Returns: {
          created_at: string
          id: string
          join_code: string
          name: string
          phase: string
          phase_durations: Json
          phase_ends_at: string | null
          phase_started_at: string
          settings: Json
          space_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "study_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_my_study_state: { Args: { p_session_id: string }; Returns: Json }
      get_study_forms: {
        Args: { p_session_id: string }
        Returns: {
          answered_by_me: boolean
          field_count: number
          owner_name: string
          participant_id: string
          portfolio_id: string
          title: string
        }[]
      }
      get_study_handoff_candidates: {
        Args: { p_session_id: string }
        Returns: {
          brief: string
          condition: string
          decisions: number
          field_count: number
          finished_at: string
          participant: string
          portfolio_id: string
        }[]
      }
      get_study_progress: {
        Args: { p_session_id: string }
        Returns: {
          completed_at: string
          condition: string
          display_name: string
          joined_at: string
          last_seen_at: string
          outcome: string
          participant_id: string
          step: string
          task_order: number
          tasks: Json
        }[]
      }
      get_study_roster: {
        Args: { p_session_id: string }
        Returns: {
          display_name: string
          field_count: number | null
          joined_at: string
          last_seen_at: string
          participant_id: string
          portfolio_id: string | null
          probes_resolved: number
          questionnaire_done: boolean
          rejoin_until: string | null
          responses_given: number
          responses_received: number
          revision: number | null
          title: string | null
        }[]
      }
      is_study_participant: { Args: never; Returns: boolean }
      is_study_peer_form: {
        Args: { p_portfolio_id: string }
        Returns: boolean
      }
      join_study_session_external: {
        Args: {
          p_code: string
          p_source: string
          p_external_id: string
          p_external_study_id: string | null
          p_external_session_id: string | null
          p_intent: Json
          p_schema: Json
        }
        Returns: {
          participant_id: string
          portfolio_id: string
          session_id: string
        }[]
      }
      join_study_session: {
        Args: {
          p_code: string
          p_display_name: string
          p_intent: Json
          p_schema: Json
        }
        Returns: {
          participant_id: string
          portfolio_id: string
          session_id: string
        }[]
      }
      my_participant_ids: { Args: never; Returns: string[] }
      my_session_ids: { Args: never; Returns: string[] }
      owns_portfolio: { Args: { p_portfolio_id: string }; Returns: boolean }
      owns_portfolio_text: {
        Args: { p_portfolio_id: string }
        Returns: boolean
      }
      reassign_study_seat: {
        Args: { p_participant_id: string }
        Returns: undefined
      }
      get_published_form: {
        Args: { p_id: string }
        Returns: {
          id: string
          purpose: string | null
          schema: Json
          title: string
        }[]
      }
      is_app_admin: { Args: never; Returns: boolean }
      is_form_accepting: {
        Args: { p_portfolio_id: string }
        Returns: boolean
      }
      study_brief_steps: { Args: { p_tasks: number }; Returns: string[] }
      study_steps: { Args: { p_settings: Json; p_tasks: number }; Returns: string[] }
      submit_response: {
        Args: { p_data: Json; p_portfolio_id: string }
        Returns: string
      }
      commit_portfolio_change: {
        Args: {
          p_expected_revision: number
          p_intent?: Json
          p_portfolio_id: string
          p_provenance?: Json
          p_schema?: Json
          p_status?: string
          p_title?: string
        }
        Returns: {
          base_id: string | null
          created_at: string | null
          creator_role: string | null
          field_count: number | null
          id: string
          intent: Json
          intent_sync: Json | null
          owner_id: string | null
          projection: Json | null
          revision: number
          schema: Json
          space_id: string | null
          status: string | null
          title: string
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "portfolios"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

