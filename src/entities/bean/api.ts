import { supabase } from '@shared/lib/supabase';
import type { Bean, Database } from '@shared/types/database.types';

type BeanInsert = Database['public']['Tables']['beans']['Insert'];
type BeanUpdate = { id: string } & Database['public']['Tables']['beans']['Update'];

export const beanApi = {
    list: async (userId: string): Promise<Bean[]> => {
        const { data, error } = await supabase
            .from('beans')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },

    get: async (id: string): Promise<Bean> => {
        const { data, error } = await supabase.from('beans').select('*').eq('id', id).single();
        if (error) throw error;
        return data!;
    },

    create: async (bean: BeanInsert): Promise<Bean> => {
        const { data, error } = await supabase.from('beans').insert(bean).select().single();
        if (error) throw error;
        return data!;
    },

    update: async ({ id, ...patch }: BeanUpdate): Promise<Bean> => {
        const { data, error } = await supabase.from('beans').update(patch).eq('id', id).select().single();
        if (error) throw error;
        return data!;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('beans').delete().eq('id', id);
        if (error) throw error;
    },
};
