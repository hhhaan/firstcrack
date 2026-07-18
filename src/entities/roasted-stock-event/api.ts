import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';

export type RoastedStockEvent = Database['public']['Tables']['roasted_stock_events']['Row'];
export type RoastedStockEventInsert = Database['public']['Tables']['roasted_stock_events']['Insert'];

export type RoastedStockSummary = { grams: number; hasEstimate: boolean };

export const mapRoastedStockRecord = (raw: Record<string, unknown> | null): Record<string, RoastedStockSummary> => {
    if (!raw) return {};
    const out: Record<string, RoastedStockSummary> = {};
    for (const [key, value] of Object.entries(raw)) {
        const v = (value ?? {}) as { grams?: number; has_estimate?: boolean };
        out[key] = { grams: v.grams ?? 0, hasEstimate: v.has_estimate ?? false };
    }
    return out;
};

export const roastedStockEventApi = {
    /** 세션당 입고 1건 보장 — 추정 입고를 실측으로 교체하는 유일한 경로 */
    upsertInbound: async (p: {
        sessionId: string;
        userId: string;
        beanId: string | null;
        blendId: string | null;
        grams: number;
        isEstimate: boolean;
    }): Promise<void> => {
        const { error } = await supabase.rpc('upsert_roasted_inbound', {
            p_session_id: p.sessionId,
            p_user_id: p.userId,
            p_bean_id: p.beanId,
            p_blend_id: p.blendId,
            p_grams: p.grams,
            p_is_estimate: p.isEstimate,
        });
        if (error) throw error;
    },

    /** 포장/블렌딩 이벤트 원자적 배치 */
    insertBatch: async (events: RoastedStockEventInsert[]): Promise<void> => {
        if (!events.length) return;
        const { error } = await supabase.rpc('insert_roasted_stock_events_batch', { p_events: events });
        if (error) throw error;
    },

    getUserRoastedStock: async (userId: string): Promise<Record<string, RoastedStockSummary>> => {
        const { data, error } = await supabase.rpc('get_user_roasted_stock', { p_user_id: userId });
        if (error) throw error;
        return mapRoastedStockRecord(data as Record<string, unknown> | null);
    },

    listByUser: async (userId: string, limit = 100): Promise<RoastedStockEvent[]> => {
        const { data, error } = await supabase
            .from('roasted_stock_events')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return data ?? [];
    },
};
