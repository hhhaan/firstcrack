import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';

export const appendRoastControlAudit = async (
    args: Database['public']['Functions']['append_replay_discharge_audit']['Args'],
): Promise<string> => {
    const { data, error } = await supabase
        .rpc('append_replay_discharge_audit', args)
        .abortSignal(AbortSignal.timeout(15_000));
    if (error) throw error;
    if (!data || !Number.isFinite(Date.parse(data))) throw new Error('Missing audit server receipt');
    return data;
};
