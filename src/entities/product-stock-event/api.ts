import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';

export type ProductStockEvent = Database['public']['Tables']['product_stock_events']['Row'];
export type ProductStockEventInsert = Database['public']['Tables']['product_stock_events']['Insert'];

/** 포장 시 roasted 차감 이벤트 — FSD상 entities↔entities import 금지라 구조적 타입으로 선언 (RoastedStockEventInsert 호환). */
export type PackagingRoastedEvent = {
    user_id: string;
    bean_id?: string | null;
    blend_id?: string | null;
    delta_grams: number;
    event_type: string;
    reference_id?: string | null;
    note?: string | null;
    is_estimate?: boolean;
};

export const productStockEventApi = {
    /** Atomic batch insert via RPC. Idempotent on (reference_id, product_id, event_type). */
    insertMany: async (events: ProductStockEventInsert[]): Promise<void> => {
        if (!events.length) return;
        const { error } = await supabase.rpc('insert_product_stock_events_batch', { p_events: events });
        if (error) throw error;
    },

    /** 포장 1회 = product +units & roasted −grams를 단일 트랜잭션 RPC로. 멱등 (ON CONFLICT DO NOTHING). */
    insertPackagingOp: async (
        productEvents: ProductStockEventInsert[],
        roastedEvents: PackagingRoastedEvent[],
    ): Promise<void> => {
        const { error } = await supabase.rpc('insert_packaging_op', {
            p_product_events: productEvents,
            p_roasted_events: roastedEvents,
        });
        if (error) throw error;
    },

    getStockByUser: async (userId: string): Promise<Record<string, number>> => {
        const { data, error } = await supabase.rpc('get_user_product_stock', { p_user_id: userId });
        if (error) throw error;
        return (data as Record<string, number>) ?? {};
    },

    listByProduct: async (productId: string, limit = 50): Promise<ProductStockEvent[]> => {
        const { data, error } = await supabase
            .from('product_stock_events')
            .select('*')
            .eq('product_id', productId)
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return data ?? [];
    },
};
