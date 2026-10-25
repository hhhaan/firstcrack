import { roastSessionApi } from '@entities/roast';
import { dashboardKeys } from '@shared/lib/query-keys';
import { useQuery } from '@tanstack/react-query';
import { addMonths, format, isSameMonth, startOfMonth } from 'date-fns';
import { type DailyRoastMetric, dashboardMonthStats } from '../lib/dashboard-roast-stats';

const EMPTY_MONTH = {
    batchesThisMonth: 0,
    batchesLastMonth: 0,
    kgRoastedThisMonth: 0,
    kgRoastedLastMonth: 0,
    dailyMetrics: [] as DailyRoastMetric[],
};

/** KPIs for a month other than the current one. The current month stays on `useDashboard`. */
export const useDashboardMonth = (userId: string, month: Date) => {
    const current = isSameMonth(month, new Date());
    const ym = format(startOfMonth(month), 'yyyy-MM');
    const { data, isLoading } = useQuery({
        queryKey: dashboardKeys.month(userId, ym),
        queryFn: async () => {
            const from = startOfMonth(addMonths(month, -1)).toISOString();
            const until = startOfMonth(addMonths(month, 1)).toISOString();
            const rows = await roastSessionApi.listCompletedWeightsSince(userId, from, until);
            return dashboardMonthStats(rows, month);
        },
        enabled: !!userId && !current,
        staleTime: 5 * 60 * 1000,
    });

    return {
        ...EMPTY_MONTH,
        ...data,
        loading: !current && isLoading,
    };
};
