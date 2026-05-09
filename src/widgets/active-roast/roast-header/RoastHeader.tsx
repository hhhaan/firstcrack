import { Settings2 } from 'lucide-react';

export const RoastHeader = ({
    roastEnded,
    charged,
    sidecarConnected,
    timeStr,
    phase,
    onOpenRoastSettings,
}: {
    roastEnded: boolean;
    charged: boolean;
    sidecarConnected: boolean;
    timeStr: string;
    phase: string;
    onOpenRoastSettings?: () => void;
}) => (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div
                    style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: roastEnded || !charged ? '#6b7280' : '#22c55e',
                        boxShadow: charged && !roastEnded ? '0 0 0 3px rgba(34,197,94,0.2)' : 'none',
                        animation: charged && !roastEnded ? 'pulse 2s infinite' : 'none',
                    }}
                />
                <span
                    style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: roastEnded || !charged ? '#6b7280' : '#16a34a',
                        letterSpacing: '0.5px',
                        textTransform: 'uppercase',
                    }}
                >
                    {roastEnded
                        ? 'Roast Complete'
                        : !charged
                          ? 'Ready to Roast'
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
            <p style={{ fontSize: 14, color: 'var(--color-muted)', letterSpacing: '0.14px' }}>
                Natural · Guji Zone · Profile: Signature Light
            </p>
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
