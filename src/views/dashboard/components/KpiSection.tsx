import type { DailyRoastMetric, MonthlyBatch } from '@features/dashboard-summary';
import type { CoffeeFuturesData } from '@shared/api/coffee-futures';
import { pctChange } from '@shared/lib/format';
import { MetricTrendChart } from '@shared/ui/MetricTrendChart';
import { endOfMonth, isSameMonth, startOfMonth } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { formatDate, localeForDate } from '../lib/format';
import { KpiCard } from './KpiCard';
import { MonthlyChartSection } from './MonthlyChartSection';

interface KpiSectionProps {
    batchesThisMonth: number;
    batchesLastMonth: number;
    kgRoastedThisMonth: number;
    kgRoastedLastMonth: number;
    month: Date;
    dailyMetrics: DailyRoastMetric[];
    monthlyBatches: MonthlyBatch[];
    loading: boolean;
    coffeeFutures: CoffeeFuturesData | null;
    coffeeFuturesLoading: boolean;
    coffeeFuturesRefreshing: boolean;
    onRefreshCoffeeFutures: () => void;
}

const formatKg = (value: number) => `${value.toFixed(1)} kg`;

export const KpiSection = ({
    batchesThisMonth,
    batchesLastMonth,
    kgRoastedThisMonth,
    kgRoastedLastMonth,
    month,
    dailyMetrics,
    monthlyBatches,
    loading,
    coffeeFutures,
    coffeeFuturesLoading,
    coffeeFuturesRefreshing,
    onRefreshCoffeeFutures,
}: KpiSectionProps) => {
    const { t } = useTranslation();
    const now = new Date();
    const current = isSameMonth(month, now);
    const rangeEnd = current ? now : endOfMonth(month);
    const range = `${formatDate(startOfMonth(month))} – ${formatDate(rangeEnd)}`;
    const monthName = month.toLocaleDateString(localeForDate(), { month: 'short', year: 'numeric' });
    const batchLabel = current
        ? t('dashboard.kpi.batchesThisMonth')
        : t('dashboard.kpi.batchesInMonth', { month: monthName });
    const comparison = t('dashboard.comparedToLastMonth');
    const daily = dailyMetrics.map((day) => ({ ...day, label: formatDate(day.date) }));
    const coffeePrice = coffeeFutures && Number.isFinite(coffeeFutures.price) ? coffeeFutures.price.toFixed(2) : '—';
    const coffeeChange =
        coffeeFutures &&
        Number.isFinite(coffeeFutures.price) &&
        Number.isFinite(coffeeFutures.previousClose) &&
        coffeeFutures.previousClose !== 0
            ? pctChange(coffeeFutures.price, coffeeFutures.previousClose)
            : '';

    return (
        <div
            className="mb-8 grid overflow-hidden rounded-2xl border border-border bg-main-bg lg:grid-cols-6"
            data-testid="dashboard-metrics"
            aria-busy={loading}
        >
            <KpiCard
                label={t('dashboard.kpi.beansRoasted')}
                value={loading ? '—' : kgRoastedThisMonth.toFixed(1)}
                unit="kg"
                change={loading ? '' : pctChange(kgRoastedThisMonth, kgRoastedLastMonth)}
                caption={range}
                comparison={comparison}
                className="border-b border-border lg:col-span-4 lg:border-r"
            >
                <div className="h-32 lg:h-36">
                    {!loading && (
                        <MetricTrendChart
                            label={t('dashboard.kpi.beansRoasted')}
                            data={daily.map((day) => ({ label: day.label, value: day.kgRoasted }))}
                            formatValue={formatKg}
                        />
                    )}
                </div>
            </KpiCard>
            <KpiCard
                label={batchLabel}
                value={loading ? '—' : String(batchesThisMonth)}
                change={loading ? '' : pctChange(batchesThisMonth, batchesLastMonth)}
                caption={range}
                comparison={comparison}
                className="border-b border-border lg:col-span-2"
            >
                <div className="h-32 lg:h-36">
                    {!loading && (
                        <MetricTrendChart
                            label={batchLabel}
                            data={daily.map((day) => ({ label: day.label, value: day.batches }))}
                        />
                    )}
                </div>
            </KpiCard>
            <KpiCard
                label={t('dashboard.kpi.coffeeFutures')}
                value={coffeeFuturesLoading ? '—' : coffeePrice}
                unit="US ¢/lb"
                change={coffeeFuturesLoading ? '' : coffeeChange}
                caption="ICE · Coffee C"
                comparison={t('dashboard.comparedToPreviousClose')}
                className="border-b border-border lg:col-span-3 lg:border-r lg:border-b-0"
                onRefresh={onRefreshCoffeeFutures}
                refreshing={coffeeFuturesRefreshing}
            >
                <div className="flex h-24 flex-col justify-end lg:h-28">
                    <div className="flex items-baseline justify-between gap-3 border-t border-divider pt-4 text-xs">
                        <span className="text-muted">{t('dashboard.previousClose')}</span>
                        <span className="text-secondary">
                            {coffeeFuturesLoading || !coffeeFutures || !Number.isFinite(coffeeFutures.previousClose)
                                ? '—'
                                : coffeeFutures.previousClose.toFixed(2)}
                        </span>
                    </div>
                    {!coffeeFuturesLoading && coffeePrice === '—' && (
                        <p className="mt-3 text-xs text-muted">{t('common.unavailable')}</p>
                    )}
                </div>
            </KpiCard>
            <MonthlyChartSection monthlyBatches={monthlyBatches} loading={loading} />
        </div>
    );
};
