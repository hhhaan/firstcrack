import { supabase } from '@shared/lib/supabase';
import type { BeanInventoryLog, BeanInventoryLogInsert, BeanInventoryLogUpdate } from '@shared/types/database.types';

export const beanInventoryApi = {
    list: async (userId: string, beanId?: string): Promise<BeanInventoryLog[]> => {
        let query = supabase
            .from('bean_inventory_logs')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (beanId) {
            query = query.eq('bean_id', beanId);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    },

    create: async (log: BeanInventoryLogInsert): Promise<BeanInventoryLog> => {
        const { data, error } = await supabase.from('bean_inventory_logs').insert(log).select().single();
        if (error) throw error;
        return data!;
    },

    update: async ({ id, ...patch }: { id: string } & BeanInventoryLogUpdate): Promise<BeanInventoryLog> => {
        const { data, error } = await supabase.from('bean_inventory_logs').update(patch).eq('id', id).select().single();
        if (error) throw error;
        return data!;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('bean_inventory_logs').delete().eq('id', id);
        if (error) throw error;
    },
};
