export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      beans: {
        Row: {
          id: string
          user_id: string
          name: string
          origin: string | null
          region: string | null
          farm: string | null
          altitude_masl: number | null
          process: string | null
          variety: string | null
          purchase_date: string | null
          tasting_notes: string | null
          stock_grams: number
          capacity_grams: number
          low_stock_threshold_grams: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          origin?: string | null
          region?: string | null
          farm?: string | null
          altitude_masl?: number | null
          process?: string | null
          variety?: string | null
          purchase_date?: string | null
          tasting_notes?: string | null
          stock_grams?: number
          capacity_grams?: number
          low_stock_threshold_grams?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          origin?: string | null
          region?: string | null
          farm?: string | null
          altitude_masl?: number | null
          process?: string | null
          variety?: string | null
          purchase_date?: string | null
          tasting_notes?: string | null
          stock_grams?: number
          capacity_grams?: number
          low_stock_threshold_grams?: number
          created_at?: string
          updated_at?: string
        }
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          plan: string
          polar_customer_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          plan?: string
          polar_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          plan?: string
          polar_customer_id?: string | null
          updated_at?: string
        }
      }
      roast_profiles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          target_level: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          target_level: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          target_level?: string
          updated_at?: string
          user_id?: string
        }
      }
      roast_sessions: {
        Row: {
          bean_id: string | null
          created_at: string
          drop_temp_celsius: number | null
          duration_seconds: number | null
          id: string
          notes: string | null
          profile_id: string | null
          roast_level: string | null
          roasted_at: string | null
          scheduled_at: string | null
          status: string
          updated_at: string
          user_id: string
          weight_grams: number
        }
        Insert: {
          bean_id?: string | null
          created_at?: string
          drop_temp_celsius?: number | null
          duration_seconds?: number | null
          id?: string
          notes?: string | null
          profile_id?: string | null
          roast_level?: string | null
          roasted_at?: string | null
          scheduled_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          weight_grams: number
        }
        Update: {
          bean_id?: string | null
          created_at?: string
          drop_temp_celsius?: number | null
          duration_seconds?: number | null
          id?: string
          notes?: string | null
          profile_id?: string | null
          roast_level?: string | null
          roasted_at?: string | null
          scheduled_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          weight_grams?: number
        }
      }
    }
  }
}

export type Bean = Database['public']['Tables']['beans']['Row']
export type RoastProfile = Database['public']['Tables']['roast_profiles']['Row']
export type RoastSession = Database['public']['Tables']['roast_sessions']['Row']
export type Profile = Database['public']['Tables']['profiles']['Row']

export type BeanInventoryLogType = 'purchase' | 'roast' | 'adjustment' | 'waste'

export type BeanInventoryLog = {
  id: string
  user_id: string
  bean_id: string
  change_grams: number
  type: BeanInventoryLogType
  roast_session_id: string | null
  note: string | null
  created_at: string
}

export type BeanInventoryLogInsert = {
  id?: string
  user_id: string
  bean_id: string
  change_grams: number
  type: BeanInventoryLogType
  roast_session_id?: string | null
  note?: string | null
  created_at?: string
}

export type BeanInventoryLogUpdate = Partial<Omit<BeanInventoryLogInsert, 'user_id'>>

export type RoastSessionWithRelations = RoastSession & {
  beans: Pick<Bean, 'name' | 'origin'> | null
  roast_profiles: Pick<RoastProfile, 'name' | 'target_level'> | null
}
