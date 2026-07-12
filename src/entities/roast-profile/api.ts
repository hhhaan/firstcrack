import { supabase } from '@shared/lib/supabase';
import type { RoastProfile } from '@shared/types/database.types';

type RoastProfileInsert = Omit<RoastProfile, 'id' | 'created_at' | 'updated_at'>;
type RoastProfileUpdate = { id: string } & Partial<Omit<RoastProfile, 'id' | 'created_at' | 'updated_at' | 'user_id'>>;

export type RoastProfileWithSource = RoastProfile & {
    source_session: { tsv_path: string | null } | null;
    default_bean: { id: string; name: string } | null;
    default_blend: { id: string; name: string } | null;
};

const SELECT_WITH_SOURCE =
    '*, source_session:roast_sessions!source_session_id(tsv_path), default_bean:beans!default_bean_id(id,name), default_blend:blends!default_blend_id(id,name)';

export const roastProfileApi = {
    list: async (userId: string): Promise<RoastProfileWithSource[]> => {
        const { data, error } = await supabase
            .from('roast_profiles')
            .select(SELECT_WITH_SOURCE)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return (data ?? []) as unknown as RoastProfileWithSource[];
    },

    create: async (profile: RoastProfileInsert): Promise<RoastProfile> => {
        const { data, error } = await supabase.from('roast_profiles').insert(profile).select().single();
        if (error) throw error;
        // biome-ignore lint/style/noNonNullAssertion: error already checked above
        return data!;
    },

    update: async ({ id, ...patch }: RoastProfileUpdate): Promise<RoastProfile> => {
        const { data, error } = await supabase.from('roast_profiles').update(patch).eq('id', id).select().single();
        if (error) throw error;
        // biome-ignore lint/style/noNonNullAssertion: error already checked above
        return data!;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('roast_profiles').delete().eq('id', id);
        if (error) throw error;
    },
};
