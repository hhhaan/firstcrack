import { supabase } from '@shared/lib/supabase';
import type {
    DayPlan,
    PlanBatch,
    PlanBatchInsert,
    PlanBatchUpdate,
    PlanBatchWithProgress,
} from '@shared/types/database.types';

// ── Day Plan ──────────────────────────────────────────────────────────────────

export const dayPlanApi = {
    getOrCreate: async (userId: string, date: string): Promise<DayPlan> => {
        const { data: existing } = await supabase
            .from('roast_day_plans')
            .select('*')
            .eq('user_id', userId)
            .eq('date', date)
            .maybeSingle();

        if (existing) return existing;

        const { data, error } = await supabase
            .from('roast_day_plans')
            .insert({ user_id: userId, date, notes: '' })
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    updateNotes: async (id: string, notes: string): Promise<DayPlan> => {
        const { data, error } = await supabase
            .from('roast_day_plans')
            .update({ notes })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },
};

// ── Day Plan Range Summary ────────────────────────────────────────────────────

export type DayPlanBatchItem = {
    id: string;
    bean_name: string;
    batch_type: string;
    status: string;
    order_index: number;
};

export type DayPlanSummary = {
    date: string;
    plan_id: string;
    pending: number;
    in_progress: number;
    done: number;
    skipped: number;
    batches: DayPlanBatchItem[];
};

export const dayPlanRangeApi = {
    listSummary: async (userId: string, startDate: string, endDate: string): Promise<DayPlanSummary[]> => {
        const { data: plans, error: plansError } = await supabase
            .from('roast_day_plans')
            .select('id, date')
            .eq('user_id', userId)
            .gte('date', startDate)
            .lte('date', endDate);
        if (plansError) throw plansError;
        if (!plans || plans.length === 0) return [];

        const planIds = plans.map((p) => p.id);
        const { data: batches, error: batchError } = await supabase
            .from('roast_plan_batches')
            .select('id, plan_id, bean_name, batch_type, status, order_index')
            .in('plan_id', planIds)
            .order('order_index');
        if (batchError) throw batchError;

        const planMap = new Map(plans.map((p) => [p.id, p.date]));
        const summaryMap = new Map<string, DayPlanSummary>();
        for (const plan of plans) {
            summaryMap.set(plan.date, { date: plan.date, plan_id: plan.id, pending: 0, in_progress: 0, done: 0, skipped: 0, batches: [] });
        }
        for (const batch of batches ?? []) {
            const date = planMap.get(batch.plan_id);
            if (!date) continue;
            const s = summaryMap.get(date);
            if (!s) continue;
            s.batches.push({ id: batch.id, bean_name: batch.bean_name, batch_type: batch.batch_type, status: batch.status, order_index: batch.order_index });
            if (batch.status === 'pending') s.pending++;
            else if (batch.status === 'in-progress') s.in_progress++;
            else if (batch.status === 'done') s.done++;
            else if (batch.status === 'skipped') s.skipped++;
        }
        return [...summaryMap.values()];
    },
};

// ── Plan Batches ──────────────────────────────────────────────────────────────

export const planBatchApi = {
    list: async (planId: string): Promise<PlanBatchWithProgress[]> => {
        const [batchesResult, sessionsResult] = await Promise.all([
            supabase
                .from('roast_plan_batches')
                .select('*')
                .eq('plan_id', planId)
                .order('order_index'),
            supabase
                .from('roast_sessions')
                .select('plan_batch_id')
                .not('plan_batch_id', 'is', null),
        ]);

        if (batchesResult.error) throw batchesResult.error;
        if (sessionsResult.error) throw sessionsResult.error;

        const countMap = new Map<string, number>();
        for (const s of sessionsResult.data ?? []) {
            if (s.plan_batch_id) {
                countMap.set(s.plan_batch_id, (countMap.get(s.plan_batch_id) ?? 0) + 1);
            }
        }

        return (batchesResult.data ?? []).map((row) => ({
            ...row,
            completed_sessions: countMap.get(row.id) ?? 0,
        }));
    },

    create: async (batch: PlanBatchInsert): Promise<PlanBatch> => {
        const { data, error } = await supabase
            .from('roast_plan_batches')
            .insert(batch)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    update: async ({ id, ...patch }: PlanBatchUpdate): Promise<PlanBatch> => {
        const { data, error } = await supabase
            .from('roast_plan_batches')
            .update(patch)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase.from('roast_plan_batches').delete().eq('id', id);
        if (error) throw error;
    },

    reorder: async (planId: string, orderedIds: string[]): Promise<void> => {
        const updates = orderedIds.map((id, index) =>
            supabase.from('roast_plan_batches').update({ order_index: index }).eq('id', id),
        );
        await Promise.all(updates);
        // Invalidation handled by caller
        void planId;
    },
};
