import { STATUS_COLORS } from '@features/active-roast/lib/colors';
import { roastEventLabel, roastPhaseLabel } from '@features/active-roast/lib/roast-i18n';
import type { LogEntry } from '@shared/types/roast';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const RoastLog = ({
    entries,
    eventMarkerColor,
    variant,
    onRemoveEntry,
}: {
    entries: LogEntry[];
    eventMarkerColor: Record<string, string>;
    variant: 'sidebar' | 'main';
    onRemoveEntry?: (id: string) => void;
}) => {
    const { t } = useTranslation();
    const isSidebar = variant === 'sidebar';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {isSidebar && (
                <h3
                    style={{
                        fontSize: 12,
                        color: 'var(--color-muted)',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        marginBottom: 10,
                    }}
                >
                    {t('activeRoast.log.title')}
                </h3>
            )}
            {entries.map((entry, i, arr) => {
                const canRemove = entry.event === 'Note' && !!entry.id && !entry.current && !!onRemoveEntry;

                return (
                    <div
                        key={entry.id ?? `${entry.time}-${entry.event}-${i}`}
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
                                        ? STATUS_COLORS.active
                                        : (eventMarkerColor[entry.event] ?? 'var(--color-border)'),
                                    boxShadow: entry.current
                                        ? isSidebar
                                            ? `0 0 0 2px ${STATUS_COLORS.activeGlow}`
                                            : `0 0 0 3px ${STATUS_COLORS.activeGlow}`
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
                                    {roastEventLabel(entry.event, t)}
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
                            {entry.note && (
                                <div
                                    style={{
                                        fontSize: isSidebar ? 11 : 12,
                                        color: 'var(--color-muted)',
                                        letterSpacing: isSidebar ? 'normal' : '0.14px',
                                    }}
                                >
                                    {entry.current && entry.event === 'Now'
                                        ? t('activeRoast.actions.inProgress', {
                                              phase: roastPhaseLabel(entry.note.replace(/ in progress$/, ''), t),
                                          })
                                        : entry.note}
                                </div>
                            )}
                        </div>
                        {canRemove && (
                            <button
                                type="button"
                                // biome-ignore lint/style/noNonNullAssertion: error already checked above
                                onClick={() => onRemoveEntry(entry.id!)}
                                aria-label={t('activeRoast.log.deleteNote')}
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
