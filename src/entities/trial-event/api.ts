import { supabase } from '@shared/lib/supabase';

export const trialEventApi = {
    async reserve(userId: string, sessionId: string): Promise<void> {
        const { error } = await supabase.rpc('reserve_trial_event_batch', {
            p_user_id: userId,
            p_session_id: sessionId,
        });
        if (error) throw error;
    },
    async release(userId: string, sessionId: string): Promise<void> {
        const { error } = await supabase.rpc('release_trial_event_batch', {
            p_user_id: userId,
            p_session_id: sessionId,
        });
        if (error) throw error;
    },
    async charge(userId: string, sessionId: string): Promise<void> {
        const { error } = await supabase.rpc('charge_trial_event_batch', {
            p_user_id: userId,
            p_session_id: sessionId,
        });
        if (error) throw error;
    },
};
