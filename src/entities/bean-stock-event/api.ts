import { inventoryStore } from '@shared/lib/inventoryStore';
import { parseStockSummaryJson, type StockSummaryValues } from '@shared/lib/stock-calc';
import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';

export type BeanStockEvent = Database['public']['Tables']['bean_stock_events']['Row'];
export type BeanStockEventInsert = Database['public']['Tables']['bean_stock_events']['Insert'];

export type StockSummary = StockSummaryValues;

const mapSummariesRecord = (raw: Record<string, unknown> | null): Record<string, StockSummary> => {
    if (!raw) return {};
    const out: Record<string, StockSummary> = {};
    for (const [beanId, value] of Object.entries(raw)) {
        out[beanId] = parseStockSummaryJson((value ?? {}) as Record<string, number>);
    }
    return out;
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
        // biome-ignore lint/style/noNonNullAssertion: error already checked above
        return data!;
    },

    /** Atomic batch insert via RPC — all events in one transaction. Idempotent: duplicate (reference_id, bean_id) pairs are silently skipped. */
    insertMany: async (events: BeanStockEventInsert[]): Promise<void> => {
        if (!events.length) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: Supabase RPC types not generated
        const { error } = await (supabase as any).rpc('insert_stock_events_batch', { p_events: events });
        if (error) throw error;
    },

    getCurrentStock: async (beanId: string): Promise<number> => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: Supabase RPC types not generated
        const { data, error } = await (supabase as any).rpc('get_bean_current_stock', { p_bean_id: beanId });
        if (error) throw error;
        return (data as number) ?? 0;
    },

    getAvailableStock: async (beanId: string): Promise<number> => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: Supabase RPC types not generated
        const { data, error } = await (supabase as any).rpc('get_bean_available_stock', { p_bean_id: beanId });
        if (error) throw error;
        return (data as number) ?? 0;
    },

    getReservedStock: async (beanId: string, horizonDays?: number): Promise<number> => {
        const horizon = horizonDays ?? (await inventoryStore.getHorizonDays());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: Supabase RPC types not generated
        const { data, error } = await (supabase as any).rpc('get_bean_reserved_stock', {
            p_bean_id: beanId,
            p_horizon_days: horizon,
        });
        if (error) throw error;
        return (data as number) ?? 0;
    },

    getStockSummary: async (beanId: string, horizonDays?: number): Promise<StockSummary> => {
        const horizon = horizonDays ?? (await inventoryStore.getHorizonDays());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: Supabase RPC types not generated
        const { data, error } = await (supabase as any).rpc('get_bean_stock_summary', {
            p_bean_id: beanId,
            p_horizon_days: horizon,
        });
        if (error) throw error;
        return parseStockSummaryJson((data ?? {}) as Record<string, number>);
    },

    getStockSummariesByUser: async (userId: string, horizonDays?: number): Promise<Record<string, StockSummary>> => {
        const horizon = horizonDays ?? (await inventoryStore.getHorizonDays());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: Supabase RPC types not generated
        const { data, error } = await (supabase as any).rpc('get_user_stock_summaries', {
            p_user_id: userId,
            p_horizon_days: horizon,
        });
        if (error) throw error;
        return mapSummariesRecord((data ?? {}) as Record<string, unknown>);
    },

    computeInventoryAlerts: async (userId: string, horizonDays?: number): Promise<void> => {
        const horizon = horizonDays ?? (await inventoryStore.getHorizonDays());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: Supabase RPC types not generated
        const { error } = await (supabase as any).rpc('compute_inventory_alerts', {
            p_user_id: userId,
            p_horizon_days: horizon,
        });
        if (error) throw error;
    },
};
