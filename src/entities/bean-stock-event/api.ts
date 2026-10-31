import { inventoryStore } from '@shared/lib/inventoryStore';
import { isOptimisticId, OptimisticIdRefusedError, refuseOptimisticBeanId } from '@shared/lib/optimistic-id';
import { parseStockSummaryJson, type StockSummaryValues } from '@shared/lib/stock-calc';
import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';

export type BeanStockEvent = Database['public']['Tables']['bean_stock_events']['Row'];
export type BeanStockEventInsert = Database['public']['Tables']['bean_stock_events']['Insert'];

/** Batch roasted inbound — structural (entities↔entities import forbidden). */
export type RoastedInboundEvent = {
    user_id: string;
    bean_id?: string | null;
    blend_id?: string | null;
    delta_grams: number;
    event_type: string;
    reference_id?: string | null;
    note?: string | null;
    is_estimate?: boolean;
};

export type StockSummary = StockSummaryValues;

const mapSummariesRecord = (raw: Record<string, unknown> | null): Record<string, StockSummary> => {
    if (!raw) return {};
    const out: Record<string, StockSummary> = {};
    for (const [beanId, value] of Object.entries(raw)) {
        out[beanId] = parseStockSummaryJson(value ?? {});
    }
    return out;
};

export const beanStockEventApi = {
    listByBean: async (beanId: string): Promise<BeanStockEvent[]> => {
        if (isOptimisticId(beanId)) return [];
        const { data, error } = await supabase
            .from('bean_stock_events')
            .select('*')
            .eq('bean_id', beanId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data ?? [];
    },

    /** 해당 reference_id로 이미 roast 차감이 기록됐는지 — 스케줄 완료/세션 저장 이중 차감 가드용. */
    hasRoastDeductionForReference: async (referenceId: string): Promise<boolean> => {
        const { data, error } = await supabase
            .from('bean_stock_events')
            .select('id')
            .eq('reference_id', referenceId)
            .eq('event_type', 'roast')
            .limit(1);
        if (error) throw error;
        return (data ?? []).length > 0;
    },

    insert: async (event: BeanStockEventInsert): Promise<BeanStockEvent> => {
        refuseOptimisticBeanId(event.bean_id, 'Refusing stock write for an unsaved bean id');
        const { data, error } = await supabase.from('bean_stock_events').insert(event).select().single();
        if (error) throw error;
        return data;
    },

    /**
     * Atomic batch insert via RPC — bean events + optional roasted events in one TX.
     * Idempotent: duplicate (reference_id, bean_id) / roast_inbound pairs are silently skipped.
     * roastedEvents is a structural type (entities↔entities import forbidden).
     */
    insertMany: async (events: BeanStockEventInsert[], roastedEvents: RoastedInboundEvent[] = []): Promise<void> => {
        if (
            events.some((event) => isOptimisticId(event.bean_id)) ||
            roastedEvents.some((event) => isOptimisticId(event.bean_id))
        ) {
            throw new OptimisticIdRefusedError('Refusing stock write for an unsaved bean id');
        }
        if (!events.length && !roastedEvents.length) return;

        const { error } = await supabase.rpc('insert_stock_events_batch', {
            p_events: events,
            p_roasted_events: roastedEvents,
        });
        if (error) throw error;
    },

    getStockSummary: async (beanId: string, horizonDays?: number): Promise<StockSummary> => {
        if (isOptimisticId(beanId)) return parseStockSummaryJson({});
        const horizon = horizonDays ?? (await inventoryStore.getHorizonDays());

        const { data, error } = await supabase.rpc('get_bean_stock_summary', {
            p_bean_id: beanId,
            p_horizon_days: horizon,
        });
        if (error) throw error;
        return parseStockSummaryJson((data ?? {}) as Record<string, number>);
    },

    getStockSummariesByUser: async (userId: string, horizonDays?: number): Promise<Record<string, StockSummary>> => {
        const horizon = horizonDays ?? (await inventoryStore.getHorizonDays());

        const { data, error } = await supabase.rpc('get_user_stock_summaries', {
            p_user_id: userId,
            p_horizon_days: horizon,
        });
        if (error) throw error;
        return mapSummariesRecord((data ?? {}) as Record<string, unknown>);
    },

    /** Purchase weighted average per bean. The database aggregates every row. */
    getPurchaseWac: async (userId: string): Promise<Record<string, number>> => {
        const { data, error } = await supabase.rpc('get_purchase_wac', { p_user_id: userId });
        if (error) throw error;
        const out: Record<string, number> = {};
        for (const [beanId, value] of Object.entries((data ?? {}) as Record<string, unknown>)) {
            const wac = Number(value);
            if (Number.isFinite(wac)) out[beanId] = wac;
        }
        return out;
    },

    computeInventoryAlerts: async (userId: string, horizonDays?: number): Promise<void> => {
        const horizon = horizonDays ?? (await inventoryStore.getHorizonDays());

        const { error } = await supabase.rpc('compute_inventory_alerts', {
            p_user_id: userId,
            p_horizon_days: horizon,
        });
        if (error) throw error;
    },
};
