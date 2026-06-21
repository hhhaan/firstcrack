import { useRoastingStore } from '@features/active-roast';
import { i18n } from '@shared/i18n';
import { durationDiff, formatDuration, pctChange } from '@shared/lib/format';
import { useAuthStore } from '@shared/store/auth';
import type { View } from '@shared/types/view';
import { KpiCard } from '@shared/ui/KpiCard';
import { MonthlyBatchesChart } from '@shared/ui/MonthlyBatchesChart';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';
import {
    ArrowRight,
    Calendar,
    CheckCircle,
    ChevronRight,
    Clock,
    Coffee,
    Droplets,
    Thermometer,
    TrendingUp,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { alertBg, alertColor, levelBg, levelColor } from './constants';
import { formatDate, formatMonth, formatWeight, getGreeting, localeForDate } from './lib';
import { useDashboard } from './useDashboard';
import { useWeather } from './useWeather';

interface DashboardProps {
    onNavigate: (view: View) => void;
}

const KPI_STATS = [
    {
        label: 'dashboard.kpi.batchesThisMonth',
        field: 'batchesThisMonth',
        changeField: 'batchesLastMonth' as const,
        icon: Coffee,
    },
    {
        label: 'dashboard.kpi.beansRoasted',
        field: 'kgRoastedThisMonth',
        changeField: 'kgRoastedLastMonth' as const,
        icon: TrendingUp,
    },
    {
        label: 'dashboard.kpi.avgRoastTime',
        field: 'avgDurationSeconds',
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

export const Dashboard = ({ onNavigate }: DashboardProps) => {
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const db = useDashboard(userId);
    const isRoasting = useRoastingStore((s) => s.isRoasting);
    const weather = useWeather();
    const { t } = useTranslation();

    const stats = useMemo(
        () =>
            KPI_STATS.map((kpi) => ({
                label: t(kpi.label),
                value:
                    kpi.field === null
                        ? '96%'
                        : db.loading
                          ? '—'
                          : String(
                                kpi.field === 'batchesThisMonth'
                                    ? db.batchesThisMonth
                                    : kpi.field === 'kgRoastedThisMonth'
                                      ? `${db.kgRoastedThisMonth.toFixed(1)}`
                                      : formatDuration(db.avgDurationSeconds),
                            ),
                change:
                    kpi.changeField === null
                        ? '+2%'
                        : db.loading
                          ? ''
                          : kpi.field === 'batchesThisMonth'
                            ? pctChange(db.batchesThisMonth, db.batchesLastMonth)
                            : kpi.field === 'kgRoastedThisMonth'
                              ? pctChange(db.kgRoastedThisMonth, db.kgRoastedLastMonth)
                              : durationDiff(db.avgDurationSeconds, db.avgDurationLastMonthSeconds),
                icon: kpi.icon,
            })),
        [db, t],
    );

    const chartData = useMemo(
        () =>
            db.monthlyBatches.map(({ date, batches }) => ({
                month: formatMonth(date),
                batches,
            })),
        [db.monthlyBatches, i18n.language],
    );

    return (
        <PageLayout>
            {/* Header */}
            <div className="mb-8 flex items-end justify-between">
                <div>
                    <h1 className="font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px] mb-1.5">
                        {t(`dashboard.greeting.${getGreeting()}`)}
                        {/* , Han */}
                    </h1>
                    <p className="text-[15px] text-secondary tracking-[0.15px] font-normal flex items-center gap-2.5">
                        {new Date().toLocaleDateString(localeForDate(), {
                            weekday: 'long',
                            month: 'long',
                            day: 'numeric',
                        })}
                        {weather.data && (
                            <>
                                <span className="text-muted/40">·</span>
                                <span className="flex items-center gap-1 text-muted">
                                    <Thermometer size={13} strokeWidth={1.5} />
                                    {weather.data.temperature}°C
                                </span>
                                <span className="flex items-center gap-1 text-muted">
                                    <Droplets size={13} strokeWidth={1.5} />
                                    {weather.data.humidity}%
                                </span>
                            </>
                        )}
                    </p>
                </div>
                <PillButton onClick={() => onNavigate('roast')}>
                    <span
                        className={`w-1.75 h-1.75 rounded-full inline-block ${isRoasting ? 'bg-palette-green animate-pulse' : 'bg-white/40'}`}
                    />
                    {t('dashboard.viewActiveRoast')}
                    <ArrowRight size={14} strokeWidth={2} />
                </PillButton>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-4 mb-8">
                {stats.map((stat) => (
                    <KpiCard key={stat.label} {...stat} />
                ))}
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-[1fr_320px] gap-5 mb-5">
                {/* Recent Sessions */}
                <div className="bg-main-bg rounded-lg overflow-hidden dark:border dark:border-[#585d61]">
                    <div className="px-6 pt-4.5 pb-3.5 flex items-center justify-between border-b border-divider">
                        <h2 className="text-[15px] font-medium text-primary tracking-[0.15px]">
                            {t('dashboard.recentSessions')}
                        </h2>
                        <button
                            onClick={() => onNavigate('history')}
                            className="flex items-center gap-1 text-[13px] font-medium text-muted bg-transparent border-0 cursor-pointer tracking-[0.14px]"
                        >
                            {t('dashboard.viewAll')} <ChevronRight size={13} strokeWidth={2} />
                        </button>
                    </div>
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="border-b border-divider">
                                {[
                                    t('dashboard.table.date'),
                                    t('dashboard.table.bean'),
                                    t('dashboard.table.profile'),
                                    t('dashboard.table.weight'),
                                    t('dashboard.table.dropTemp'),
                                    t('dashboard.table.duration'),
                                    t('dashboard.table.level'),
                                ].map((h) => (
                                    <th
                                        key={h}
                                        className="px-6 py-2.5 text-left text-xs font-medium text-muted tracking-[0.5px] uppercase"
                                    >
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {db.loading ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-8 text-center text-[13px] text-muted">
                                        {t('dashboard.loading')}
                                    </td>
                                </tr>
                            ) : db.recentSessions.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-8 text-center text-[13px] text-muted">
                                        {t('dashboard.noSessions')}
                                    </td>
                                </tr>
                            ) : (
                                db.recentSessions.map((session, i) => {
                                    const level = session.roast_level ?? '';
                                    return (
                                        <tr
                                            key={session.id}
                                            className={
                                                i < db.recentSessions.length - 1 ? 'border-b border-divider' : ''
                                            }
                                        >
                                            <td className="px-6 py-3 text-[13px] text-muted font-normal whitespace-nowrap">
                                                {session.roasted_at ? formatDate(session.roasted_at) : '—'}
                                            </td>
                                            <td className="px-6 py-3 text-[13px] text-primary font-medium tracking-[0.14px] whitespace-nowrap">
                                                {session.beans?.name ?? '—'}
                                            </td>
                                            <td className="px-6 py-3 text-[13px] text-secondary tracking-[0.14px] whitespace-nowrap">
                                                {session.roast_profiles?.name ?? '—'}
                                            </td>
                                            <td className="px-6 py-3 text-[13px] text-secondary whitespace-nowrap">
                                                {formatWeight(session.weight_grams)}
                                            </td>
                                            <td className="px-6 py-3 text-[13px] text-secondary font-mono whitespace-nowrap">
                                                {session.drop_temp_celsius ? `${session.drop_temp_celsius}°C` : '—'}
                                            </td>
                                            <td className="px-6 py-3 text-[13px] text-secondary font-mono whitespace-nowrap">
                                                {session.duration_seconds
                                                    ? formatDuration(session.duration_seconds)
                                                    : '—'}
                                            </td>
                                            <td className="px-6 py-3">
                                                {level && (
                                                    <span
                                                        className="text-[11px] font-medium px-2 py-0.75 rounded-full tracking-[0.14px] whitespace-nowrap"
                                                        style={{
                                                            color: levelColor[level] || 'var(--color-muted)',
                                                            background: levelBg[level] || 'var(--color-surface)',
                                                        }}
                                                    >
                                                        {level}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Monthly chart */}
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
                                    {db.loading ? '—' : db.batchesThisMonth}
                                </div>
                                <div className="text-xs text-muted tracking-[0.14px]">{t('dashboard.batches')}</div>
                            </div>
                            <div className="flex-1 text-center border-r border-divider max-w-[160px]">
                                <div className="text-[22px] font-semibold text-primary tracking-[-0.4px]">
                                    {db.loading ? '—' : db.kgRoastedThisMonth.toFixed(1)}
                                </div>
                                <div className="text-xs text-muted tracking-[0.14px]">{t('dashboard.kgRoasted')}</div>
                            </div>
                            <div className="flex-1 text-center border-r border-divider max-w-[160px]">
                                <div className="text-[22px] font-semibold text-primary tracking-[-0.4px]">
                                    {db.loading
                                        ? '—'
                                        : new Set(db.recentSessions.map((s) => s.beans?.origin).filter(Boolean)).size}
                                </div>
                                <div className="text-xs text-muted tracking-[0.14px]">{t('dashboard.beanOrigins')}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Upcoming + Inventory Alerts */}
            <div className="grid grid-cols-2 gap-5">
                {/* Upcoming */}
                <div className="bg-main-bg rounded-lg px-6 py-5 dark:border dark:border-[#585d61]">
                    <div className="flex items-center justify-between mb-3.5">
                        <h2 className="text-[15px] font-medium text-primary tracking-[0.15px]">
                            {t('dashboard.upcomingBatches')}
                        </h2>
                        <button
                            onClick={() => onNavigate('schedule')}
                            className="flex items-center justify-center border-none bg-transparent text-muted cursor-pointer hover:text-primary transition-colors p-0"
                        >
                            <ChevronRight size={13} strokeWidth={2} />
                        </button>
                    </div>
                    {db.loading ? (
                        <p className="text-[13px] text-muted py-2">{t('dashboard.loading')}</p>
                    ) : db.upcomingBatches.length === 0 ? (
                        <p className="text-[13px] text-muted py-2">{t('dashboard.noUpcoming')}</p>
                    ) : (
                        db.upcomingBatches.map((item, i) => (
                            <div
                                key={item.id}
                                className={`flex items-center gap-3 py-2.5 ${i < db.upcomingBatches.length - 1 ? 'border-b border-divider' : ''}`}
                            >
                                <div className="w-8.5 h-8.5 rounded-lg bg-surface-warm-solid flex items-center justify-center shrink-0">
                                    <Calendar size={14} strokeWidth={1.5} className="text-secondary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[13px] font-medium text-primary tracking-[0.14px] truncate">
                                            {item.bean_name}
                                        </span>
                                        <span className="shrink-0 text-[11px] font-medium text-secondary bg-surface px-1.5 py-0.5 rounded">
                                            {t('dashboard.batchCount', { count: item.batch_count })} ·{' '}
                                            {item.target_roasted_kg}kg
                                        </span>
                                    </div>
                                    <div className="text-xs text-muted tracking-[0.14px]">
                                        {item.date === new Date().toISOString().slice(0, 10)
                                            ? t('dashboard.today')
                                            : item.date}{' '}
                                        · {item.status}
                                        {item.stockShort && (
                                            <span className="ml-1.5 text-amber-600 font-medium">
                                                · {t('dashboard.upcomingStockShort')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Inventory Alerts */}
                <div className="bg-main-bg rounded-lg px-6 py-5 dark:border dark:border-[#585d61]">
                    <h2 className="text-[15px] font-medium text-primary tracking-[0.15px] mb-3.5">
                        {t('dashboard.inventoryAlerts')}
                    </h2>
                    {db.loading ? (
                        <p className="text-[13px] text-muted py-2">{t('dashboard.loading')}</p>
                    ) : db.inventoryAlerts.length === 0 ? (
                        <p className="text-[13px] text-muted py-2">{t('dashboard.allStockOk')}</p>
                    ) : (
                        db.inventoryAlerts.map((item, i) => {
                            const color = alertColor[item.reason] ?? '#FFFF54';
                            const bg = alertBg[item.reason] ?? 'rgba(255,255,84,0.2)';
                            const status =
                                item.reason === 'out'
                                    ? t('dashboard.outOfStock')
                                    : item.reason === 'schedule'
                                      ? t('dashboard.scheduleStockAlert')
                                      : t('dashboard.lowStock');
                            return (
                                <div
                                    key={item.id}
                                    className={`flex items-center gap-3 py-2.5 ${i < db.inventoryAlerts.length - 1 ? 'border-b border-divider' : ''}`}
                                >
                                    <div
                                        className="w-8.5 h-8.5 rounded-lg flex items-center justify-center shrink-0"
                                        style={{ background: bg }}
                                    >
                                        <Coffee size={14} strokeWidth={1.5} color={color} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-[13px] font-medium text-primary tracking-[0.14px]">
                                            {item.name}
                                        </div>
                                        <div className="text-xs text-muted tracking-[0.14px]">
                                            {t('dashboard.kgRemaining', {
                                                kg: (item.effectiveGrams / 1000).toFixed(2),
                                            })}
                                            {item.effectiveGrams < 0 && (
                                                <span className="block text-amber-600 mt-0.5">
                                                    {t('dashboard.scheduleReservedShortfall', {
                                                        kg: (Math.abs(item.effectiveGrams) / 1000).toFixed(2),
                                                    })}
                                                </span>
                                            )}
                                            {item.reason === 'schedule' && item.effectiveGrams >= 0 && (
                                                <span className="block text-amber-600 mt-0.5">
                                                    {t('dashboard.upcomingStockShort')}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <span
                                        className="text-[11px] font-medium px-2 py-0.75 rounded-full tracking-[0.14px] whitespace-nowrap"
                                        style={{ color, background: bg }}
                                    >
                                        {status}
                                    </span>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </PageLayout>
    );
};
