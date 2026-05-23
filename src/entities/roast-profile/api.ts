import { supabase } from '@shared/lib/supabase';
import type { RoastProfile } from '@shared/types/database.types';

type RoastProfileInsert = Omit<RoastProfile, 'id' | 'created_at' | 'updated_at'>;
type RoastProfileUpdate = { id: string } & Partial<Omit<RoastProfile, 'id' | 'created_at' | 'updated_at' | 'user_id'>>;

export const roastProfileApi = {
    list: async (userId: string): Promise<RoastProfile[]> => {
        const { data, error } = await supabase
            .from('roast_profiles')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data ?? [];
    },

    create: async (profile: RoastProfileInsert): Promise<RoastProfile> => {
        const { data, error } = await supabase.from('roast_profiles').insert(profile).select().single();
        if (error) throw error;
        return data!;
    },

    update: async ({ id, ...patch }: RoastProfileUpdate): Promise<RoastProfile> => {
        const { data, error } = await supabase
            .from('roast_profiles')
            .update(patch)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data!;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('roast_profiles').delete().eq('id', id);
        if (error) throw error;
    },
};
