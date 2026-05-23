import { supabase } from '@shared/lib/supabase';
import type { RoastSession, RoastSessionWithRelations } from '@shared/types/database.types';

const SELECT_WITH_RELATIONS = '*, beans(name, origin), roast_profiles!profile_id(name, target_level)';

type RoastSessionInsert = Omit<RoastSession, 'id' | 'created_at' | 'updated_at'>;
type RoastSessionUpdate = { id: string } & Partial<Omit<RoastSession, 'id' | 'created_at' | 'updated_at' | 'user_id'>>;

export const roastSessionApi = {
    list: async (userId: string, status?: RoastSession['status']): Promise<RoastSessionWithRelations[]> => {
        let query = supabase
            .from('roast_sessions')
            .select(SELECT_WITH_RELATIONS)
            .eq('user_id', userId)
            .order('roasted_at', { ascending: false, nullsFirst: true })
            .order('created_at', { ascending: false });

        if (status) {
            query = query.eq('status', status);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    },

    get: async (id: string): Promise<RoastSessionWithRelations> => {
        const { data, error } = await supabase
            .from('roast_sessions')
            .select(SELECT_WITH_RELATIONS)
            .eq('id', id)
            .single();
        if (error) throw error;
        return data!;
    },

    create: async (session: RoastSessionInsert): Promise<RoastSession> => {
        const { data, error } = await supabase.from('roast_sessions').insert(session).select().single();
        if (error) throw error;
        return data!;
    },

    update: async ({ id, ...patch }: RoastSessionUpdate): Promise<RoastSession> => {
        const { data, error } = await supabase.from('roast_sessions').update(patch).eq('id', id).select().single();
        if (error) throw error;
        return data!;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('roast_sessions').delete().eq('id', id);
        if (error) throw error;
    },
};
