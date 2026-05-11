import { Settings2, ChevronDown } from 'lucide-react';
import { roastProfiles, DEFAULT_PROFILE_KEY } from '@shared/data/roast-profiles';

export const RoastHeader = ({
    roastEnded,
    charged,
    sidecarConnected,
    timeStr,
    phase,
    targetProfileId,
    onTargetProfileChange,
    onOpenRoastSettings,
}: {
    roastEnded: boolean;
    charged: boolean;
    sidecarConnected: boolean;
    timeStr: string;
    phase: string;
    targetProfileId: number | null;
    onTargetProfileChange: (id: number | null) => void;
    onOpenRoastSettings?: () => void;
}) => {
    const handleProfileChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        const id = val === '' ? null : Number(val);
        onTargetProfileChange(id);
        if (id != null) localStorage.setItem(DEFAULT_PROFILE_KEY, String(id));
        else localStorage.removeItem(DEFAULT_PROFILE_KEY);
    };

    return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div
                    style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: roastEnded ? '#6b7280' : (!charged && !sidecarConnected) ? '#6b7280' : '#22c55e',
                        boxShadow: !roastEnded && (charged || sidecarConnected) ? '0 0 0 3px rgba(34,197,94,0.2)' : 'none',
                        animation: charged && !roastEnded ? 'pulse 2s infinite' : 'none',
                    }}
                />
                <span
                    style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: roastEnded ? '#6b7280' : (!charged && !sidecarConnected) ? '#6b7280' : '#16a34a',
                        letterSpacing: '0.5px',
                        textTransform: 'uppercase',
                    }}
                >
                    {roastEnded
                        ? 'Roast Complete'
                        : !charged
                          ? 'Machine Connected · Ready to Roast'
                          : sidecarConnected
                            ? 'Live — Roast in Progress'
                            : 'Mock — Roast in Progress'}
                </span>
            </div>
            <h1
                style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 300,
                    fontSize: 32,
                    lineHeight: 1.13,
                    color: 'var(--color-primary)',
                    letterSpacing: '-0.4px',
                    marginBottom: 4,
                }}
            >
                Ethiopia Yirgacheffe
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
                    Natural · Guji Zone · Target:
                </span>
                <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                    <select
                        value={targetProfileId ?? ''}
                        onChange={handleProfileChange}
                        disabled={charged}
                        style={{
                            appearance: 'none',
                            background: 'transparent',
                            border: 'none',
                            fontSize: 13,
                            fontWeight: 500,
                            color: targetProfileId ? 'rgba(16,185,129,0.9)' : 'var(--color-muted)',
                            cursor: charged ? 'default' : 'pointer',
                            paddingRight: 16,
                            letterSpacing: '0.14px',
                            outline: 'none',
                        }}
                    >
                        <option value="">No Target</option>
                        {roastProfiles.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </select>
                    {!charged && (
                        <ChevronDown
                            size={12}
                            style={{ position: 'absolute', right: 0, pointerEvents: 'none', color: 'rgba(16,185,129,0.7)' }}
                        />
                    )}
                </div>
            </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ textAlign: 'right' }}>
                <div
                    style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 44,
                        fontWeight: 600,
                        color: 'var(--color-primary)',
                        letterSpacing: '-2px',
                        lineHeight: 1,
                        marginBottom: 4,
                    }}
                >
                    {timeStr}
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>{phase} phase</div>
            </div>
            {onOpenRoastSettings && (
                <button
                    onClick={onOpenRoastSettings}
                    aria-label="Open roast settings"
                    title="Roast settings"
                    style={{
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        border: 'none',
                        background: 'var(--color-surface)',
                        color: 'var(--color-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        flexShrink: 0,
                        boxShadow: 'var(--shadow-inset)',
                        marginTop: 6,
                    }}
                >
                    <Settings2 size={15} strokeWidth={1.9} />
                </button>
            )}
        </div>
    </div>
    );
};
