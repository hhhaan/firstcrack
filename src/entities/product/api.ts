import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';

export type Product = Database['public']['Tables']['products']['Row'];
export type ProductInsert = Database['public']['Tables']['products']['Insert'];
export type ProductUpdate = Database['public']['Tables']['products']['Update'];

/** One external identifier (platform variant/product id or merchant SKU) bound to a product (#164). */
export type ProductChannelSku = Database['public']['Tables']['product_channel_skus']['Row'];
export type ProductChannelSkuInsert = Database['public']['Tables']['product_channel_skus']['Insert'];

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

    /** Row read for a cache miss. Same columns as `list` — RLS, not a narrower projection. */
    get: async (id: string): Promise<Product> => {
        const { data, error } = await supabase.from('products').select('*').eq('id', id).single();
        if (error) throw error;
        return data;
    },

    create: async (product: ProductInsert): Promise<Product> => {
        const { data, error } = await supabase.from('products').insert(product).select().single();
        if (error) throw error;
        return data;
    },

    update: async (id: string, patch: ProductUpdate): Promise<Product> => {
        const { data, error } = await supabase
            .from('products')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) throw error;
    },
};

export const productChannelSkuApi = {
    /** Every mapping of the workspace — small table, one query serves both Products and Orders. */
    list: async (userId: string): Promise<ProductChannelSku[]> => {
        const { data, error } = await supabase
            .from('product_channel_skus')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data ?? [];
    },

    /**
     * (user, platform, external_key) is unique: re-binding a key to another product replaces the
     * old row instead of failing, which is what "link this line to that product" means.
     */
    upsert: async (row: ProductChannelSkuInsert): Promise<ProductChannelSku> => {
        const { data, error } = await supabase
            .from('product_channel_skus')
            .upsert({ ...row, external_key: row.external_key.trim() }, { onConflict: 'user_id,platform,external_key' })
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('product_channel_skus').delete().eq('id', id);
        if (error) throw error;
    },
};
