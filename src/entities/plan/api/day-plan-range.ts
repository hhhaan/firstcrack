import { planBatchApi } from './plan-batch';

export type DayPlanBatchItem = {
    id: string;
    bean_name: string;
    status: string;
    order_index: number;
    batch_count: number;
    target_roasted_kg: number;
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
        const batches = await planBatchApi.listForDateRange(userId, startDate, endDate);
        const summaryMap = new Map<string, DayPlanSummary>();

        for (const batch of batches) {
            const date = batch.scheduled_date;
            if (!date) continue;

            if (!summaryMap.has(date)) {
                summaryMap.set(date, {
                    date,
                    plan_id: batch.plan_id,
                    pending: 0,
                    in_progress: 0,
                    done: 0,
                    skipped: 0,
                    batches: [],
                });
            }

            // biome-ignore lint/style/noNonNullAssertion: error already checked above
            const summary = summaryMap.get(date)!;
            summary.batches.push({
                id: batch.id,
                bean_name: batch.bean_name,
                status: batch.status,
                order_index: batch.order_index,
                batch_count: batch.batch_count,
                target_roasted_kg: batch.target_roasted_kg,
            });

            if (batch.status === 'pending') summary.pending++;
            else if (batch.status === 'in-progress') summary.in_progress++;
            else if (batch.status === 'done') summary.done++;
            else if (batch.status === 'skipped') summary.skipped++;
        }

        return [...summaryMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    },
};
