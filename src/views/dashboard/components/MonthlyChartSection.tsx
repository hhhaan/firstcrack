import type { MonthlyBatch } from '@features/dashboard-summary';
import { MetricTrendChart } from '@shared/ui/MetricTrendChart';
import { useTranslation } from 'react-i18next';
import { formatMonth } from '../lib/format';
import { KpiCard } from './KpiCard';

interface MonthlyChartSectionProps {
    monthlyBatches: MonthlyBatch[];
    loading: boolean;
}

export const MonthlyChartSection = ({ monthlyBatches, loading }: MonthlyChartSectionProps) => {
    const { t } = useTranslation();
    const total = monthlyBatches.reduce((sum, month) => sum + month.batches, 0);

    return (
        <KpiCard
            label={t('dashboard.monthlyBatches')}
            value={loading ? '—' : String(total)}
            change=""
            caption={
                monthlyBatches.length > 0
                    ? `${formatMonth(monthlyBatches[0].date)} – ${formatMonth(monthlyBatches[monthlyBatches.length - 1].date)}`
                    : t('dashboard.lastSixMonths')
            }
            comparison=""
        >
            <div className="h-24 lg:h-28">
                {!loading && (
                    <MetricTrendChart
                        label={t('dashboard.monthlyBatches')}
                        data={monthlyBatches.map((month) => ({ label: formatMonth(month.date), value: month.batches }))}
                    />
                )}
            </div>
        </KpiCard>
    );
};
