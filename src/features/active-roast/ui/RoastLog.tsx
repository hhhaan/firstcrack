import { eventMarkerCssColor, isControlEvent } from '@features/active-roast/lib/chart-config';
import { STATUS_COLORS } from '@features/active-roast/lib/colors';
import { REMOVABLE_LOG_EVENTS } from '@features/active-roast/lib/constants';
import { formatRoastNote } from '@features/active-roast/lib/roast-note';
import { roastEventLabel } from '@shared/i18n/roast-event-label';
import type { LogEntry } from '@shared/types/roast';
import { X } from 'lucide-react';

export const RoastLog = ({
    entries,
    variant,
    onRemoveEntry,
    showHeading = true,
}: {
    entries: LogEntry[];
    variant: 'sidebar' | 'main' | 'panel';
    onRemoveEntry?: (id: string) => void;
    showHeading?: boolean;
}) => {
    const isSidebar = variant === 'sidebar';
    const isPanel = variant === 'panel';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {isSidebar && showHeading && (
                <h3
                    style={{
                        fontSize: 12,
                        color: 'var(--color-muted)',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        marginBottom: 10,
                    }}
                >
                    Roast Log
                </h3>
            )}
            {entries.map((entry, i, arr) => {
                const note = entry.event === 'Note' ? formatRoastNote(entry) : entry.note;
                const canRemove =
                    REMOVABLE_LOG_EVENTS.has(entry.event) && !!entry.id && !entry.current && !!onRemoveEntry;
                const categoryTextColor = entry.current
                    ? STATUS_COLORS.active
                    : isControlEvent(entry.event)
                      ? 'var(--color-event-control)'
                      : 'var(--color-primary)';

                return (
                    <div
                        key={entry.id ?? `${entry.time}-${entry.event}-${i}`}
                        style={{
                            display: 'flex',
                            gap: isPanel ? 6 : isSidebar ? 10 : 12,
                            padding: isPanel ? '6px 0' : isSidebar ? '8px 0' : '10px 0',
                            borderBottom: i < arr.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                        }}
                    >
                        <div
                            style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: isSidebar ? 11 : 12,
                                color: 'var(--color-muted)',
                                width: isSidebar || isPanel ? 32 : 36,
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
                                    background: entry.current ? STATUS_COLORS.active : eventMarkerCssColor(entry.event),
                                    boxShadow: entry.current
                                        ? isSidebar
                                            ? `0 0 0 2px ${STATUS_COLORS.activeGlow}`
                                            : `0 0 0 3px ${STATUS_COLORS.activeGlow}`
                                        : 'none',
                                    flexShrink: isSidebar ? 0 : undefined,
                                }}
                            />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                                style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    alignItems: 'center',
                                    gap: isSidebar ? 6 : 8,
                                }}
                            >
                                <span
                                    style={{
                                        fontSize: isSidebar ? 12 : 13,
                                        fontWeight: 500,
                                        color: categoryTextColor,
                                        letterSpacing: isSidebar ? 'normal' : '0.14px',
                                    }}
                                >
                                    {roastEventLabel(entry.event)}
                                </span>
                                <span
                                    style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: isSidebar ? 11 : 12,
                                        color: isControlEvent(entry.event) ? categoryTextColor : 'var(--color-muted)',
                                    }}
                                >
                                    {entry.temp}
                                </span>
                            </div>
                            {note && (
                                <div
                                    style={{
                                        fontSize: isSidebar ? 11 : 12,
                                        color: isControlEvent(entry.event) ? categoryTextColor : 'var(--color-muted)',
                                        letterSpacing: isSidebar ? 'normal' : '0.14px',
                                    }}
                                >
                                    {note}
                                </div>
                            )}
                        </div>
                        {canRemove && (
                            <button
                                type="button"
                                // biome-ignore lint/style/noNonNullAssertion: error already checked above
                                onClick={() => onRemoveEntry(entry.id!)}
                                aria-label={`Delete ${roastEventLabel(entry.event).toLowerCase()}`}
                                className="shrink-0 self-start p-1 border-none bg-transparent text-muted hover:text-primary hover:bg-surface cursor-pointer"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
