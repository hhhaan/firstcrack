import { useRoastingStore } from '@features/active-roast';
import { getDateFnsLocale, i18n } from '@shared/i18n';
import { useAuthStore } from '@shared/store/auth';
import type { View } from '@shared/types/view';
import { KpiCard } from '@shared/ui/KpiCard';
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
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import type { MonthlyBatch } from './useDashboard';
import { useDashboard } from './useDashboard';
import { useWeather } from './useWeather';

interface DashboardProps {
    onNavigate: (view: View) => void;
}

interface BarCanvasProps {
    data: MonthlyBatch[];
}

const BarCanvas = ({ data }: BarCanvasProps) => {
    const { t } = useTranslation();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dfLocale = i18n.language === 'ko' ? enUS : getDateFnsLocale();

    const draw = (canvas: HTMLCanvasElement) => {
        const dpr = window.devicePixelRatio || 1;
        const W = canvas.offsetWidth;
        const H = canvas.offsetHeight;
        if (!W || !H) return;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = `${W}px`;
        canvas.style.height = `${H}px`;

        const ctx = canvas.getContext('2d')!;
        ctx.scale(dpr, dpr);

        const cs = getComputedStyle(document.documentElement);
        const isDark = document.documentElement.classList.contains('dark');
        const colorPrimary = isDark ? '#e5e5e5' : '#0B0B0B';
        const colorMuted = cs.getPropertyValue('--color-muted').trim() || '#9ca3af';

        const maxVal = Math.max(...data.map((d) => d.batches), 1);
        const padL = 32;
        const padR = 32;
        const padT = 8;
        const padB = 28;
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;
        const barW = Math.min(24, (plotW / data.length) * 0.4);
        const gap = plotW / data.length;

        ctx.strokeStyle = 'rgba(0,0,0,0.05)';
        ctx.lineWidth = 1;
        ctx.fillStyle = colorMuted;
        ctx.font = '11px sans-serif';
        for (let i = 0; i <= 3; i++) {
            const y = padT + plotH - (i / 3) * plotH;
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(padL + plotW, y);
            ctx.stroke();
            ctx.textAlign = 'right';
            ctx.fillText(String(Math.round((i / 3) * maxVal)), padL - 8, y + 4);
        }

        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';

        data.forEach((d, i) => {
            const centerX = padL + gap * i + gap / 2;
            const x = centerX - barW / 2;
            const barH = (d.batches / maxVal) * plotH;
            const y = padT + plotH - barH;
            const r = 4;

            ctx.fillStyle = colorPrimary;
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + barW - r, y);
            ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
            ctx.lineTo(x + barW, y + barH);
            ctx.lineTo(x, y + barH);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = colorMuted;
            ctx.fillText(format(d.date, 'MMM', { locale: dfLocale }), centerX, H - 6);
        });
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        draw(canvas);
        const obs = new ResizeObserver(() => {
            if (canvas) draw(canvas);
        });
        obs.observe(canvas.parentElement!);
        return () => obs.disconnect();
    }, [data, dfLocale]);

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        const tt = tooltipRef.current;
        if (!canvas || !tt) return;

        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const W = canvas.offsetWidth;
        const padL = 28;
        const padR = 8;
        const plotW = W - padL - padR;
        const gap = plotW / data.length;

        const idx = Math.floor((mx - padL) / gap);
        if (idx < 0 || idx >= data.length) {
            tt.style.display = 'none';
            return;
        }

        tt.textContent = `${format(data[idx].date, 'MMM', { locale: dfLocale })}: ${data[idx].batches} ${t('dashboard.batches')}`;
        tt.style.display = 'block';
        tt.style.left = `${e.clientX - rect.left + 10}px`;
        tt.style.top = `${e.clientY - rect.top - 30}px`;
    };

    return (
        <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
            <canvas
                ref={canvasRef}
                className="block w-full h-full"
                onMouseMove={handleMouseMove}
                onMouseLeave={() => {
                    if (tooltipRef.current) tooltipRef.current.style.display = 'none';
                }}
            />
            <div
                ref={tooltipRef}
                className="absolute pointer-events-none bg-white rounded-[10px] px-3 py-1.5 text-[13px] whitespace-nowrap z-10"
                style={{
                    display: 'none',
                }}
            />
        </div>
    );
};

const levelColor: Record<string, string> = {
    Light: 'var(--color-palette-yellow)',
    'Medium-Light': 'var(--color-palette-teal)',
    Medium: 'var(--color-palette-blue)',
    'Medium-Dark': 'var(--color-palette-purple)',
    Dark: 'var(--color-palette-violet)',
};

const levelBg: Record<string, string> = {
    Light: 'color-mix(in srgb, var(--color-palette-yellow) 20%, transparent)',
    'Medium-Light': 'color-mix(in srgb, var(--color-palette-teal) 15%, transparent)',
    Medium: 'color-mix(in srgb, var(--color-palette-blue) 12%, transparent)',
    'Medium-Dark': 'color-mix(in srgb, var(--color-palette-purple) 12%, transparent)',
    Dark: 'color-mix(in srgb, var(--color-palette-violet) 12%, transparent)',
};

const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
};

const formatDate = (iso: string) => {
    const d = new Date(iso);
    const lang = i18n.language === 'zh-CN' ? 'zh-CN' : i18n.language;
    return d.toLocaleDateString(lang, { month: 'short', day: 'numeric' });
};

const pctChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? '+∞%' : '0%';
    const diff = ((current - previous) / previous) * 100;
    return `${diff >= 0 ? '+' : ''}${Math.round(diff)}%`;
};

const durationDiff = (current: number, previous: number) => {
    const diff = Math.round(current - previous);
    return `${diff >= 0 ? '+' : '-'}${formatDuration(Math.abs(diff))}`;
};

export const Dashboard = ({ onNavigate }: DashboardProps) => {
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const db = useDashboard(userId);
    const isRoasting = useRoastingStore((s) => s.isRoasting);
    const weather = useWeather();
    const { t } = useTranslation();

    const stats = [
        {
            label: t('dashboard.kpi.batchesThisMonth'),
            value: db.loading ? '—' : String(db.batchesThisMonth),
            change: db.loading ? '' : pctChange(db.batchesThisMonth, db.batchesLastMonth),
            icon: Coffee,
        },
        {
            label: t('dashboard.kpi.beansRoasted'),
            value: db.loading ? '—' : `${db.kgRoastedThisMonth.toFixed(1)} kg`,
            change: db.loading ? '' : pctChange(db.kgRoastedThisMonth, db.kgRoastedLastMonth),
            icon: TrendingUp,
        },
        {
            label: t('dashboard.kpi.avgRoastTime'),
            value: db.loading ? '—' : formatDuration(db.avgDurationSeconds),
            change: db.loading ? '' : durationDiff(db.avgDurationSeconds, db.avgDurationLastMonthSeconds),
            icon: Clock,
        },
        {
            label: t('dashboard.kpi.successRate'),
            value: '96%',
            change: '+2%',
            icon: CheckCircle,
        },
    ];

    return (
        <PageLayout>
            {/* Header */}
            <div className="mb-8 flex items-end justify-between">
                <div>
                    <h1 className="font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px] mb-1.5">
                        {t(
                            `dashboard.greeting.${(() => {
                                const h = new Date().getHours();
                                if (h < 12) return 'morning';
                                if (h < 18) return 'afternoon';
                                return 'evening';
                            })()}`,
                        )}
                        {/* , Han */}
                    </h1>
                    <p className="text-[15px] text-secondary tracking-[0.15px] font-normal flex items-center gap-2.5">
                        {new Date().toLocaleDateString(
                            i18n.language === 'ko'
                                ? 'en-US'
                                : i18n.language === 'zh-CN'
                                  ? 'zh-CN'
                                  : i18n.language === 'ja'
                                    ? 'ja-JP'
                                    : 'en-US',
                            { weekday: 'long', month: 'long', day: 'numeric' },
                        )}
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
                                                {session.weight_grams >= 1000
                                                    ? `${session.weight_grams / 1000}kg`
                                                    : `${session.weight_grams}g`}
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
                        <BarCanvas data={db.monthlyBatches} />
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
                            <div className="flex-1 text-center max-w-[160px]">
                                <div className="text-[22px] font-semibold text-primary tracking-[-0.4px]">
                                    {db.loading ? '—' : db.kgRoastedThisMonth.toFixed(1)}
                                </div>
                                <div className="text-xs text-muted tracking-[0.14px]">{t('dashboard.kgRoasted')}</div>
                            </div>
                            <div className="flex-1 text-center max-w-[160px]">
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
                                    <Calendar
                                        size={14}
                                        strokeWidth={1.5}
                                        className="text-secondary dark:text-[#a3a3a3]"
                                    />
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
                            const isOut = item.effectiveGrams <= 0;
                            const color = isOut ? '#8080F0' : '#FFFF54';
                            const bg = isOut ? 'rgba(128,128,240,0.12)' : 'rgba(255,255,84,0.2)';
                            const status = isOut ? t('dashboard.outOfStock') : t('dashboard.lowStock');
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
