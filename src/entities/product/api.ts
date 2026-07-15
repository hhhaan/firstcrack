import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';

export type Product = Database['public']['Tables']['products']['Row'];
export type ProductInsert = Database['public']['Tables']['products']['Insert'];
export type ProductUpdate = Database['public']['Tables']['products']['Update'];

export const productApi = {
    list: async (userId: string): Promise<Product[]> => {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data ?? [];
    },

    create: async (product: ProductInsert): Promise<Product> => {
        const { data, error } = await supabase.from('products').insert(product).select().single();
        if (error) throw error;
        // biome-ignore lint/style/noNonNullAssertion: error already checked above
        return data!;
    },

    update: async (id: string, patch: ProductUpdate): Promise<Product> => {
        const { data, error } = await supabase
            .from('products')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        // biome-ignore lint/style/noNonNullAssertion: error already checked above
        return data!;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) throw error;
    },
};
