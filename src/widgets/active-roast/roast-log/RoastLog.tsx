import type { LogEntry } from '@shared/types/roast';

export const RoastLog = ({
    entries,
    eventMarkerColor,
    variant,
}: {
    entries: LogEntry[];
    eventMarkerColor: Record<string, string>;
    variant: 'sidebar' | 'main';
}) => {
    const isSidebar = variant === 'sidebar';

    return (
        <div
            style={
                isSidebar
                    ? { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }
                    : { display: 'flex', flexDirection: 'column', gap: 0 }
            }
        >
            {isSidebar && (
                <h3
                    style={{
                        fontSize: 12,
                        color: 'var(--color-muted)',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        marginBottom: 10,
                        flexShrink: 0,
                    }}
                >
                    Roast Log
                </h3>
            )}
            <div style={isSidebar ? { overflowY: 'auto', flex: 1 } : undefined}>
                {entries.map((entry, i, arr) => (
                    <div
                        key={i}
                        style={{
                            display: 'flex',
                            gap: isSidebar ? 10 : 12,
                            padding: isSidebar ? '8px 0' : '10px 0',
                            borderBottom: i < arr.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                        }}
                    >
                        <div
                            style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: isSidebar ? 11 : 12,
                                color: 'var(--color-muted)',
                                width: isSidebar ? 32 : 36,
                                flexShrink: 0,
                                paddingTop: isSidebar ? 2 : 1,
                            }}
                        >
                            {entry.time}
                        </div>
                        <div
                            style={{
                                width: 6,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                paddingTop: 4,
                                flexShrink: 0,
                            }}
                        >
                            <div
                                style={{
                                    width: isSidebar ? 6 : 7,
                                    height: isSidebar ? 6 : 7,
                                    borderRadius: '50%',
                                    background: entry.current
                                        ? '#22c55e'
                                        : (eventMarkerColor[entry.event] ?? 'var(--color-border)'),
                                    boxShadow: entry.current
                                        ? isSidebar
                                            ? '0 0 0 2px rgba(34,197,94,0.2)'
                                            : '0 0 0 3px rgba(34,197,94,0.2)'
                                        : 'none',
                                    flexShrink: isSidebar ? 0 : undefined,
                                }}
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: isSidebar ? 6 : 8 }}>
                                <span
                                    style={{
                                        fontSize: isSidebar ? 12 : 13,
                                        fontWeight: 500,
                                        color: 'var(--color-primary)',
                                        letterSpacing: isSidebar ? 'normal' : '0.14px',
                                    }}
                                >
                                    {entry.event}
                                </span>
                                <span
                                    style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: isSidebar ? 11 : 12,
                                        color: 'var(--color-muted)',
                                    }}
                                >
                                    {entry.temp}
                                </span>
                            </div>
                            <div
                                style={{
                                    fontSize: isSidebar ? 11 : 12,
                                    color: 'var(--color-muted)',
                                    letterSpacing: isSidebar ? 'normal' : '0.14px',
                                }}
                            >
                                {entry.note}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
