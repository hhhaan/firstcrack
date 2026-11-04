import type { Profile } from '@shared/types/database.types';
import { supabase } from './supabase';

/** Shared queryFn for `profileKeys` (`useProfile` + `useEffectivePlan`). */
export async function fetchProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error) throw error;
    return data;
}

/** Event grants are profile entitlements, shared by write gates and billing UI. */
export async function fetchTrialEventGrant(userId: string) {
    const { data, error } = await supabase.from('trial_event_grants').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
}
