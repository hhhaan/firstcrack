import { durationDiff, formatDuration, pctChange } from '@shared/lib/format';
import { CheckCircle, Clock, Coffee, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { KpiCard } from './KpiCard';

interface KpiSectionProps {
    batchesThisMonth: number;
    batchesLastMonth: number;
    kgRoastedThisMonth: number;
    kgRoastedLastMonth: number;
    avgDurationSeconds: number;
    avgDurationLastMonthSeconds: number;
    loading: boolean;
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
    {
        label: 'dashboard.kpi.successRate',
        field: null,
        changeField: null,
        icon: CheckCircle,
    },
] as const;

export const KpiSection = ({
    batchesThisMonth,
    batchesLastMonth,
    kgRoastedThisMonth,
    kgRoastedLastMonth,
    avgDurationSeconds,
    avgDurationLastMonthSeconds,
    loading,
}: KpiSectionProps) => {
    const { t } = useTranslation();

    const stats = useMemo(
        () =>
            KPI_STATS.map((kpi) => ({
                label: t(kpi.label),
                value:
                    kpi.field === null
                        ? '96%'
                        : loading
                          ? '—'
                          : String(
                                kpi.field === 'batchesThisMonth'
                                    ? batchesThisMonth
                                    : kpi.field === 'kgRoastedThisMonth'
                                      ? `${kgRoastedThisMonth.toFixed(1)}`
                                      : formatDuration(avgDurationSeconds),
                            ),
                change:
                    kpi.changeField === null
                        ? '+2%'
                        : loading
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
        </div>
    );
};
