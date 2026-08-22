import type { Profile } from '@shared/types/database.types';
import { supabase } from './supabase';

/** Shared queryFn for `profileKeys` (`useProfile` + `useEffectivePlan`). */
export async function fetchProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error) throw error;
    return data;
}
