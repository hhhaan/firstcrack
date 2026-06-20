import { beanStockEventApi } from '@entities/bean-stock-event';
import { planBatchApi } from '@entities/plan';
import { isBatchStockShort, STOCK_RESERVATION_HORIZON_DAYS } from '@shared/lib/batch-stock';
import { supabase } from '@shared/lib/supabase';
import type { Bean, RoastSessionWithRelations } from '@shared/types/database.types';
import { useQuery } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';

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

export interface InventoryAlert {
    id: string;
    name: string;
    effectiveGrams: number;
    capacityGrams: number;
    lowStockThresholdGrams: number;
    reason: 'out' | 'schedule' | 'low';
}

export interface DashboardData {
    batchesThisMonth: number;
    batchesLastMonth: number;
    kgRoastedThisMonth: number;
    kgRoastedLastMonth: number;
    avgDurationSeconds: number;
    avgDurationLastMonthSeconds: number;
    recentSessions: RoastSessionWithRelations[];
    upcomingBatches: UpcomingBatch[];
    inventoryAlerts: InventoryAlert[];
    monthlyBatches: MonthlyBatch[];
    loading: boolean;
    error: string | null;
}

const fetchDashboard = async (userId: string): Promise<Omit<DashboardData, 'loading' | 'error'>> => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

    const [completedRes, alertsRes, stockSummaries, monthlyRes] = await Promise.all([
        supabase
            .from('roast_sessions')
            .select('*, beans(name, origin), roast_profiles!profile_id(name, target_level)')
            .eq('user_id', userId)
            .eq('status', 'completed')
            .gte('roasted_at', lastMonthStart)
            .order('roasted_at', { ascending: false }),

        // 전체 가져와서 클라이언트에서 필터 (PostgREST는 컬럼 간 비교 미지원)
        supabase.from('beans').select('*').eq('user_id', userId),

        // 재고 요약 (이벤트 기반)
        beanStockEventApi.getStockSummariesByUser(userId),

        supabase
            .from('roast_sessions')
            .select('roasted_at, weight_grams')
            .eq('user_id', userId)
            .eq('status', 'completed')
            .gte('roasted_at', sixMonthsAgo)
            .order('roasted_at', { ascending: true }),
    ]);

    if (completedRes.error) throw completedRes.error;
    if (alertsRes.error) throw alertsRes.error;
    if (monthlyRes.error) throw monthlyRes.error;

    const horizonEnd14 = format(addDays(now, 14), 'yyyy-MM-dd');
    const horizonEnd28 = format(addDays(now, STOCK_RESERVATION_HORIZON_DAYS), 'yyyy-MM-dd');

    const [rangeBatches14, rangeBatches28] = await Promise.all([
        planBatchApi.listForDateRange(userId, today, horizonEnd14),
        planBatchApi.listForDateRange(userId, today, horizonEnd28),
    ]);

    const isBatchPending = (b: { status: string; completed_sessions: number; batch_count: number }) =>
        b.status !== 'done' && b.status !== 'skipped' && b.completed_sessions < b.batch_count;

    const scheduleShortBeanIds = new Set<string>();
    for (const b of rangeBatches28) {
        if (!b.bean_id || !isBatchPending(b)) continue;
        const effectiveGrams = stockSummaries?.[b.bean_id]?.effectiveGrams ?? 0;
        if (isBatchStockShort(b, effectiveGrams)) {
            scheduleShortBeanIds.add(b.bean_id);
        }
    }

    const upcomingBatches: UpcomingBatch[] = rangeBatches14
        .filter((b) => {
            if (b.status === 'done' || b.status === 'skipped') return false;
            if (b.completed_sessions >= b.batch_count) return false;
            return true;
        })
        .sort(
            (a, b) =>
                (a.scheduled_date ?? today).localeCompare(b.scheduled_date ?? today) || a.order_index - b.order_index,
        )
        .slice(0, 5)
        .map((b) => {
            const beanId = b.bean_id ?? '';
            const effectiveGrams = beanId ? (stockSummaries?.[beanId]?.effectiveGrams ?? 0) : 0;
            const recurring = !!b.recurrence_rule_id;
            return {
                id: b.id,
                bean_name: b.bean_name,
                batch_count: b.batch_count,
                target_roasted_kg: b.target_roasted_kg,
                status: b.status,
                date: b.scheduled_date ?? today,
                isRecurring: recurring,
                stockShort: recurring && isBatchStockShort(b, effectiveGrams),
            };
        });

    const completed = completedRes.data as RoastSessionWithRelations[];
    const thisMonth = completed.filter((s) => s.roasted_at! >= thisMonthStart);
    const lastMonth = completed.filter((s) => s.roasted_at! < thisMonthStart);

    const sumKg = (arr: typeof completed) => arr.reduce((acc, s) => acc + s.weight_grams, 0) / 1000;
    const avgDuration = (arr: typeof completed) =>
        arr.length > 0 ? arr.reduce((acc, s) => acc + (s.duration_seconds ?? 0), 0) / arr.length : 0;

    const monthlyMap = new Map<string, number>();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthlyMap.set(`${d.getFullYear()}-${d.getMonth()}`, 0);
    }
    for (const s of (monthlyRes.data ?? []) as { roasted_at: string | null }[]) {
        const d = new Date(s.roasted_at!);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (monthlyMap.has(key)) {
            monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + 1);
        }
    }
    const monthlyBatches: MonthlyBatch[] = Array.from(monthlyMap, ([key, batches]) => {
        const [year, month] = key.split('-').map(Number);
        return { date: new Date(year, month, 1), batches };
    });

    const allBeans = (alertsRes.data ?? []) as Bean[];
    const inventoryAlerts: InventoryAlert[] = allBeans
        .map((b) => {
            const effectiveGrams = stockSummaries?.[b.id]?.effectiveGrams ?? 0;
            let reason: InventoryAlert['reason'] | null = null;
            if (effectiveGrams <= 0) {
                reason = 'out';
            } else if (scheduleShortBeanIds.has(b.id)) {
                reason = 'schedule';
            } else if (effectiveGrams <= b.low_stock_threshold_grams) {
                reason = 'low';
            }
            if (!reason) return null;
            return {
                id: b.id,
                name: b.name,
                effectiveGrams,
                capacityGrams: b.capacity_grams,
                lowStockThresholdGrams: b.low_stock_threshold_grams,
                reason,
            };
        })
        .filter((item): item is InventoryAlert => item !== null)
        .sort((a, b) => {
            const rank = { out: 0, schedule: 1, low: 2 };
            return rank[a.reason] - rank[b.reason] || a.effectiveGrams - b.effectiveGrams;
        });

    return {
        batchesThisMonth: thisMonth.length,
        batchesLastMonth: lastMonth.length,
        kgRoastedThisMonth: sumKg(thisMonth),
        kgRoastedLastMonth: sumKg(lastMonth),
        avgDurationSeconds: avgDuration(thisMonth),
        avgDurationLastMonthSeconds: avgDuration(lastMonth),
        recentSessions: completed.slice(0, 5),
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
        queryKey: ['dashboard', userId],
        queryFn: () => fetchDashboard(userId),
        enabled: !!userId,
        // 5분 캐시 — 날짜 기반 집계 데이터라 Infinity 대신 짧게 설정
        staleTime: 5 * 60 * 1000,
    });

    return {
        ...(data ?? EMPTY),
        loading: isLoading,
        error: error instanceof Error ? error.message : null,
    };
};
