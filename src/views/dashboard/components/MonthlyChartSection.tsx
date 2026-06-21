import { MonthlyBatchesChart } from '@shared/ui/MonthlyBatchesChart';
import { Calendar } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MonthlyBatch } from '../api/useDashboard';
import { formatMonth } from '../lib/format';

interface MonthlyChartSectionProps {
    monthlyBatches: MonthlyBatch[];
    batchesThisMonth: number;
    kgRoastedThisMonth: number;
    recentSessions: { beans?: { origin?: string | null } | null }[];
    loading: boolean;
}

export const MonthlyChartSection = ({
    monthlyBatches,
    batchesThisMonth,
    kgRoastedThisMonth,
    recentSessions,
    loading,
}: MonthlyChartSectionProps) => {
    const { t } = useTranslation();

    const chartData = useMemo(
        () =>
            monthlyBatches.map(({ date, batches }) => ({
                month: formatMonth(date),
                batches,
            })),
        [monthlyBatches],
    );

    return (
        <div className="bg-main-bg rounded-lg px-6 py-5 w-full flex flex-col dark:border dark:border-[#585d61]">
            <div className="flex items-center justify-between mb-5 shrink-0">
                <h2 className="text-[15px] font-medium text-primary tracking-[0.15px]">
                    {t('dashboard.monthlyBatches')}
                </h2>
                <Calendar size={15} strokeWidth={1.5} color="var(--color-muted)" />
            </div>
            <div className="flex-1 min-h-[120px]">
                <MonthlyBatchesChart data={chartData} />
            </div>

            <div className="mt-5 pt-4 border-t border-divider shrink-0">
                <div className="text-xs text-muted mb-3 tracking-[0.5px] uppercase font-medium text-center">
                    {t('dashboard.thisMonth')}
                </div>
                <div className="flex items-center justify-center gap-0 w-full">
                    <div className="flex-1 text-center border-x border-divider max-w-[160px]">
                        <div className="text-[22px] font-semibold text-primary tracking-[-0.4px]">
                            {loading ? '—' : batchesThisMonth}
                        </div>
                        <div className="text-xs text-muted tracking-[0.14px]">{t('dashboard.batches')}</div>
                    </div>
                    <div className="flex-1 text-center border-r border-divider max-w-[160px]">
                        <div className="text-[22px] font-semibold text-primary tracking-[-0.4px]">
                            {loading ? '—' : kgRoastedThisMonth.toFixed(1)}
                        </div>
                        <div className="text-xs text-muted tracking-[0.14px]">{t('dashboard.kgRoasted')}</div>
                    </div>
                    <div className="flex-1 text-center border-r border-divider max-w-[160px]">
                        <div className="text-[22px] font-semibold text-primary tracking-[-0.4px]">
                            {loading ? '—' : new Set(recentSessions.map((s) => s.beans?.origin).filter(Boolean)).size}
                        </div>
                        <div className="text-xs text-muted tracking-[0.14px]">{t('dashboard.beanOrigins')}</div>
                    </div>
                </div>
            </div>
        </div>
    );
};
