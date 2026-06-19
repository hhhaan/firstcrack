import { expandRRuleInRange, formatDateLocal } from '@shared/lib/rrule';
import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database.types';

const RESERVATION_HORIZON_DAYS = 28; // 4 weeks — only count batches within this window

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
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const horizon = new Date(today);
        horizon.setDate(horizon.getDate() + RESERVATION_HORIZON_DAYS);
        const todayStr = formatDateLocal(today);
        const horizonStr = formatDateLocal(horizon);

        // ── 1. Materialized batches (one-off + exception rows) within horizon ──
        const { data: batches, error: batchErr } = await supabase
            .from('roast_plan_batches')
            .select('id, batch_size_kg, batch_count, recurrence_rule_id, original_date')
            .eq('bean_id', beanId)
            .in('status', ['pending', 'scheduled'])
            .or(`scheduled_date.is.null,scheduled_date.lte.${horizonStr}`);
        if (batchErr) throw batchErr;

        const batchIds = (batches ?? []).map((b) => b.id);
        const completedMap = new Map<string, number>();
        if (batchIds.length) {
            const { data: sessions, error: sessErr } = await supabase
                .from('roast_sessions')
                .select('plan_batch_id')
                .in('plan_batch_id', batchIds);
            if (sessErr) throw sessErr;
            for (const s of sessions ?? []) {
                if (s.plan_batch_id) completedMap.set(s.plan_batch_id, (completedMap.get(s.plan_batch_id) ?? 0) + 1);
            }
        }

        const materializedReserved = (batches ?? []).reduce((sum, b) => {
            const remaining = Math.max(0, b.batch_count - (completedMap.get(b.id) ?? 0));
            return sum + remaining * b.batch_size_kg * 1000;
        }, 0);

        // ── 2. Virtual recurring instances within horizon ──
        const { data: rules, error: ruleErr } = await supabase
            .from('recurrence_rules')
            .select('id, rrule, dtstart, batch_size_kg, target_roasted_kg')
            .eq('bean_id', beanId)
            .eq('status', 'active');
        if (ruleErr) throw ruleErr;
        if (!rules?.length) return materializedReserved;

        // Build excluded original_dates per rule:
        // - modified exceptions (already in materialized total)
        // - cancelled exceptions (must not generate a virtual slot)
        // Keyed by original_date (local string) to match RRULE expansion output.
        const excludedByRule = new Map<string, Set<string>>();
        for (const b of batches ?? []) {
            if (b.recurrence_rule_id && b.original_date) {
                if (!excludedByRule.has(b.recurrence_rule_id)) excludedByRule.set(b.recurrence_rule_id, new Set());
                excludedByRule.get(b.recurrence_rule_id)!.add(b.original_date);
            }
        }
        // Fetch cancelled exception rows by original_date range (M-2: use original_date not scheduled_date
        // so "moved outside horizon" instances are still excluded from virtual expansion)
        const ruleIds = rules.map((r) => r.id);
        const { data: cancelledRows } = await supabase
            .from('roast_plan_batches')
            .select('recurrence_rule_id, original_date')
            .in('recurrence_rule_id', ruleIds)
            .eq('exception_type', 'cancelled') // M-1: cancelled only
            .gte('original_date', todayStr)
            .lte('original_date', horizonStr);
        for (const b of cancelledRows ?? []) {
            if (b.recurrence_rule_id && b.original_date) {
                if (!excludedByRule.has(b.recurrence_rule_id)) excludedByRule.set(b.recurrence_rule_id, new Set());
                excludedByRule.get(b.recurrence_rule_id)!.add(b.original_date);
            }
        }

        let virtualReserved = 0;
        for (const rule of rules) {
            const dates = expandRRuleInRange(rule.rrule, new Date(rule.dtstart), today, horizon);
            const excluded = excludedByRule.get(rule.id) ?? new Set<string>();
            // C-1: use formatDateLocal (local tz) not toISOString (UTC) to match DB original_date strings
            const virtualDates = dates.filter((d) => !excluded.has(formatDateLocal(d)));
            if (!virtualDates.length) continue;
            const batchSize = Number(rule.batch_size_kg) || 0;
            const targetKg = Number(rule.target_roasted_kg) || 0;
            const batchCount = batchSize > 0 && targetKg > 0 ? Math.ceil(targetKg / batchSize) : 1;
            virtualReserved += virtualDates.length * batchCount * batchSize * 1000;
        }

        return materializedReserved + virtualReserved;
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

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const horizon = new Date(today);
        horizon.setDate(horizon.getDate() + RESERVATION_HORIZON_DAYS);
        const todayStr = formatDateLocal(today);
        const horizonStr = formatDateLocal(horizon);

        const [currentRes, reservedRes, rulesRes] = await Promise.all([
            supabase.from('bean_stock_events').select('bean_id, delta_grams').in('bean_id', beanIds),
            supabase
                .from('roast_plan_batches')
                .select('id, bean_id, batch_size_kg, batch_count, recurrence_rule_id, original_date')
                .in('bean_id', beanIds)
                .in('status', ['pending', 'scheduled'])
                .or(`scheduled_date.is.null,scheduled_date.lte.${horizonStr}`),
            supabase
                .from('recurrence_rules')
                .select('id, bean_id, rrule, dtstart, batch_size_kg, target_roasted_kg')
                .eq('user_id', userId)
                .eq('status', 'active')
                .not('bean_id', 'is', null),
        ]);

        if (currentRes.error) throw currentRes.error;
        if (reservedRes.error) throw reservedRes.error;
        if (rulesRes.error) throw rulesRes.error;

        const currentMap: Record<string, number> = {};
        for (const e of currentRes.data ?? []) {
            currentMap[e.bean_id] = (currentMap[e.bean_id] ?? 0) + e.delta_grams;
        }

        // ── Materialized batches ──
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

        // ── Virtual recurring instances within horizon ──
        if (rulesRes.data?.length) {
            // Build excluded original_dates per rule (already covered by materialized rows)
            const excludedByRule = new Map<string, Set<string>>();
            for (const b of reservedRes.data ?? []) {
                if (b.recurrence_rule_id && b.original_date) {
                    if (!excludedByRule.has(b.recurrence_rule_id)) excludedByRule.set(b.recurrence_rule_id, new Set());
                    excludedByRule.get(b.recurrence_rule_id)!.add(b.original_date);
                }
            }
            // Fetch cancelled exception rows by original_date range (M-2: original_date not scheduled_date
            // so instances moved outside horizon are still excluded from virtual expansion)
            const ruleIds = rulesRes.data.map((r) => r.id);
            const { data: cancelledRows } = await supabase
                .from('roast_plan_batches')
                .select('recurrence_rule_id, original_date')
                .in('recurrence_rule_id', ruleIds)
                .eq('exception_type', 'cancelled') // M-1: cancelled only
                .gte('original_date', todayStr)
                .lte('original_date', horizonStr);
            for (const b of cancelledRows ?? []) {
                if (b.recurrence_rule_id && b.original_date) {
                    if (!excludedByRule.has(b.recurrence_rule_id)) excludedByRule.set(b.recurrence_rule_id, new Set());
                    excludedByRule.get(b.recurrence_rule_id)!.add(b.original_date);
                }
            }

            for (const rule of rulesRes.data) {
                if (!rule.bean_id) continue;
                const dates = expandRRuleInRange(rule.rrule, new Date(rule.dtstart), today, horizon);
                const excluded = excludedByRule.get(rule.id) ?? new Set<string>();
                // C-1: formatDateLocal (local tz) to match DB original_date strings
                const virtualDates = dates.filter((d) => !excluded.has(formatDateLocal(d)));
                if (!virtualDates.length) continue;
                const batchSize = Number(rule.batch_size_kg) || 0;
                const targetKg = Number(rule.target_roasted_kg) || 0;
                const batchCount = batchSize > 0 && targetKg > 0 ? Math.ceil(targetKg / batchSize) : 1;
                reservedMap[rule.bean_id] =
                    (reservedMap[rule.bean_id] ?? 0) + virtualDates.length * batchCount * batchSize * 1000;
            }
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
