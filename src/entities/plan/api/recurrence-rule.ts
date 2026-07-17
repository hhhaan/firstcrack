import { supabase } from '@shared/lib/supabase';
import type { RecurrenceRule, RecurrenceRuleInsert } from '@shared/types/database.types';

/** Master fields stored on recurrence_rules (propagated on scope edits). */
export type RecurrenceRuleMasterPatch = {
    rrule?: string;
    dtstart?: string;
    machine_id?: string | null;
    roast_profile_id?: string | null;
    bean_id?: string | null;
    blend_id?: string | null;
    bean_name?: string;
    green_lot?: string;
    batch_size_kg?: number;
    yield_pct?: number;
    target_roasted_kg?: number;
    notes?: string;
    batch_type?: string;
};

export const mergeRecurrenceRuleMaster = (
    existing: RecurrenceRule,
    patch: RecurrenceRuleMasterPatch,
): Omit<RecurrenceRuleInsert, 'user_id' | 'status' | 'until'> => ({
    machine_id: patch.machine_id !== undefined ? patch.machine_id : existing.machine_id,
    roast_profile_id: patch.roast_profile_id !== undefined ? patch.roast_profile_id : existing.roast_profile_id,
    bean_id: patch.bean_id !== undefined ? patch.bean_id : existing.bean_id,
    blend_id: patch.blend_id !== undefined ? patch.blend_id : existing.blend_id,
    bean_name: patch.bean_name ?? existing.bean_name,
    green_lot: patch.green_lot ?? existing.green_lot,
    batch_size_kg: patch.batch_size_kg ?? existing.batch_size_kg,
    yield_pct: patch.yield_pct ?? existing.yield_pct,
    target_roasted_kg: patch.target_roasted_kg ?? existing.target_roasted_kg,
    notes: patch.notes ?? existing.notes,
    batch_type: patch.batch_type ?? existing.batch_type,
    rrule: patch.rrule ?? existing.rrule,
    dtstart: patch.dtstart ?? existing.dtstart,
});

export const recurrenceRuleApi = {
    /** Create a recurrence rule (Master) */
    create: async (rule: RecurrenceRuleInsert): Promise<RecurrenceRule> => {
        const { data, error } = await supabase.from('recurrence_rules').insert(rule).select().single();
        if (error) throw error;
        return data;
    },

    /** Get a single recurrence rule by ID */
    get: async (id: string): Promise<RecurrenceRule | null> => {
        const { data, error } = await supabase.from('recurrence_rules').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return data;
    },

    /** Update a recurrence rule (e.g., change rrule or until) */
    update: async (id: string, patch: Partial<RecurrenceRuleInsert>): Promise<RecurrenceRule> => {
        const { data, error } = await supabase.from('recurrence_rules').update(patch).eq('id', id).select().single();
        if (error) throw error;
        return data;
    },

    /** List all active recurrence rules for a user */
    listActive: async (userId: string): Promise<RecurrenceRule[]> => {
        const { data, error } = await supabase
            .from('recurrence_rules')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'active')
            .order('created_at');
        if (error) throw error;
        return data ?? [];
    },
};
