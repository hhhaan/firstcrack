import { Edit3 } from 'lucide-react'
import { getStatus, statusConfig, processColor } from '../../../entities/bean/lib'
import type { Bean } from '../../../shared/types/database.types'

interface BeanDetailProps {
    bean: Bean | null
    isLoading: boolean
    onEdit: (bean: Bean) => void
    onRestock: (id: string) => void
    onStartRoast: () => void
}

const Skeleton = () => (
    <div style={{ background: 'var(--color-main-bg)', borderRadius: 16, padding: '28px 32px', boxShadow: 'var(--shadow-ring)' }}>
        <div style={{ marginBottom: 24 }}>
            <div style={{ width: 200, height: 26, borderRadius: 8, background: 'var(--color-surface)', marginBottom: 10 }} className="animate-pulse" />
            <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ width: 60, height: 22, borderRadius: 9999, background: 'var(--color-surface)' }} className="animate-pulse" />
                <div style={{ width: 80, height: 22, borderRadius: 9999, background: 'var(--color-surface)' }} className="animate-pulse" />
            </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}>
                    <div style={{ width: 50, height: 10, borderRadius: 4, background: 'var(--color-surface)', marginBottom: 6 }} className="animate-pulse" />
                    <div style={{ width: 100, height: 14, borderRadius: 6, background: 'var(--color-surface)' }} className="animate-pulse" />
                </div>
            ))}
        </div>
        <div style={{ height: 6, borderRadius: 9999, background: 'var(--color-surface)', marginBottom: 24 }} className="animate-pulse" />
        <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, height: 40, borderRadius: 9999, background: 'var(--color-surface)' }} className="animate-pulse" />
            <div style={{ flex: 1, height: 40, borderRadius: 9999, background: 'var(--color-surface)' }} className="animate-pulse" />
        </div>
    </div>
)

const Empty = ({ hasAny }: { hasAny: boolean }) => (
    <div style={{ background: 'var(--color-main-bg)', borderRadius: 16, padding: '60px 32px', boxShadow: 'var(--shadow-ring)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-muted)', fontSize: 14, letterSpacing: '0.14px' }}>
        {hasAny ? 'Select a bean to view details' : 'Add your first bean lot to get started.'}
    </div>
)

export const BeanDetail = ({ bean, isLoading, onEdit, onRestock, onStartRoast }: BeanDetailProps) => {
    if (isLoading) return <Skeleton />
    if (!bean) return <Empty hasAny={false} />

    const status = getStatus(bean)
    const cfg = statusConfig[status]

    return (
        <div style={{ background: 'var(--color-main-bg)', borderRadius: 16, padding: '28px 32px', boxShadow: 'var(--shadow-ring)', height: 'fit-content', position: 'relative' }}>
            <button
                onClick={() => onEdit(bean)}
                style={{
                    position: 'absolute',
                    top: 24,
                    right: 24,
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    border: '1px solid rgba(0,0,0,0.06)',
                    background: 'white',
                    color: 'var(--color-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    boxShadow: 'var(--shadow-button)',
                    zIndex: 2,
                }}
            >
                <Edit3 size={16} />
            </button>

            <div style={{ marginBottom: 24, paddingRight: 40 }}>
                <h2
                    style={{
                        fontFamily: 'var(--font-display)',
                        fontWeight: 300,
                        fontSize: 26,
                        lineHeight: 1.2,
                        color: 'var(--color-primary)',
                        letterSpacing: '-0.3px',
                        marginBottom: 4,
                    }}
                >
                    {bean.name}
                </h2>
                <div style={{ display: 'flex', gap: 6 }}>
                    {bean.process && (
                        <span style={{ fontSize: 12, fontWeight: 500, color: processColor[bean.process]?.color ?? 'var(--color-secondary)', background: processColor[bean.process]?.bg ?? 'var(--color-surface)', padding: '3px 9px', borderRadius: 9999 }}>
                            {bean.process}
                        </span>
                    )}
                    {bean.variety && (
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-secondary)', background: 'var(--color-surface)', padding: '3px 9px', borderRadius: 9999, boxShadow: 'var(--shadow-inset)' }}>
                            {bean.variety}
                        </span>
                    )}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                {[
                    { label: 'Origin', value: bean.origin ?? '—' },
                    { label: 'Region', value: bean.region ?? '—' },
                    { label: 'Farm', value: bean.farm ?? '—' },
                    { label: 'Altitude', value: bean.altitude_masl ? `${bean.altitude_masl.toLocaleString()} masl` : '—' },
                    { label: 'Received', value: bean.purchase_date ?? '—' },
                    { label: 'Current Stock', value: `${bean.stock_grams.toLocaleString()}g` },
                ].map(({ label, value }) => (
                    <div key={label}>
                        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-muted)', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 3 }}>
                            {label}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-primary)', letterSpacing: '0.14px' }}>
                            {value}
                        </div>
                    </div>
                ))}
            </div>

            {bean.tasting_notes && (
                <div style={{ background: 'var(--color-surface-warm-solid)', borderRadius: 12, padding: '14px 16px', marginBottom: 24, boxShadow: 'var(--shadow-warm)' }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-muted)', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 8 }}>
                        Tasting Notes
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {bean.tasting_notes.split(', ').map((note) => (
                            <span key={note} style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-secondary)', background: 'rgba(255,255,255,0.7)', padding: '4px 10px', borderRadius: 9999, letterSpacing: '0.14px', boxShadow: 'var(--shadow-inset)' }}>
                                {note}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-secondary)', letterSpacing: '0.14px' }}>Stock Level</span>
                    <span style={{ fontSize: 12, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                        {bean.stock_grams.toLocaleString()}g / {bean.capacity_grams.toLocaleString()}g
                    </span>
                </div>
                <div style={{ height: 6, background: 'var(--color-surface)', borderRadius: 9999, overflow: 'hidden', boxShadow: 'var(--shadow-inset)' }}>
                    <div
                        style={{
                            height: '100%',
                            width: `${Math.min(100, (bean.stock_grams / bean.capacity_grams) * 100)}%`,
                            borderRadius: 9999,
                            background: cfg.color,
                            transition: 'width 0.5s',
                        }}
                    />
                </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
                <button
                    onClick={onStartRoast}
                    style={{ flex: 1, padding: '10px 0', borderRadius: 9999, border: 'none', background: 'var(--color-primary)', color: 'white', fontSize: 14, fontWeight: 500, cursor: 'pointer', letterSpacing: '0.14px', boxShadow: 'var(--shadow-card)' }}
                >
                    Start Roast
                </button>
                <button
                    onClick={() => onRestock(bean.id)}
                    style={{ flex: 1, padding: '10px 0', borderRadius: 9999, border: 'none', background: 'var(--color-surface)', color: 'var(--color-secondary)', fontSize: 14, fontWeight: 500, cursor: 'pointer', letterSpacing: '0.14px', boxShadow: 'var(--shadow-inset)' }}
                >
                    Restock
                </button>
            </div>
        </div>
    )
}
