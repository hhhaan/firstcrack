import { TrendingUp, Coffee, Clock, CheckCircle, ArrowRight, Calendar, ChevronRight } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { type View } from '@shared/types/view'
import { useDashboard } from './useDashboard'
import { useRoastingStore } from '@features/active-roast'

// TODO: auth 연동 후 실제 userId로 교체
const USER_ID = 'ad755cd2-cb7f-48d1-94a7-b7ee72f705b7'

interface DashboardProps {
    onNavigate: (view: View) => void
}

interface BarCanvasProps {
    data: { month: string; batches: number }[]
    height?: number
}

const BarCanvas = ({ data, height = 160 }: BarCanvasProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const tooltipRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const draw = (canvas: HTMLCanvasElement) => {
        const dpr = window.devicePixelRatio || 1
        const W = canvas.offsetWidth
        const H = height
        canvas.width = W * dpr
        canvas.height = H * dpr
        canvas.style.width = `${W}px`
        canvas.style.height = `${H}px`

        const ctx = canvas.getContext('2d')!
        ctx.scale(dpr, dpr)

        const cs = getComputedStyle(document.documentElement)
        const colorPrimary = cs.getPropertyValue('--color-primary').trim() || '#171717'
        const colorMuted = cs.getPropertyValue('--color-muted').trim() || '#9ca3af'

        const maxVal = Math.max(...data.map((d) => d.batches), 1)
        const padL = 28
        const padR = 8
        const padT = 8
        const padB = 28
        const plotW = W - padL - padR
        const plotH = H - padT - padB
        const barW = Math.min(20, (plotW / data.length) * 0.5)
        const gap = plotW / data.length

        ctx.strokeStyle = 'rgba(0,0,0,0.05)'
        ctx.lineWidth = 1
        for (let i = 0; i <= 3; i++) {
            const y = padT + plotH - (i / 3) * plotH
            ctx.beginPath()
            ctx.moveTo(padL, y)
            ctx.lineTo(padL + plotW, y)
            ctx.stroke()
            ctx.fillStyle = colorMuted
            ctx.font = '11px sans-serif'
            ctx.textAlign = 'right'
            ctx.fillText(String(Math.round((i / 3) * maxVal)), padL - 4, y + 4)
        }

        data.forEach((d, i) => {
            const x = padL + gap * i + gap / 2 - barW / 2
            const barH = (d.batches / maxVal) * plotH
            const y = padT + plotH - barH
            const r = 4

            ctx.fillStyle = colorPrimary
            ctx.beginPath()
            ctx.moveTo(x + r, y)
            ctx.lineTo(x + barW - r, y)
            ctx.quadraticCurveTo(x + barW, y, x + barW, y + r)
            ctx.lineTo(x + barW, y + barH)
            ctx.lineTo(x, y + barH)
            ctx.lineTo(x, y + r)
            ctx.quadraticCurveTo(x, y, x + r, y)
            ctx.closePath()
            ctx.fill()

            ctx.fillStyle = colorMuted
            ctx.font = '12px sans-serif'
            ctx.textAlign = 'center'
            ctx.fillText(d.month, padL + gap * i + gap / 2, H - 6)
        })
    }

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        draw(canvas)
        const obs = new ResizeObserver(() => {
            if (canvas) draw(canvas)
        })
        obs.observe(canvas.parentElement!)
        return () => obs.disconnect()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data])

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        const tt = tooltipRef.current
        if (!canvas || !tt) return

        const rect = canvas.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const W = canvas.offsetWidth
        const padL = 28
        const padR = 8
        const plotW = W - padL - padR
        const gap = plotW / data.length

        const idx = Math.floor((mx - padL) / gap)
        if (idx < 0 || idx >= data.length) {
            tt.style.display = 'none'
            return
        }

        tt.textContent = `${data[idx].month}: ${data[idx].batches} batches`
        tt.style.display = 'block'
        tt.style.left = `${e.clientX - rect.left + 10}px`
        tt.style.top = `${e.clientY - rect.top - 30}px`
    }

    return (
        <div ref={containerRef} className="relative w-full">
            <canvas
                ref={canvasRef}
                className="block w-full"
                style={{ height }}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => {
                    if (tooltipRef.current) tooltipRef.current.style.display = 'none'
                }}
            />
            <div
                ref={tooltipRef}
                className="absolute pointer-events-none bg-white rounded-[10px] px-3 py-1.5 text-[13px] whitespace-nowrap z-10"
                style={{
                    display: 'none',
                    boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.04) 0px 4px 4px',
                }}
            />
        </div>
    )
}

const levelColor: Record<string, string> = {
    Light: '#a16207',
    'Medium-Light': '#92400e',
    Medium: '#7c2d12',
    'Medium-Dark': '#431407',
    Dark: '#1c0a00',
}

const levelBg: Record<string, string> = {
    Light: 'rgba(254,243,199,0.8)',
    'Medium-Light': 'rgba(254,231,200,0.8)',
    Medium: 'rgba(253,220,198,0.8)',
    'Medium-Dark': 'rgba(240,180,150,0.8)',
    Dark: 'rgba(220,140,100,0.8)',
}

const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.round(seconds % 60)
    return `${m}:${String(s).padStart(2, '0')}`
}

const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const formatScheduled = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const tomorrow = new Date(now)
    tomorrow.setDate(now.getDate() + 1)
    const isTomorrow = d.toDateString() === tomorrow.toDateString()
    const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    if (isToday) return `Today, ${timeStr}`
    if (isTomorrow) return `Tomorrow, ${timeStr}`
    return `${formatDate(iso)}, ${timeStr}`
}

const pctChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? '+∞%' : '0%'
    const diff = ((current - previous) / previous) * 100
    return `${diff >= 0 ? '+' : ''}${Math.round(diff)}%`
}

const durationDiff = (current: number, previous: number) => {
    const diff = Math.round(current - previous)
    return `${diff >= 0 ? '+' : '-'}${formatDuration(Math.abs(diff))}`
}

export const Dashboard = ({ onNavigate }: DashboardProps) => {
    const db = useDashboard(USER_ID)
    const isRoasting = useRoastingStore((s) => s.isRoasting)

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
    ]

    return (
        <div className="px-10 py-8 max-w-275 mx-auto">
            {/* Header */}
            <div className="mb-8 flex items-end justify-between">
                <div>
                    <h1 className="font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px] mb-1.5">
                        Good morning, Han
                    </h1>
                    <p className="text-[15px] text-secondary tracking-[0.15px] font-normal">
                        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                        {db.upcomingSessions.length > 0 &&
                            ` · ${db.upcomingSessions.length} roast${db.upcomingSessions.length > 1 ? 's' : ''} scheduled`}
                    </p>
                </div>
                <button
                    onClick={() => onNavigate('roast')}
                    className="flex items-center gap-2 px-4.5 py-2.5 rounded-full border-0 bg-primary text-white text-sm font-medium cursor-pointer tracking-[0.14px] shadow-(--shadow-card)"
                >
                    <span className={`w-1.75 h-1.75 rounded-full inline-block ${isRoasting ? 'bg-green-400' : 'bg-white/40'}`} />
                    View Active Roast
                    <ArrowRight size={14} strokeWidth={2} />
                </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-4 mb-8">
                {stats.map(({ label, value, change, icon: Icon }) => {
                    const isPositive = change.startsWith('+')
                    const isNeutral = change === ''
                    return (
                        <div key={label} className="bg-main-bg rounded-2xl px-5 pt-5 pb-4.5 shadow-(--shadow-ring)">
                            <div className="flex items-start justify-between mb-3.5">
                                <div className="w-8.5 h-8.5 rounded-lg bg-surface flex items-center justify-center shadow-(--shadow-inset)">
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
                    )
                })}
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-[1fr_340px] gap-5 mb-5">
                {/* Recent Sessions */}
                <div className="bg-main-bg rounded-2xl shadow-(--shadow-ring) overflow-hidden">
                    <div className="px-6 pt-4.5 pb-3.5 flex items-center justify-between border-b border-border-subtle">
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
                            <tr className="border-b border-border-subtle">
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
                                    const level = session.roast_level ?? ''
                                    return (
                                        <tr
                                            key={session.id}
                                            className={
                                                i < db.recentSessions.length - 1 ? 'border-b border-border-subtle' : ''
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
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Monthly chart */}
                <div className="bg-main-bg rounded-2xl px-6 py-5 shadow-(--shadow-ring)">
                    <div className="flex items-center justify-between mb-5">
                        <h2 className="text-[15px] font-medium text-primary tracking-[0.15px]">Monthly Batches</h2>
                        <Calendar size={15} strokeWidth={1.5} color="var(--color-muted)" />
                    </div>
                    <BarCanvas data={db.monthlyBatches} height={160} />

                    <div className="mt-5 pt-4 border-t border-border-subtle">
                        <div className="text-xs text-muted mb-2 tracking-[0.5px] uppercase font-medium">This Month</div>
                        <div className="flex gap-5">
                            <div>
                                <div className="text-[22px] font-semibold text-primary tracking-[-0.4px]">
                                    {db.loading ? '—' : db.batchesThisMonth}
                                </div>
                                <div className="text-xs text-muted tracking-[0.14px]">batches</div>
                            </div>
                            <div>
                                <div className="text-[22px] font-semibold text-primary tracking-[-0.4px]">
                                    {db.loading ? '—' : db.kgRoastedThisMonth.toFixed(1)}
                                </div>
                                <div className="text-xs text-muted tracking-[0.14px]">kg roasted</div>
                            </div>
                            <div>
                                <div className="text-[22px] font-semibold text-primary tracking-[-0.4px]">
                                    {db.loading
                                        ? '—'
                                        : new Set(
                                              db.recentSessions.map((s) => s.beans?.origin).filter(Boolean),
                                          ).size}
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
                <div className="bg-main-bg rounded-2xl px-6 py-5 shadow-(--shadow-ring)">
                    <h2 className="text-[15px] font-medium text-primary tracking-[0.15px] mb-3.5">Upcoming Batches</h2>
                    {db.loading ? (
                        <p className="text-[13px] text-muted py-2">Loading...</p>
                    ) : db.upcomingSessions.length === 0 ? (
                        <p className="text-[13px] text-muted py-2">No upcoming batches</p>
                    ) : (
                        db.upcomingSessions.map((item, i) => (
                            <div
                                key={item.id}
                                className={`flex items-center gap-3 py-2.5 ${i < db.upcomingSessions.length - 1 ? 'border-b border-border-subtle' : ''}`}
                            >
                                <div className="w-8.5 h-8.5 rounded-lg bg-surface-warm-solid flex items-center justify-center shrink-0 shadow-(--shadow-inset)">
                                    <Calendar size={14} strokeWidth={1.5} color="var(--color-secondary)" />
                                </div>
                                <div className="flex-1">
                                    <div className="text-[13px] font-medium text-primary tracking-[0.14px]">
                                        {item.beans?.name ?? '—'}
                                    </div>
                                    <div className="text-xs text-muted tracking-[0.14px]">
                                        {item.scheduled_at ? formatScheduled(item.scheduled_at) : '—'} ·{' '}
                                        {item.weight_grams >= 1000
                                            ? `${item.weight_grams / 1000}kg`
                                            : `${item.weight_grams}g`}{' '}
                                        · {item.roast_profiles?.name ?? '—'}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Inventory Alerts */}
                <div className="bg-main-bg rounded-2xl px-6 py-5 shadow-(--shadow-ring)">
                    <h2 className="text-[15px] font-medium text-primary tracking-[0.15px] mb-3.5">Inventory Alerts</h2>
                    {db.loading ? (
                        <p className="text-[13px] text-muted py-2">Loading...</p>
                    ) : db.inventoryAlerts.length === 0 ? (
                        <p className="text-[13px] text-muted py-2">All stock levels OK</p>
                    ) : (
                        db.inventoryAlerts.map((item, i) => {
                            const isOut = item.stock_grams === 0
                            const color = isOut ? '#dc2626' : '#d97706'
                            const bg = isOut ? 'rgba(254,226,226,0.8)' : 'rgba(254,243,199,0.8)'
                            const status = isOut ? 'Out of Stock' : 'Low Stock'
                            return (
                                <div
                                    key={item.id}
                                    className={`flex items-center gap-3 py-2.5 ${i < db.inventoryAlerts.length - 1 ? 'border-b border-border-subtle' : ''}`}
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
                                            {item.stock_grams}g remaining
                                        </div>
                                    </div>
                                    <span
                                        className="text-[11px] font-medium px-2 py-0.75 rounded-full tracking-[0.14px] whitespace-nowrap"
                                        style={{ color, background: bg }}
                                    >
                                        {status}
                                    </span>
                                </div>
                            )
                        })
                    )}
                </div>
            </div>
        </div>
    )
}
