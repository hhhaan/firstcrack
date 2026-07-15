import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';

export type ProductStockEvent = Database['public']['Tables']['product_stock_events']['Row'];
export type ProductStockEventInsert = Database['public']['Tables']['product_stock_events']['Insert'];

export const productStockEventApi = {
    /** Atomic batch insert via RPC. Idempotent on (reference_id, product_id, event_type). */
    insertMany: async (events: ProductStockEventInsert[]): Promise<void> => {
        if (!events.length) return;
        // biome-ignore lint/suspicious/noExplicitAny: Supabase RPC types not generated
        const { error } = await (supabase as any).rpc('insert_product_stock_events_batch', { p_events: events });
        if (error) throw error;
    },

    getStockByUser: async (userId: string): Promise<Record<string, number>> => {
        // biome-ignore lint/suspicious/noExplicitAny: Supabase RPC types not generated
        const { data, error } = await (supabase as any).rpc('get_user_product_stock', { p_user_id: userId });
        if (error) throw error;
        return (data as Record<string, number>) ?? {};
    },
};
