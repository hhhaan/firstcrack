import { Search } from 'lucide-react';
import { getStatus, statusConfig } from '../../../entities/bean/lib';
import type { Bean } from '../../../shared/types/database.types';

interface BeanListProps {
    beans: Bean[];
    isLoading: boolean;
    selectedId: string | null;
    onSelect: (id: string) => void;
    search: string;
    onSearchChange: (value: string) => void;
}

const Skeleton = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: 5 }).map((_, i) => (
            <div
                key={i}
                style={{
                    background: 'var(--color-main-bg)',
                    borderRadius: 8,
                    padding: '14px 16px',
                    boxShadow: 'var(--shadow-ring)',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                        <div
                            style={{
                                width: 140,
                                height: 13,
                                borderRadius: 6,
                                background: 'var(--color-surface)',
                                marginBottom: 6,
                            }}
                            className="animate-pulse"
                        />
                        <div
                            style={{ width: 90, height: 11, borderRadius: 6, background: 'var(--color-surface)' }}
                            className="animate-pulse"
                        />
                    </div>
                    <div
                        style={{ width: 56, height: 20, borderRadius: 9999, background: 'var(--color-surface)' }}
                        className="animate-pulse"
                    />
                </div>
                <div
                    style={{ height: 4, borderRadius: 9999, background: 'var(--color-surface)', marginBottom: 4 }}
                    className="animate-pulse"
                />
                <div
                    style={{ width: 80, height: 11, borderRadius: 6, background: 'var(--color-surface)' }}
                    className="animate-pulse"
                />
            </div>
        ))}
    </div>
);

export const BeanList = ({ beans, isLoading, selectedId, onSelect, search, onSearchChange }: BeanListProps) => {
    const searchLower = search.toLowerCase();
    const filtered = beans.filter(
        (b) => b.name.toLowerCase().includes(searchLower) || (b.origin ?? '').toLowerCase().includes(searchLower),
    );

    return (
        <div>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'var(--color-main-bg)',
                    borderRadius: 8,
                    padding: '9px 12px',
                    marginBottom: 10,
                    boxShadow: 'var(--shadow-ring)',
                }}
            >
                <Search size={14} strokeWidth={2} color="var(--color-muted)" />
                <input
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="Search beans..."
                    style={{
                        border: 'none',
                        background: 'transparent',
                        outline: 'none',
                        fontSize: 13,
                        color: 'var(--color-primary)',
                        fontFamily: 'var(--font-body)',
                        width: '100%',
                        letterSpacing: '0.14px',
                    }}
                />
            </div>

            {isLoading ? (
                <Skeleton />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {filtered.map((bean) => {
                        const status = getStatus(bean);
                        const cfg = statusConfig[status];
                        const pct = Math.min(100, (bean.stock_grams / bean.capacity_grams) * 100);
                        const isSelected = selectedId === bean.id;

                        return (
                            <div
                                key={bean.id}
                                onClick={() => onSelect(bean.id)}
                                style={{
                                    background: 'var(--color-main-bg)',
                                    borderRadius: 8,
                                    padding: '14px 16px',
                                    cursor: 'pointer',
                                    boxShadow: isSelected
                                        ? 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.06) 0px 2px 8px'
                                        : 'var(--shadow-ring)',
                                    border: isSelected ? '1px solid rgba(0,0,0,0.08)' : '1px solid transparent',
                                    transition: 'all 0.15s',
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        justifyContent: 'space-between',
                                        marginBottom: 8,
                                    }}
                                >
                                    <div>
                                        <div
                                            style={{
                                                fontSize: 13,
                                                fontWeight: 500,
                                                color: 'var(--color-primary)',
                                                letterSpacing: '0.14px',
                                                marginBottom: 2,
                                            }}
                                        >
                                            {bean.name}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 12,
                                                color: 'var(--color-muted)',
                                                letterSpacing: '0.14px',
                                            }}
                                        >
                                            {bean.origin ?? '—'} · {bean.process ?? '—'}
                                        </div>
                                    </div>
                                    <span
                                        style={{
                                            fontSize: 11,
                                            fontWeight: 500,
                                            color: cfg.color,
                                            background: cfg.bg,
                                            padding: '2px 7px',
                                            borderRadius: 9999,
                                            flexShrink: 0,
                                            marginLeft: 8,
                                        }}
                                    >
                                        {cfg.label}
                                    </span>
                                </div>

                                <div
                                    style={{
                                        height: 4,
                                        background: 'var(--color-surface)',
                                        borderRadius: 9999,
                                        overflow: 'hidden',
                                        marginBottom: 4,
                                    }}
                                >
                                    <div
                                        style={{
                                            height: '100%',
                                            width: `${pct}%`,
                                            borderRadius: 9999,
                                            background:
                                                status === 'Out'
                                                    ? '#dc2626'
                                                    : status === 'Low'
                                                      ? '#d97706'
                                                      : 'var(--color-primary)',
                                            transition: 'width 0.5s',
                                        }}
                                    />
                                </div>
                                <div
                                    style={{
                                        fontSize: 12,
                                        color: 'var(--color-muted)',
                                        fontFamily: 'var(--font-mono)',
                                    }}
                                >
                                    {(bean.stock_grams / 1000).toFixed(2)}kg / {(bean.capacity_grams / 1000).toFixed(2)}kg
                                </div>
                            </div>
                        );
                    })}

                    {filtered.length === 0 && (
                        <div
                            style={{
                                padding: '40px 20px',
                                textAlign: 'center',
                                color: 'var(--color-muted)',
                                fontSize: 14,
                                letterSpacing: '0.14px',
                            }}
                        >
                            {beans.length === 0 ? 'No beans yet. Add your first lot!' : 'No results found.'}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
