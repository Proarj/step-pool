export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      coin_ledger: {
        Row: {
          amount: number
          created_at: string
          day: string | null
          group_id: string | null
          id: number
          reason: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          day?: string | null
          group_id?: string | null
          id?: never
          reason: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          day?: string | null
          group_id?: string | null
          id?: never
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coin_ledger_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coin_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_steps: {
        Row: {
          day: string
          source: string
          steps: number
          synced_at: string
          user_id: string
        }
        Insert: {
          day: string
          source: string
          steps: number
          synced_at: string
          user_id: string
        }
        Update: {
          day?: string
          source?: string
          steps?: number
          synced_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_steps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      day_results: {
        Row: {
          coins_change: number
          daily_stake: number
          day: string
          group_id: string
          hit: boolean
          step_goal: number
          steps: number
          user_id: string
        }
        Insert: {
          coins_change: number
          daily_stake: number
          day: string
          group_id: string
          hit: boolean
          step_goal: number
          steps: number
          user_id: string
        }
        Update: {
          coins_change?: number
          daily_stake?: number
          day?: string
          group_id?: string
          hit?: boolean
          step_goal?: number
          steps?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "day_results_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "day_results_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          group_id: string
          joined_on: string
          left_on: string | null
          user_id: string
        }
        Insert: {
          group_id: string
          joined_on: string
          left_on?: string | null
          user_id: string
        }
        Update: {
          group_id?: string
          joined_on?: string
          left_on?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_settings: {
        Row: {
          daily_stake: number
          effective_from: string
          group_id: string
          step_goal: number
        }
        Insert: {
          daily_stake: number
          effective_from: string
          group_id: string
          step_goal: number
        }
        Update: {
          daily_stake?: number
          effective_from?: string
          group_id?: string
          step_goal?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_settings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          created_by: string
          id: string
          invite_code: string
          name: string
        }
        Insert: {
          created_at: string
          created_by: string
          id?: string
          invite_code: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          invite_code?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      scored_days: {
        Row: {
          day: string
          group_id: string
          scored_at: string
        }
        Insert: {
          day: string
          group_id: string
          scored_at: string
        }
        Update: {
          day?: string
          group_id?: string
          scored_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scored_days_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      balances: {
        Row: {
          balance: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coin_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      app_now: { Args: never; Returns: string }
      app_today: { Args: never; Returns: string }
      appears_in_my_groups: { Args: { p_user_id: string }; Returns: boolean }
      assert_valid_settings: {
        Args: { p_daily_stake: number; p_step_goal: number }
        Returns: undefined
      }
      balance_of: { Args: { p_user_id: string }; Returns: number }
      create_group: {
        Args: { p_daily_stake: number; p_name: string; p_step_goal: number }
        Returns: {
          created_at: string
          created_by: string
          id: string
          invite_code: string
          name: string
        }
        SetofOptions: {
          from: "*"
          to: "groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      generate_invite_code: { Args: never; Returns: string }
      group_day_participants: {
        Args: { p_day: string; p_goal: number; p_group_id: string }
        Returns: {
          hit: boolean
          steps: number
          user_id: string
        }[]
      }
      is_active_member: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: boolean
      }
      is_group_member: { Args: { p_group_id: string }; Returns: boolean }
      join_group: {
        Args: { p_invite_code: string }
        Returns: {
          created_at: string
          created_by: string
          id: string
          invite_code: string
          name: string
        }
        SetofOptions: {
          from: "*"
          to: "groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_group: { Args: { p_group_id: string }; Returns: undefined }
      require_user: { Args: never; Returns: string }
      score_group_day: {
        Args: { p_day: string; p_group_id: string }
        Returns: undefined
      }
      score_pending_days: { Args: never; Returns: number }
      shares_group_with: { Args: { p_user_id: string }; Returns: boolean }
      update_group_settings: {
        Args: { p_daily_stake: number; p_group_id: string; p_step_goal: number }
        Returns: {
          daily_stake: number
          effective_from: string
          group_id: string
          step_goal: number
        }
        SetofOptions: {
          from: "*"
          to: "group_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upload_steps: {
        Args: { p_day: string; p_source: string; p_steps: number }
        Returns: {
          day: string
          source: string
          steps: number
          synced_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "daily_steps"
          isOneToOne: true
          isSetofReturn: false
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
