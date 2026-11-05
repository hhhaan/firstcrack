import { supabase } from '@shared/lib/supabase';

export const roastChargeApi = {
    async reserve(userId: string, sessionId: string): Promise<void> {
        const { error } = await supabase.rpc('reserve_roast_charge', {
            p_user_id: userId,
            p_session_id: sessionId,
        });
        if (error) throw error;
    },
    async release(userId: string, sessionId: string): Promise<void> {
        const { error } = await supabase.rpc('release_roast_charge', {
            p_user_id: userId,
            p_session_id: sessionId,
        });
        if (error) throw error;
    },
    async record(userId: string, sessionId: string, chargedAt: string): Promise<void> {
        const { error } = await supabase.rpc('record_roast_charge', {
            p_charged_at: chargedAt,
            p_user_id: userId,
            p_session_id: sessionId,
        });
        if (error) throw error;
    },
};
