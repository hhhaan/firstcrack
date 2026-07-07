import { durationDiff, formatDuration, pctChange } from '@shared/lib/format';
import { Clock, Coffee, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CoffeeFuturesData } from '../api/useCoffeeFutures';
import { KpiCard } from './KpiCard';

interface KpiSectionProps {
    batchesThisMonth: number;
    batchesLastMonth: number;
    kgRoastedThisMonth: number;
    kgRoastedLastMonth: number;
    avgDurationSeconds: number;
    avgDurationLastMonthSeconds: number;
    loading: boolean;
    coffeeFutures: CoffeeFuturesData | null;
    coffeeFuturesLoading: boolean;
    coffeeFuturesRefreshing: boolean;
    onRefreshCoffeeFutures: () => void;
}

const KPI_STATS = [
    {
        label: 'dashboard.kpi.batchesThisMonth',
        field: 'batchesThisMonth' as const,
        changeField: 'batchesLastMonth' as const,
        icon: Coffee,
    },
    {
        label: 'dashboard.kpi.beansRoasted',
        field: 'kgRoastedThisMonth' as const,
        changeField: 'kgRoastedLastMonth' as const,
        icon: TrendingUp,
    },
    {
        label: 'dashboard.kpi.avgRoastTime',
        field: 'avgDurationSeconds' as const,
        changeField: 'avgDurationLastMonthSeconds' as const,
        icon: Clock,
    },
] as const;

const formatCoffeePrice = (price: number): string => (Number.isFinite(price) ? price.toFixed(2) : '—');

const computeCoffeeChange = (price: number, prev: number): string => {
    if (!Number.isFinite(price) || !Number.isFinite(prev) || prev === 0) return '';
    return pctChange(price, prev);
};

export const KpiSection = ({
    batchesThisMonth,
    batchesLastMonth,
    kgRoastedThisMonth,
    kgRoastedLastMonth,
    avgDurationSeconds,
    avgDurationLastMonthSeconds,
    loading,
    coffeeFutures,
    coffeeFuturesLoading,
    coffeeFuturesRefreshing,
    onRefreshCoffeeFutures,
}: KpiSectionProps) => {
    const { t } = useTranslation();

    const coffeeStat = useMemo(() => {
        if (coffeeFuturesLoading) {
            return { label: t('dashboard.kpi.coffeeFutures'), value: '—', change: '', icon: TrendingUp };
        }
        if (!coffeeFutures) {
            return {
                label: t('dashboard.kpi.coffeeFutures'),
                value: t('common.unavailable'),
                change: '',
                icon: TrendingUp,
            };
        }
        return {
            label: t('dashboard.kpi.coffeeFutures'),
            value: formatCoffeePrice(coffeeFutures.price),
            change: computeCoffeeChange(coffeeFutures.price, coffeeFutures.previousClose),
            icon: TrendingUp,
        };
    }, [coffeeFutures, coffeeFuturesLoading, t]);

    const stats = useMemo(
        () =>
            KPI_STATS.map((kpi) => ({
                label: t(kpi.label),
                value: loading
                    ? '—'
                    : String(
                          kpi.field === 'batchesThisMonth'
                              ? batchesThisMonth
                              : kpi.field === 'kgRoastedThisMonth'
                                ? `${kgRoastedThisMonth.toFixed(1)}`
                                : formatDuration(avgDurationSeconds),
                      ),
                change: loading
                    ? ''
                    : kpi.field === 'batchesThisMonth'
                      ? pctChange(batchesThisMonth, batchesLastMonth)
                      : kpi.field === 'kgRoastedThisMonth'
                        ? pctChange(kgRoastedThisMonth, kgRoastedLastMonth)
                        : durationDiff(avgDurationSeconds, avgDurationLastMonthSeconds),
                icon: kpi.icon,
            })),
        [
            batchesThisMonth,
            batchesLastMonth,
            kgRoastedThisMonth,
            kgRoastedLastMonth,
            avgDurationSeconds,
            avgDurationLastMonthSeconds,
            loading,
            t,
        ],
    );

    return (
        <div className="grid grid-cols-4 gap-4 mb-8">
            {stats.map((stat) => (
                <KpiCard key={stat.label} {...stat} />
            ))}
            <KpiCard {...coffeeStat} onRefresh={onRefreshCoffeeFutures} refreshing={coffeeFuturesRefreshing} />
        </div>
    );
};
