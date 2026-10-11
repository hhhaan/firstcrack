import { eventMarkerCssColor, isControlEvent } from '@features/active-roast/lib/chart-config';
import { STATUS_COLORS } from '@features/active-roast/lib/colors';
import { REMOVABLE_LOG_EVENTS } from '@features/active-roast/lib/constants';
import { formatRoastNote } from '@features/active-roast/lib/roast-note';
import { roastEventLabel } from '@shared/i18n/roast-event-label';
import type { LogEntry } from '@shared/types/roast';
import { Pencil } from 'lucide-react';
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
                const deleteLabel = `Delete ${roastEventLabel(entry.event).toLowerCase()}`;
                const editor =
                    canEdit && editingId === entry.id ? (
                        <RoastLogEntryEditor
                            entry={entry}
                            options={editOptions}
                            onClose={() => {
                                setEditingId(null);
                                editTriggerRef.current?.focus();
                            }}
                            onDelete={
                                canRemove
                                    ? () => {
                                          if (entry.id) onRemoveEntry?.(entry.id);
                                      }
                                    : undefined
                            }
                            deleteLabel={deleteLabel}
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
                const showRemove = canRemove && !canEdit;
                const reserveSlot = variant === 'main';
                const removeButton = showRemove ? (
                    <button
                        type="button"
                        onClick={() => {
                            if (entry.id) onRemoveEntry?.(entry.id);
                        }}
                        aria-label={deleteLabel}
                        className="shrink-0 border-none bg-transparent px-1 text-[11px] text-muted hover:text-primary cursor-pointer"
                    >
                        {t('common.delete')}
                    </button>
                ) : reserveSlot ? (
                    <span aria-hidden="true" className="size-6" />
                ) : null;
                const actions = (
                    <div
                        className={
                            !reserveSlot && !editButton && !showRemove ? 'hidden' : 'flex h-6 shrink-0 items-center'
                        }
                    >
                        {reserveSlot ? (
                            <>
                                {editButton ?? <span aria-hidden="true" className="size-6" />}
                                {removeButton}
                            </>
                        ) : (
                            <>
                                {removeButton}
                                {editButton}
                            </>
                        )}
                    </div>
                );
                const categoryTextColor = entry.current
                    ? STATUS_COLORS.active
                    : isControlEvent(entry.event)
                      ? 'var(--color-event-control)'
                      : 'var(--color-primary)';

                if (variant !== 'main') {
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
                                    className="min-w-0 flex-1 break-keep text-[13px] font-medium leading-5"
                                    style={{ color: categoryTextColor }}
                                >
                                    {roastEventLabel(entry.event)}
                                </span>
                                {actions}
                            </div>
                            <div className="font-mono text-[11px] text-muted">
                                <span>{entry.time}</span>
                                <span aria-hidden="true"> · </span>
                                <span className="whitespace-nowrap">{entry.temp}</span>
                            </div>
                            {note && (
                                <div
                                    className="break-keep text-[11px] leading-4"
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
                            alignItems: 'flex-start',
                            gap: 12,
                            padding: '10px 0',
                            borderBottom: i < arr.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                        }}
                    >
                        <div
                            style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: 12,
                                color: 'var(--color-muted)',
                                width: 36,
                                flexShrink: 0,
                                paddingTop: 1,
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
                                    width: 7,
                                    height: 7,
                                    borderRadius: '50%',
                                    background: entry.current ? STATUS_COLORS.active : eventMarkerCssColor(entry.event),
                                    boxShadow: entry.current ? `0 0 0 3px ${STATUS_COLORS.activeGlow}` : 'none',
                                }}
                            />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                                style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    alignItems: 'center',
                                    gap: 8,
                                }}
                            >
                                <span
                                    style={{
                                        fontSize: 13,
                                        fontWeight: 500,
                                        color: categoryTextColor,
                                        letterSpacing: '0.14px',
                                    }}
                                >
                                    {roastEventLabel(entry.event)}
                                </span>
                                <span
                                    style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: 12,
                                        color: isControlEvent(entry.event) ? categoryTextColor : 'var(--color-muted)',
                                    }}
                                >
                                    {entry.temp}
                                </span>
                            </div>
                            {note && (
                                <div
                                    style={{
                                        fontSize: 12,
                                        color: isControlEvent(entry.event) ? categoryTextColor : 'var(--color-muted)',
                                        letterSpacing: '0.14px',
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
