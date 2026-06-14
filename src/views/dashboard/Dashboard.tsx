import {
    TrendingUp,
    Coffee,
    Clock,
    CheckCircle,
    ArrowRight,
    Calendar,
    ChevronRight,
    Thermometer,
    Droplets,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { type View } from '@shared/types/view';
import { useDashboard } from './useDashboard';
import { useWeather } from './useWeather';
import { useRoastingStore } from '@features/active-roast';
import { useAuthStore } from '@shared/store/auth';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';

interface DashboardProps {
    onNavigate: (view: View) => void;
}

interface BarCanvasProps {
    data: { month: string; batches: number }[];
}

const BarCanvas = ({ data }: BarCanvasProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

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
        const colorPrimary = cs.getPropertyValue('--color-primary').trim() || '#171717';
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
            ctx.fillText(d.month.trim(), centerX, H - 6);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

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

        tt.textContent = `${data[idx].month}: ${data[idx].batches} batches`;
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
    Light: '#a16207',
    'Medium-Light': '#92400e',
    Medium: '#7c2d12',
    'Medium-Dark': '#431407',
    Dark: '#1c0a00',
};

const levelBg: Record<string, string> = {
    Light: 'rgba(254,243,199,0.8)',
    'Medium-Light': 'rgba(254,231,200,0.8)',
    Medium: 'rgba(253,220,198,0.8)',
    'Medium-Dark': 'rgba(240,180,150,0.8)',
    Dark: 'rgba(220,140,100,0.8)',
};

const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
};

const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

    const stats = [
        {
            label: 'Batches This Month',
            value: db.loading ? '—' : String(db.batchesThisMonth),
            change: db.loading ? '' : pctChange(db.batchesThisMonth, db.batchesLastMonth),
            icon: Coffee,
        },
        {
            label: 'Beans Roasted',
            value: db.loading ? '—' : `${db.kgRoastedThisMonth.toFixed(1)} kg`,
            change: db.loading ? '' : pctChange(db.kgRoastedThisMonth, db.kgRoastedLastMonth),
            icon: TrendingUp,
        },
        {
            label: 'Avg Roast Time',
            value: db.loading ? '—' : formatDuration(db.avgDurationSeconds),
            change: db.loading ? '' : durationDiff(db.avgDurationSeconds, db.avgDurationLastMonthSeconds),
            icon: Clock,
        },
        {
            label: 'Success Rate',
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
                        {(() => {
                            const h = new Date().getHours();
                            if (h < 12) return 'Good morning';
                            if (h < 18) return 'Good afternoon';
                            return 'Good evening';
                        })()}
                        {/* , Han */}
                    </h1>
                    <p className="text-[15px] text-secondary tracking-[0.15px] font-normal flex items-center gap-2.5">
                        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
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
                <PillButton
                    onClick={() => onNavigate('roast')}
                >
                    <span
                        className={`w-1.75 h-1.75 rounded-full inline-block ${isRoasting ? 'bg-green-400 animate-pulse' : 'bg-white/40'}`}
                    />
                    View Active Roast
                    <ArrowRight size={14} strokeWidth={2} />
                </PillButton>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-4 mb-8">
                {stats.map(({ label, value, change, icon: Icon }) => {
                    const isPositive = change.startsWith('+');
                    const isNeutral = change === '';
                    return (
                        <div key={label} className="bg-main-bg rounded-lg px-5 pt-5 pb-4.5 border border-[#E5E5E5]">
                            <div className="flex items-start justify-between mb-3.5">
                                <div className="w-8.5 h-8.5 rounded-lg bg-surface flex items-center justify-center">
                                    <Icon size={16} strokeWidth={1.5} color="var(--color-secondary)" />
                                </div>
                                {!isNeutral && (
                                    <span
                                        className={`text-xs font-medium px-2 py-0.5 rounded-full tracking-[0.14px] ${
                                            isPositive
                                                ? 'text-green-600 bg-[rgba(220,252,231,0.8)]'
                                                : 'text-red-600 bg-[rgba(254,226,226,0.8)]'
                                        }`}
                                    >
                                        {change}
                                    </span>
                                )}
                            </div>
                            <div className="text-[26px] font-semibold text-primary leading-[1.2] mb-1 tracking-[-0.5px]">
                                {value}
                            </div>
                            <div className="text-[13px] text-muted tracking-[0.14px]">{label}</div>
                        </div>
                    );
                })}
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-[1fr_320px] gap-5 mb-5">
                {/* Recent Sessions */}
                <div className="bg-main-bg rounded-lg overflow-hidden border border-[#E5E5E5]">
                    <div className="px-6 pt-4.5 pb-3.5 flex items-center justify-between border-b border-[#E5E5E5]">
                        <h2 className="text-[15px] font-medium text-primary tracking-[0.15px]">Recent Sessions</h2>
                        <button
                            onClick={() => onNavigate('history')}
                            className="flex items-center gap-1 text-[13px] font-medium text-muted bg-transparent border-0 cursor-pointer tracking-[0.14px]"
                        >
                            View all <ChevronRight size={13} strokeWidth={2} />
                        </button>
                    </div>
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="border-b border-[#E5E5E5]">
                                {['Date', 'Bean', 'Profile', 'Weight', 'Drop Temp', 'Duration', 'Level'].map((h) => (
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
                                        Loading...
                                    </td>
                                </tr>
                            ) : db.recentSessions.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-8 text-center text-[13px] text-muted">
                                        No sessions yet
                                    </td>
                                </tr>
                            ) : (
                                db.recentSessions.map((session, i) => {
                                    const level = session.roast_level ?? '';
                                    return (
                                        <tr
                                            key={session.id}
                                            className={
                                                i < db.recentSessions.length - 1 ? 'border-b border-[#E5E5E5]' : ''
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
                <div className="bg-main-bg rounded-lg px-6 py-5 border border-[#E5E5E5] w-full flex flex-col">
                    <div className="flex items-center justify-between mb-5 shrink-0">
                        <h2 className="text-[15px] font-medium text-primary tracking-[0.15px]">Monthly Batches</h2>
                        <Calendar size={15} strokeWidth={1.5} color="var(--color-muted)" />
                    </div>
                    <div className="flex-1 min-h-[120px]">
                        <BarCanvas data={db.monthlyBatches} />
                    </div>

                    <div className="mt-5 pt-4 border-t border-[#E5E5E5] shrink-0">
                        <div className="text-xs text-muted mb-3 tracking-[0.5px] uppercase font-medium text-center">This Month</div>
                        <div className="flex items-center justify-center gap-0 w-full">
                            <div className="flex-1 text-center max-w-[160px]">
                                <div className="text-[22px] font-semibold text-primary tracking-[-0.4px]">
                                    {db.loading ? '—' : db.batchesThisMonth}
                                </div>
                                <div className="text-xs text-muted tracking-[0.14px]">batches</div>
                            </div>
                            <div className="flex-1 text-center border-x border-[#E5E5E5] max-w-[160px]">
                                <div className="text-[22px] font-semibold text-primary tracking-[-0.4px]">
                                    {db.loading ? '—' : db.kgRoastedThisMonth.toFixed(1)}
                                </div>
                                <div className="text-xs text-muted tracking-[0.14px]">kg roasted</div>
                            </div>
                            <div className="flex-1 text-center max-w-[160px]">
                                <div className="text-[22px] font-semibold text-primary tracking-[-0.4px]">
                                    {db.loading
                                        ? '—'
                                        : new Set(db.recentSessions.map((s) => s.beans?.origin).filter(Boolean)).size}
                                </div>
                                <div className="text-xs text-muted tracking-[0.14px]">bean origins</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Upcoming + Inventory Alerts */}
            <div className="grid grid-cols-2 gap-5">
                {/* Upcoming */}
                <div className="bg-main-bg rounded-lg px-6 py-5 border border-[#E5E5E5]">
                    <div className="flex items-center justify-between mb-3.5">
                        <h2 className="text-[15px] font-medium text-primary tracking-[0.15px]">Upcoming Batches</h2>
                        <button
                            onClick={() => onNavigate('schedule')}
                            className="flex items-center justify-center border-none bg-transparent text-muted cursor-pointer hover:text-primary transition-colors p-0"
                        >
                            <ChevronRight size={13} strokeWidth={2} />
                        </button>
                    </div>
                    {db.loading ? (
                        <p className="text-[13px] text-muted py-2">Loading...</p>
                    ) : db.upcomingBatches.length === 0 ? (
                        <p className="text-[13px] text-muted py-2">예정된 배치가 없습니다</p>
                    ) : (
                        db.upcomingBatches.map((item, i) => (
                            <div
                                key={item.id}
                                className={`flex items-center gap-3 py-2.5 ${i < db.upcomingBatches.length - 1 ? 'border-b border-[#E5E5E5]' : ''}`}
                            >
                                <div className="w-8.5 h-8.5 rounded-lg bg-surface-warm-solid flex items-center justify-center shrink-0">
                                    <Calendar size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[13px] font-medium text-primary tracking-[0.14px] truncate">
                                            {item.bean_name}
                                        </span>
                                        <span className="shrink-0 text-[11px] font-medium text-secondary bg-surface px-1.5 py-0.5 rounded">
                                            {item.batch_count}회 · {item.target_roasted_kg}kg
                                        </span>
                                    </div>
                                    <div className="text-xs text-muted tracking-[0.14px]">
                                        {item.date === new Date().toISOString().slice(0, 10) ? '오늘' : item.date} · {item.batch_type}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Inventory Alerts */}
                <div className="bg-main-bg rounded-lg px-6 py-5 border border-[#E5E5E5]">
                    <h2 className="text-[15px] font-medium text-primary tracking-[0.15px] mb-3.5">Inventory Alerts</h2>
                    {db.loading ? (
                        <p className="text-[13px] text-muted py-2">Loading...</p>
                    ) : db.inventoryAlerts.length === 0 ? (
                        <p className="text-[13px] text-muted py-2">All stock levels OK</p>
                    ) : (
                        db.inventoryAlerts.map((item, i) => {
                            const isOut = item.stock_grams === 0;
                            const color = isOut ? '#dc2626' : '#d97706';
                            const bg = isOut ? 'rgba(254,226,226,0.8)' : 'rgba(254,243,199,0.8)';
                            const status = isOut ? 'Out of Stock' : 'Low Stock';
                            return (
                                <div
                                    key={item.id}
                                    className={`flex items-center gap-3 py-2.5 ${i < db.inventoryAlerts.length - 1 ? 'border-b border-[#E5E5E5]' : ''}`}
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
                                            {(item.stock_grams / 1000).toFixed(2)}kg remaining
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