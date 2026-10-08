import { eventMarkerCssColor, isControlEvent } from '@features/active-roast/lib/chart-config';
import { STATUS_COLORS } from '@features/active-roast/lib/colors';
import { REMOVABLE_LOG_EVENTS } from '@features/active-roast/lib/constants';
import { formatRoastNote } from '@features/active-roast/lib/roast-note';
import { roastEventLabel } from '@shared/i18n/roast-event-label';
import type { LogEntry } from '@shared/types/roast';
import { Pencil, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type RoastLogEditOptions, RoastLogEntryEditor } from './RoastLogEntryEditor';

export const RoastLog = ({
    entries,
    variant,
    onRemoveEntry,
    editOptions,
    showHeading = true,
}: {
    entries: LogEntry[];
    variant: 'sidebar' | 'main' | 'panel';
    onRemoveEntry?: (id: string) => void;
    editOptions?: RoastLogEditOptions;
    showHeading?: boolean;
}) => {
    const isSidebar = variant === 'sidebar';
    const { t } = useTranslation();
    const [editingId, setEditingId] = useState<string | null>(null);
    const editTriggerRef = useRef<HTMLButtonElement | null>(null);

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
                const key = entry.current ? 'current' : (entry.id ?? `${entry.time}-${entry.event}`);
                const note = entry.event === 'Note' ? formatRoastNote(entry) : entry.note;
                const canRemove =
                    REMOVABLE_LOG_EVENTS.has(entry.event) && !!entry.id && !entry.current && !!onRemoveEntry;
                const canEdit = !!editOptions && !!entry.id && !entry.current && entry.event !== 'Charge';
                const editor =
                    canEdit && editingId === entry.id ? (
                        <RoastLogEntryEditor
                            entry={entry}
                            options={editOptions}
                            onClose={() => {
                                setEditingId(null);
                                editTriggerRef.current?.focus();
                            }}
                        />
                    ) : null;
                const editButton = canEdit ? (
                    <button
                        type="button"
                        aria-label={`${t('common.edit')} ${roastEventLabel(entry.event)}`}
                        aria-expanded={editingId === entry.id}
                        onClick={(event) => {
                            editTriggerRef.current = event.currentTarget;
                            setEditingId(editingId === entry.id ? null : (entry.id ?? null));
                        }}
                        className="flex size-6 shrink-0 items-center justify-center rounded-md border-none bg-transparent text-muted hover:text-primary hover:bg-surface cursor-pointer"
                    >
                        <Pencil size={14} />
                    </button>
                ) : null;
                const actions = (
                    <div className="flex h-6 shrink-0 items-center gap-0.5">
                        {editButton ?? <span aria-hidden="true" className="size-6" />}
                        {canRemove ? (
                            <button
                                type="button"
                                // biome-ignore lint/style/noNonNullAssertion: error already checked above
                                onClick={() => onRemoveEntry(entry.id!)}
                                aria-label={`Delete ${roastEventLabel(entry.event).toLowerCase()}`}
                                className="flex size-6 shrink-0 items-center justify-center rounded-md border-none bg-transparent text-muted hover:text-primary hover:bg-surface cursor-pointer"
                            >
                                <X size={14} />
                            </button>
                        ) : (
                            <span aria-hidden="true" className="size-6" />
                        )}
                    </div>
                );
                const categoryTextColor = entry.current
                    ? STATUS_COLORS.active
                    : isControlEvent(entry.event)
                      ? 'var(--color-event-control)'
                      : 'var(--color-primary)';

                if (variant === 'panel') {
                    return (
                        <div
                            key={key}
                            className="py-2"
                            style={{
                                borderBottom: i < arr.length - 1 ? '1px solid var(--color-border-subtle)' : undefined,
                            }}
                        >
                            <div className="flex items-center gap-1.5">
                                <span
                                    className="size-1.5 shrink-0 rounded-full"
                                    style={{
                                        background: entry.current
                                            ? STATUS_COLORS.active
                                            : eventMarkerCssColor(entry.event),
                                    }}
                                />
                                <span
                                    className="min-w-0 flex-1 text-[13px] font-medium"
                                    style={{ color: categoryTextColor }}
                                >
                                    {roastEventLabel(entry.event)}
                                </span>
                                {actions}
                            </div>
                            <div className="flex flex-wrap gap-x-1 text-xs font-mono text-muted">
                                <span>{entry.time}</span>
                                <span aria-hidden="true">·</span>
                                <span>{entry.temp}</span>
                            </div>
                            {note && (
                                <div
                                    className="text-xs"
                                    style={{
                                        color: isControlEvent(entry.event) ? categoryTextColor : 'var(--color-muted)',
                                    }}
                                >
                                    {note}
                                </div>
                            )}
                            {editor}
                        </div>
                    );
                }

                return (
                    <div
                        key={key}
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
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
                        {actions}
                        {editor && <div className="w-full">{editor}</div>}
                    </div>
                );
            })}
        </div>
    );
};
