import { beanApi } from '@entities/bean';
import { beanStockEventApi } from '@entities/bean-stock-event';
import { type InventoryAlert, inventoryAlertApi } from '@entities/inventory-alert';
import { batchStatus, planBatchApi } from '@entities/plan';
import { roastSessionApi } from '@entities/roast';
import { isBatchStockShort } from '@shared/lib/batch-stock';
import { inventoryStore } from '@shared/lib/inventoryStore';
import { dashboardKeys } from '@shared/lib/query-keys';
import { sessionRoastMetrics } from '@shared/lib/roast-delta';
import { formatDateLocal } from '@shared/lib/rrule';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { useQuery } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { averageRoastDurationSec, splitDashboardMonths } from '../lib/dashboard-roast-stats';

/** Recent-row view model. `roastDurationSec` is History 시간 (Charge→Drop), not record End. */
export type DashboardRecentSession = {
    id: string;
    roasted_at: string | null;
    weight_grams: number;
    roastDurationSec: number | null;
    drop_temp_celsius: number | null;
    roast_level: string | null;
    bean_label: string | null;
    beans: { name: string; origin: string | null } | null;
    roast_profiles: { name: string; target_level: string | null } | null;
};

export interface MonthlyBatch {
    date: Date;
    batches: number;
}

export interface UpcomingBatch {
    id: string;
    bean_name: string;
    batch_count: number;
    target_roasted_kg: number;
    status: string;
    date: string;
    isRecurring: boolean;
    stockShort: boolean;
}

export interface DashboardInventoryAlert {
    id: string;
    name: string;
    effectiveGrams: number;
    currentGrams: number;
    availableGrams: number;
    capacityGrams: number;
    lowStockThresholdGrams: number;
    reason: InventoryAlert['reason'];
}

export interface DashboardData {
    batchesThisMonth: number;
    batchesLastMonth: number;
    kgRoastedThisMonth: number;
    kgRoastedLastMonth: number;
    avgDurationSeconds: number;
    avgDurationLastMonthSeconds: number;
    recentSessions: DashboardRecentSession[];
    upcomingBatches: UpcomingBatch[];
    inventoryAlerts: DashboardInventoryAlert[];
    monthlyBatches: MonthlyBatch[];
    loading: boolean;
    error: string | null;
}

const mapDbAlert = (row: InventoryAlert, beanMeta?: { capacity_grams: number; low_stock_threshold_grams: number }) => ({
    id: row.bean_id,
    name: row.beans?.name ?? '',
    effectiveGrams: row.effective_grams,
    currentGrams: row.current_grams,
    availableGrams: row.available_grams,
    capacityGrams: beanMeta?.capacity_grams ?? 0,
    lowStockThresholdGrams: beanMeta?.low_stock_threshold_grams ?? 0,
    reason: row.reason,
});

const isUpcomingBatch = (batch: PlanBatchWithProgress, today: string): boolean => {
    if (!batch.scheduled_date || batch.scheduled_date < today) return false;
    const status = batchStatus(batch);
    return status !== 'done' && status !== 'skipped';
};

const fetchDashboard = async (userId: string): Promise<Omit<DashboardData, 'loading' | 'error'>> => {
    const now = new Date();
    const today = formatDateLocal(now);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

    const [completedRows, beans, stockSummaries, monthlyRows, inventoryAlertsRes, horizonDays] = await Promise.all([
        roastSessionApi.listCompletedDashboard(userId, lastMonthStart),
        beanApi.list(userId),
        beanStockEventApi.getStockSummariesByUser(userId),
        roastSessionApi.listCompletedWeightsSince(userId, sixMonthsAgo),
        inventoryAlertApi.listActive(userId),
        inventoryStore.getHorizonDays(),
    ]);

    const horizonEnd14 = format(addDays(now, 14), 'yyyy-MM-dd');
    const rangeBatches14 = await planBatchApi.listForDateRange(userId, today, horizonEnd14);

    const upcomingBatches: UpcomingBatch[] = rangeBatches14
        .filter((b) => isUpcomingBatch(b, today))
        .sort(
            (a, b) =>
                (a.scheduled_date ?? today).localeCompare(b.scheduled_date ?? today) || a.order_index - b.order_index,
        )
        .slice(0, 5)
        .map((b) => {
            const beanId = b.bean_id ?? '';
            const summary = beanId ? stockSummaries?.[beanId] : undefined;
            const recurring = !!b.recurrence_rule_id;
            return {
                id: b.id,
                bean_name: b.bean_name,
                batch_count: b.batch_count,
                target_roasted_kg: b.target_roasted_kg,
                status: b.status,
                date: b.scheduled_date ?? today,
                isRecurring: recurring,
                stockShort: recurring && isBatchStockShort(b, summary, horizonDays),
            };
        });

    const completed = completedRows.filter(
        (s): s is (typeof completedRows)[number] & { roasted_at: string } => !!s.roasted_at,
    );
    const { thisMonth, lastMonth } = splitDashboardMonths(completed, now);
    const toRecent = (s: (typeof completed)[number]): DashboardRecentSession => ({
        id: s.id,
        roasted_at: s.roasted_at,
        weight_grams: s.weight_grams,
        roastDurationSec: sessionRoastMetrics(s).roastDurationSec,
        drop_temp_celsius: s.drop_temp_celsius,
        roast_level: s.roast_level,
        bean_label: s.bean_label,
        beans: s.beans,
        roast_profiles: s.roast_profiles,
    });

    const sumKg = (arr: typeof completed) => arr.reduce((acc, s) => acc + s.weight_grams, 0) / 1000;

    const monthlyMap = new Map<string, number>();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthlyMap.set(`${d.getFullYear()}-${d.getMonth()}`, 0);
    }
    for (const s of monthlyRows) {
        if (!s.roasted_at) continue;
        const d = new Date(s.roasted_at);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (monthlyMap.has(key)) {
            monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + 1);
        }
    }
    const monthlyBatches: MonthlyBatch[] = Array.from(monthlyMap, ([key, batches]) => {
        const [year, month] = key.split('-').map(Number);
        return { date: new Date(year, month, 1), batches };
    });

    const beanMeta = new Map(beans.map((b) => [b.id, b]));
    const inventoryAlerts: DashboardInventoryAlert[] = (inventoryAlertsRes ?? [])
        .map((row) => mapDbAlert(row, beanMeta.get(row.bean_id)))
        .sort((a, b) => {
            const rank: Record<DashboardInventoryAlert['reason'], number> = { out: 0, schedule: 1, low: 2 };
            return rank[a.reason] - rank[b.reason] || a.effectiveGrams - b.effectiveGrams;
        });

    return {
        batchesThisMonth: thisMonth.length,
        batchesLastMonth: lastMonth.length,
        kgRoastedThisMonth: sumKg(thisMonth),
        kgRoastedLastMonth: sumKg(lastMonth),
        avgDurationSeconds: averageRoastDurationSec(thisMonth),
        avgDurationLastMonthSeconds: averageRoastDurationSec(lastMonth),
        recentSessions: completed.slice(0, 5).map(toRecent),
        upcomingBatches,
        inventoryAlerts,
        monthlyBatches,
    };
};

const EMPTY: Omit<DashboardData, 'loading' | 'error'> = {
    batchesThisMonth: 0,
    batchesLastMonth: 0,
    kgRoastedThisMonth: 0,
    kgRoastedLastMonth: 0,
    avgDurationSeconds: 0,
    avgDurationLastMonthSeconds: 0,
    recentSessions: [],
    upcomingBatches: [],
    inventoryAlerts: [],
    monthlyBatches: [],
};

export const useDashboard = (userId: string): DashboardData => {
    const { data, isLoading, error } = useQuery({
        queryKey: dashboardKeys.all(userId),
        queryFn: () => fetchDashboard(userId),
        enabled: !!userId,
        staleTime: 5 * 60 * 1000,
    });

    return {
        ...(data ?? EMPTY),
        loading: isLoading,
        error: error instanceof Error ? error.message : null,
    };
};
