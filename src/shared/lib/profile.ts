import type { Profile } from '@shared/types/database.types';
import { z } from 'zod';
import { supabase } from './supabase';

/** Shared queryFn for `profileKeys` (`useProfile` + `useEffectivePlan`). */
export async function fetchProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error) throw error;
    return data;
}

const chargeUsageSchema = z.object({
    plan: z.string(),
    used_batches: z.number().int().nonnegative(),
    reserved_batches: z.number().int().nonnegative(),
    batch_cap: z.number().int().nonnegative().nullable(),
    period_start: z.string().nullable(),
    period_end: z.string().nullable(),
    denial_code: z.string().nullable(),
});

/** Shared billing entitlement read: workspace gates and settings use the same usage. */
export async function fetchRoastChargeUsage(userId: string) {
    const { data, error } = await supabase.rpc('get_roast_charge_usage', { p_user_id: userId });
    if (error) throw error;
    return chargeUsageSchema.parse(data);
}
