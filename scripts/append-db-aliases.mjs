import { appendFileSync } from 'fs';

const ALIASES = `
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
`;

appendFileSync('src/shared/types/database.types.ts', ALIASES);
