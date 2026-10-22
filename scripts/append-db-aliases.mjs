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
    blends?: { name: string } | null;
  beans: Pick<Bean, 'name' | 'origin' | 'region' | 'variety' | 'process' | 'farm'> | null
  roast_profiles: Pick<RoastProfile, 'name' | 'target_level'> | null
}

export type Cupping = Database['public']['Tables']['cuppings']['Row']
export type CuppingInvite = Database['public']['Tables']['cupping_invites']['Row']
export type CuppingEvent = Database['public']['Tables']['cupping_events']['Row']
export type CuppingFormTemplate = Database['public']['Tables']['cupping_form_templates']['Row']
export type CuppingParticipant = Database['public']['Tables']['cupping_participants']['Row']
export type CuppingSample = Database['public']['Tables']['cupping_samples']['Row']


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

export type MachineConnectionLog = Database['public']['Tables']['machine_connection_logs']['Row']
export type MachineConnectionLogInsert = Database['public']['Tables']['machine_connection_logs']['Insert']
`;

appendFileSync('src/shared/types/database.types.ts', ALIASES);
