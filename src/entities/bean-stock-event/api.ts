import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';

export type BeanStockEvent = Database['public']['Tables']['bean_stock_events']['Row'];
export type BeanStockEventInsert = Database['public']['Tables']['bean_stock_events']['Insert'];

export type StockSummary = {
    currentGrams: number;
    reservedGrams: number;
    effectiveGrams: number;
};

export const beanStockEventApi = {
    listByBean: async (beanId: string): Promise<BeanStockEvent[]> => {
        const { data, error } = await supabase
            .from('bean_stock_events')
            .select('*')
            .eq('bean_id', beanId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data ?? [];
    },

    insert: async (event: BeanStockEventInsert): Promise<BeanStockEvent> => {
        const { data, error } = await supabase.from('bean_stock_events').insert(event).select().single();
        if (error) throw error;
        return data!;
    },

    /** Atomic batch insert via RPC — all events in one transaction. Idempotent: duplicate (reference_id, bean_id) pairs are silently skipped. */
    insertMany: async (events: BeanStockEventInsert[]): Promise<void> => {
        if (!events.length) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any).rpc('insert_stock_events_batch', { p_events: events });
        if (error) throw error;
    },

    getCurrentStock: async (beanId: string): Promise<number> => {
        const { data, error } = await supabase.from('bean_stock_events').select('delta_grams').eq('bean_id', beanId);
        if (error) throw error;
        return (data ?? []).reduce((sum, e) => sum + e.delta_grams, 0);
    },

    getReservedStock: async (beanId: string): Promise<number> => {
        const { data: batches, error: batchErr } = await supabase
            .from('roast_plan_batches')
            .select('id, batch_size_kg, batch_count')
            .eq('bean_id', beanId)
            .in('status', ['pending', 'scheduled']);
        if (batchErr) throw batchErr;
        if (!batches?.length) return 0;

        const batchIds = batches.map((b) => b.id);
        const { data: sessions, error: sessErr } = await supabase
            .from('roast_sessions')
            .select('plan_batch_id')
            .in('plan_batch_id', batchIds);
        if (sessErr) throw sessErr;

        const completedMap = new Map<string, number>();
        for (const s of sessions ?? []) {
            if (s.plan_batch_id) completedMap.set(s.plan_batch_id, (completedMap.get(s.plan_batch_id) ?? 0) + 1);
        }

        return batches.reduce((sum, b) => {
            const remaining = Math.max(0, b.batch_count - (completedMap.get(b.id) ?? 0));
            return sum + remaining * b.batch_size_kg * 1000;
        }, 0);
    },

    getStockSummary: async (beanId: string): Promise<StockSummary> => {
        const [currentGrams, reservedGrams] = await Promise.all([
            beanStockEventApi.getCurrentStock(beanId),
            beanStockEventApi.getReservedStock(beanId),
        ]);
        return {
            currentGrams,
            reservedGrams,
            effectiveGrams: currentGrams - reservedGrams,
        };
    },

    /** 배치: user의 모든 bean에 대한 재고 요약을 beanId→StockSummary 맵으로 반환 */
    getStockSummariesByUser: async (userId: string): Promise<Record<string, StockSummary>> => {
        const { data: beans } = await supabase.from('beans').select('id').eq('user_id', userId);
        if (!beans?.length) return {};

        const beanIds = beans.map((b) => b.id);

        const [currentRes, reservedRes] = await Promise.all([
            supabase.from('bean_stock_events').select('bean_id, delta_grams').in('bean_id', beanIds),
            supabase
                .from('roast_plan_batches')
                .select('id, bean_id, batch_size_kg, batch_count')
                .in('bean_id', beanIds)
                .in('status', ['pending', 'scheduled']),
        ]);

        if (currentRes.error) throw currentRes.error;
        if (reservedRes.error) throw reservedRes.error;

        const currentMap: Record<string, number> = {};
        for (const e of currentRes.data ?? []) {
            currentMap[e.bean_id] = (currentMap[e.bean_id] ?? 0) + e.delta_grams;
        }

        const pendingBatchIds = (reservedRes.data ?? []).map((b) => b.id);
        const sessionCountMap = new Map<string, number>();
        if (pendingBatchIds.length) {
            const { data: sessions, error: sessErr } = await supabase
                .from('roast_sessions')
                .select('plan_batch_id')
                .in('plan_batch_id', pendingBatchIds);
            if (sessErr) throw sessErr;
            for (const s of sessions ?? []) {
                if (s.plan_batch_id)
                    sessionCountMap.set(s.plan_batch_id, (sessionCountMap.get(s.plan_batch_id) ?? 0) + 1);
            }
        }

        const reservedMap: Record<string, number> = {};
        for (const b of reservedRes.data ?? []) {
            if (!b.bean_id) continue;
            const remaining = Math.max(0, b.batch_count - (sessionCountMap.get(b.id) ?? 0));
            reservedMap[b.bean_id] = (reservedMap[b.bean_id] ?? 0) + remaining * b.batch_size_kg * 1000;
        }

        const result: Record<string, StockSummary> = {};
        for (const id of beanIds) {
            const currentGrams = currentMap[id] ?? 0;
            const reservedGrams = reservedMap[id] ?? 0;
            result[id] = { currentGrams, reservedGrams, effectiveGrams: currentGrams - reservedGrams };
        }
        return result;
    },
};
