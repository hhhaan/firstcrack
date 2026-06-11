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
    PostgrestVersion: "14.5"
  }
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
      bean_inventory_logs: {
        Row: {
          bean_id: string
          change_grams: number
          created_at: string
          id: string
          note: string | null
          roast_session_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          bean_id: string
          change_grams: number
          created_at?: string
          id?: string
          note?: string | null
          roast_session_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          bean_id?: string
          change_grams?: number
          created_at?: string
          id?: string
          note?: string | null
          roast_session_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bean_inventory_logs_bean_id_fkey"
            columns: ["bean_id"]
            isOneToOne: false
            referencedRelation: "beans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bean_inventory_logs_roast_session_id_fkey"
            columns: ["roast_session_id"]
            isOneToOne: false
            referencedRelation: "roast_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bean_inventory_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bean_stock_events: {
        Row: {
          bean_id: string
          created_at: string
          delta_grams: number
          event_type: string
          id: string
          note: string | null
          reference_id: string | null
          user_id: string
        }
        Insert: {
          bean_id: string
          created_at?: string
          delta_grams: number
          event_type: string
          id?: string
          note?: string | null
          reference_id?: string | null
          user_id: string
        }
        Update: {
          bean_id?: string
          created_at?: string
          delta_grams?: number
          event_type?: string
          id?: string
          note?: string | null
          reference_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bean_stock_events_bean_id_fkey"
            columns: ["bean_id"]
            isOneToOne: false
            referencedRelation: "beans"
            referencedColumns: ["id"]
          },
        ]
      }
      beans: {
        Row: {
          altitude_masl: number | null
          capacity_grams: number
          cost_per_kg: number | null
          created_at: string
          farm: string | null
          id: string
          low_stock_threshold_grams: number
          name: string
          origin: string | null
          process: string | null
          purchase_date: string | null
          region: string | null
          stock_grams: number
          tasting_notes: string | null
          updated_at: string
          user_id: string
          variety: string | null
          vendor: string | null
        }
        Insert: {
          altitude_masl?: number | null
          capacity_grams?: number
          cost_per_kg?: number | null
          created_at?: string
          farm?: string | null
          id?: string
          low_stock_threshold_grams?: number
          name: string
          origin?: string | null
          process?: string | null
          purchase_date?: string | null
          region?: string | null
          stock_grams?: number
          tasting_notes?: string | null
          updated_at?: string
          user_id: string
          variety?: string | null
          vendor?: string | null
        }
        Update: {
          altitude_masl?: number | null
          capacity_grams?: number
          cost_per_kg?: number | null
          created_at?: string
          farm?: string | null
          id?: string
          low_stock_threshold_grams?: number
          name?: string
          origin?: string | null
          process?: string | null
          purchase_date?: string | null
          region?: string | null
          stock_grams?: number
          tasting_notes?: string | null
          updated_at?: string
          user_id?: string
          variety?: string | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "beans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blend_components: {
        Row: {
          bean_id: string
          blend_id: string
          id: string
          ratio_pct: number
        }
        Insert: {
          bean_id: string
          blend_id: string
          id?: string
          ratio_pct: number
        }
        Update: {
          bean_id?: string
          blend_id?: string
          id?: string
          ratio_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "blend_components_bean_id_fkey"
            columns: ["bean_id"]
            isOneToOne: false
            referencedRelation: "beans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blend_components_blend_id_fkey"
            columns: ["blend_id"]
            isOneToOne: false
            referencedRelation: "blends"
            referencedColumns: ["id"]
          },
        ]
      }
      blends: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          business_name: string | null
          business_registration_number: string | null
          created_at: string
          default_roast_profile_id: string | null
          display_name: string | null
          id: string
          plan: string
          polar_customer_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          business_name?: string | null
          business_registration_number?: string | null
          created_at?: string
          default_roast_profile_id?: string | null
          display_name?: string | null
          id: string
          plan?: string
          polar_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          business_name?: string | null
          business_registration_number?: string | null
          created_at?: string
          default_roast_profile_id?: string | null
          display_name?: string | null
          id?: string
          plan?: string
          polar_customer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_roast_profile_id_fkey"
            columns: ["default_roast_profile_id"]
            isOneToOne: false
            referencedRelation: "roast_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recurrence_rules: {
        Row: {
          batch_size_kg: number
          batch_type: string
          bean_id: string | null
          bean_name: string
          blend_id: string | null
          created_at: string
          dtstart: string
          green_lot: string
          id: string
          machine_id: string | null
          notes: string
          roast_profile_id: string | null
          rrule: string
          status: string
          target_roasted_kg: number
          until: string | null
          updated_at: string
          user_id: string
          yield_pct: number
        }
        Insert: {
          batch_size_kg?: number
          batch_type?: string
          bean_id?: string | null
          bean_name?: string
          blend_id?: string | null
          created_at?: string
          dtstart: string
          green_lot?: string
          id?: string
          machine_id?: string | null
          notes?: string
          roast_profile_id?: string | null
          rrule: string
          status?: string
          target_roasted_kg?: number
          until?: string | null
          updated_at?: string
          user_id: string
          yield_pct?: number
        }
        Update: {
          batch_size_kg?: number
          batch_type?: string
          bean_id?: string | null
          bean_name?: string
          blend_id?: string | null
          created_at?: string
          dtstart?: string
          green_lot?: string
          id?: string
          machine_id?: string | null
          notes?: string
          roast_profile_id?: string | null
          rrule?: string
          status?: string
          target_roasted_kg?: number
          until?: string | null
          updated_at?: string
          user_id?: string
          yield_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "recurrence_rules_bean_id_fkey"
            columns: ["bean_id"]
            isOneToOne: false
            referencedRelation: "beans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurrence_rules_blend_id_fkey"
            columns: ["blend_id"]
            isOneToOne: false
            referencedRelation: "blends"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurrence_rules_roast_profile_id_fkey"
            columns: ["roast_profile_id"]
            isOneToOne: false
            referencedRelation: "roast_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurrence_rules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roast_day_plans: {
        Row: {
          created_at: string
          date: string
          id: string
          notes: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          notes?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          notes?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roast_day_plans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roast_plan_batches: {
        Row: {
          batch_count: number
          batch_size_kg: number
          batch_type: string
          bean_id: string | null
          bean_name: string
          blend_id: string | null
          created_at: string
          exception_type: string | null
          green_lot: string
          id: string
          machine_id: string | null
          notes: string
          order_index: number
          original_date: string | null
          plan_id: string
          recurrence_group_id: string | null
          recurrence_rule_id: string | null
          roast_profile_id: string | null
          rrule: string | null
          scheduled_date: string | null
          status: string
          target_roasted_kg: number
          updated_at: string
          yield_pct: number
        }
        Insert: {
          batch_count?: number
          batch_size_kg: number
          batch_type?: string
          bean_id?: string | null
          bean_name: string
          blend_id?: string | null
          created_at?: string
          exception_type?: string | null
          green_lot?: string
          id?: string
          machine_id?: string | null
          notes?: string
          order_index?: number
          original_date?: string | null
          plan_id: string
          recurrence_group_id?: string | null
          recurrence_rule_id?: string | null
          roast_profile_id?: string | null
          rrule?: string | null
          scheduled_date?: string | null
          status?: string
          target_roasted_kg: number
          updated_at?: string
          yield_pct?: number
        }
        Update: {
          batch_count?: number
          batch_size_kg?: number
          batch_type?: string
          bean_id?: string | null
          bean_name?: string
          blend_id?: string | null
          created_at?: string
          exception_type?: string | null
          green_lot?: string
          id?: string
          machine_id?: string | null
          notes?: string
          order_index?: number
          original_date?: string | null
          plan_id?: string
          recurrence_group_id?: string | null
          recurrence_rule_id?: string | null
          roast_profile_id?: string | null
          rrule?: string | null
          scheduled_date?: string | null
          status?: string
          target_roasted_kg?: number
          updated_at?: string
          yield_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "roast_plan_batches_bean_id_fkey"
            columns: ["bean_id"]
            isOneToOne: false
            referencedRelation: "beans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roast_plan_batches_blend_id_fkey"
            columns: ["blend_id"]
            isOneToOne: false
            referencedRelation: "blends"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roast_plan_batches_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "roast_day_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roast_plan_batches_recurrence_rule_id_fkey"
            columns: ["recurrence_rule_id"]
            isOneToOne: false
            referencedRelation: "recurrence_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roast_plan_batches_roast_profile_id_fkey"
            columns: ["roast_profile_id"]
            isOneToOne: false
            referencedRelation: "roast_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roast_profiles: {
        Row: {
          charge_temp_celsius: number | null
          created_at: string
          default_bean_id: string | null
          default_blend_id: string | null
          description: string | null
          dev_pct: number | null
          dev_time_sec: number | null
          drop_temp_celsius: number | null
          duration_sec: number | null
          id: string
          name: string
          source_session_id: string | null
          target_level: string
          updated_at: string
          user_id: string
        }
        Insert: {
          charge_temp_celsius?: number | null
          created_at?: string
          default_bean_id?: string | null
          default_blend_id?: string | null
          description?: string | null
          dev_pct?: number | null
          dev_time_sec?: number | null
          drop_temp_celsius?: number | null
          duration_sec?: number | null
          id?: string
          name: string
          source_session_id?: string | null
          target_level: string
          updated_at?: string
          user_id: string
        }
        Update: {
          charge_temp_celsius?: number | null
          created_at?: string
          default_bean_id?: string | null
          default_blend_id?: string | null
          description?: string | null
          dev_pct?: number | null
          dev_time_sec?: number | null
          drop_temp_celsius?: number | null
          duration_sec?: number | null
          id?: string
          name?: string
          source_session_id?: string | null
          target_level?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roast_profiles_default_bean_id_fkey"
            columns: ["default_bean_id"]
            isOneToOne: false
            referencedRelation: "beans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roast_profiles_default_blend_id_fkey"
            columns: ["default_blend_id"]
            isOneToOne: false
            referencedRelation: "blends"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roast_profiles_source_session_id_fkey"
            columns: ["source_session_id"]
            isOneToOne: false
            referencedRelation: "roast_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roast_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roast_sessions: {
        Row: {
          ambient_humidity_pct: number | null
          ambient_temp_celsius: number | null
          bean_id: string | null
          created_at: string
          drop_temp_celsius: number | null
          duration_seconds: number | null
          id: string
          notes: string | null
          plan_batch_id: string | null
          profile_id: string | null
          roast_level: string | null
          roasted_at: string | null
          scheduled_at: string | null
          status: string
          tsv_path: string | null
          updated_at: string
          user_id: string
          weight_grams: number
        }
        Insert: {
          ambient_humidity_pct?: number | null
          ambient_temp_celsius?: number | null
          bean_id?: string | null
          created_at?: string
          drop_temp_celsius?: number | null
          duration_seconds?: number | null
          id?: string
          notes?: string | null
          plan_batch_id?: string | null
          profile_id?: string | null
          roast_level?: string | null
          roasted_at?: string | null
          scheduled_at?: string | null
          status?: string
          tsv_path?: string | null
          updated_at?: string
          user_id: string
          weight_grams: number
        }
        Update: {
          ambient_humidity_pct?: number | null
          ambient_temp_celsius?: number | null
          bean_id?: string | null
          created_at?: string
          drop_temp_celsius?: number | null
          duration_seconds?: number | null
          id?: string
          notes?: string | null
          plan_batch_id?: string | null
          profile_id?: string | null
          roast_level?: string | null
          roasted_at?: string | null
          scheduled_at?: string | null
          status?: string
          tsv_path?: string | null
          updated_at?: string
          user_id?: string
          weight_grams?: number
        }
        Relationships: [
          {
            foreignKeyName: "roast_sessions_bean_id_fkey"
            columns: ["bean_id"]
            isOneToOne: false
            referencedRelation: "beans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roast_sessions_plan_batch_id_fkey"
            columns: ["plan_batch_id"]
            isOneToOne: false
            referencedRelation: "roast_plan_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roast_sessions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "roast_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roast_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount: number | null
          cancel_at_period_end: boolean | null
          canceled_at: string | null
          created_at: string
          currency: string | null
          current_period_end: string | null
          current_period_start: string | null
          ends_at: string | null
          id: string
          polar_checkout_id: string | null
          polar_product_id: string | null
          polar_subscription_id: string | null
          recurring_interval: string | null
          started_at: string | null
          status: string
          trial_end: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          cancel_at_period_end?: boolean | null
          canceled_at?: string | null
          created_at?: string
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          ends_at?: string | null
          id?: string
          polar_checkout_id?: string | null
          polar_product_id?: string | null
          polar_subscription_id?: string | null
          recurring_interval?: string | null
          started_at?: string | null
          status?: string
          trial_end?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          cancel_at_period_end?: boolean | null
          canceled_at?: string | null
          created_at?: string
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          ends_at?: string | null
          id?: string
          polar_checkout_id?: string | null
          polar_product_id?: string | null
          polar_subscription_id?: string | null
          recurring_interval?: string | null
          started_at?: string | null
          status?: string
          trial_end?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      active_subscriptions: {
        Row: {
          amount: number | null
          cancel_at_period_end: boolean | null
          canceled_at: string | null
          created_at: string | null
          currency: string | null
          current_period_end: string | null
          current_period_start: string | null
          ends_at: string | null
          id: string | null
          polar_checkout_id: string | null
          polar_product_id: string | null
          polar_subscription_id: string | null
          recurring_interval: string | null
          started_at: string | null
          status: string | null
          trial_end: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          cancel_at_period_end?: boolean | null
          canceled_at?: string | null
          created_at?: string | null
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          ends_at?: string | null
          id?: string | null
          polar_checkout_id?: string | null
          polar_product_id?: string | null
          polar_subscription_id?: string | null
          recurring_interval?: string | null
          started_at?: string | null
          status?: string | null
          trial_end?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          cancel_at_period_end?: boolean | null
          canceled_at?: string | null
          created_at?: string | null
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          ends_at?: string | null
          id?: string | null
          polar_checkout_id?: string | null
          polar_product_id?: string | null
          polar_subscription_id?: string | null
          recurring_interval?: string | null
          started_at?: string | null
          status?: string | null
          trial_end?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      [_ in never]: never
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

// ── Convenience aliases ──────────────────────────────────────────────────────

export type Bean = Database['public']['Tables']['beans']['Row']
export type BeanInsert = Database['public']['Tables']['beans']['Insert']
export type BeanUpdate = Database['public']['Tables']['beans']['Update']

export type Profile = Database['public']['Tables']['profiles']['Row']

export type RoastProfile = Database['public']['Tables']['roast_profiles']['Row']

export type RoastSession = Database['public']['Tables']['roast_sessions']['Row']
export type RoastSessionWithRelations = RoastSession & {
  beans: Pick<Bean, 'name' | 'origin'> | null
  roast_profiles: Pick<RoastProfile, 'name' | 'target_level'> | null
}

export type BeanInventoryLog = Database['public']['Tables']['bean_inventory_logs']['Row']
export type BeanInventoryLogInsert = Database['public']['Tables']['bean_inventory_logs']['Insert']
export type BeanInventoryLogUpdate = Database['public']['Tables']['bean_inventory_logs']['Update']

export type BeanInventoryLogType = 'purchase' | 'roast' | 'adjustment' | 'waste'

export type DayPlan = Database['public']['Tables']['roast_day_plans']['Row']

export type PlanBatch = Database['public']['Tables']['roast_plan_batches']['Row']
export type PlanBatchInsert = Database['public']['Tables']['roast_plan_batches']['Insert']
export type PlanBatchUpdate = Database['public']['Tables']['roast_plan_batches']['Update'] & { id: string }
export type PlanBatchWithProgress = PlanBatch & { completed_sessions: number }

export type PlanBatchHandoff = {
    planBatchId: string
    planId: string
    beanId: string | null
    blendId: string | null
    beanName: string
    batchSizeKg: number
    profileId: string | null
    batchCount: number
    completedSessions: number
}

export type RecurrenceRule = Database['public']['Tables']['recurrence_rules']['Row']
export type RecurrenceRuleInsert = Database['public']['Tables']['recurrence_rules']['Insert']
export type RecurrenceRuleUpdate = Database['public']['Tables']['recurrence_rules']['Update']
