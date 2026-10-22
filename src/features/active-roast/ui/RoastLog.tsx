import { eventMarkerCssColor, isControlEvent } from '@features/active-roast/lib/chart-config';
import { STATUS_COLORS } from '@features/active-roast/lib/colors';
import { isRemovableLogEvent } from '@features/active-roast/lib/constants';
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
    deletableEvent = isRemovableLogEvent,
    editableEvent = (event: string) => event !== 'Charge',
    showHeading = true,
}: {
    entries: LogEntry[];
    variant: 'sidebar' | 'main' | 'panel';
    onRemoveEntry?: (id: string) => void;
    editOptions?: RoastLogEditOptions;
    deletableEvent?: (event: string) => boolean;
    editableEvent?: (event: string) => boolean;
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
            <div role="list">
                {entries.map((entry, i, arr) => {
                    const key = entry.current ? 'current' : (entry.id ?? `${entry.time}-${entry.event}`);
                    const note = entry.event === 'Note' ? formatRoastNote(entry) : entry.note;
                    const canRemove = deletableEvent(entry.event) && !!entry.id && !entry.current && !!onRemoveEntry;
                    const deleteLocked =
                        entry.event === 'TP' && deletableEvent !== isRemovableLogEvent && !deletableEvent(entry.event);
                    const canEdit = !!editOptions && !!entry.id && !entry.current && editableEvent(entry.event);
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
                                deleteDisabled={deleteLocked}
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
                    const showRemove = (canRemove || deleteLocked) && !canEdit;
                    const reserveSlot = variant === 'main';
                    const removeButton = showRemove ? (
                        <button
                            type="button"
                            disabled={deleteLocked}
                            onClick={() => {
                                if (deleteLocked || !entry.id) return;
                                onRemoveEntry?.(entry.id);
                            }}
                            aria-label={deleteLabel}
                            className="shrink-0 border-none bg-transparent px-1 text-[11px] text-muted hover:text-primary cursor-pointer disabled:cursor-default disabled:opacity-40"
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
                    const payloadTitle =
                        entry.event === 'Note'
                            ? note
                            : isControlEvent(entry.event) || entry.event === 'Fan' || entry.event === 'Drum'
                              ? entry.note
                              : '';
                    const compactTitle = payloadTitle || roastEventLabel(entry.event);
                    return (
                        <div
                            key={key}
                            className="py-2"
                            style={{
                                borderBottom: i < arr.length - 1 ? '1px solid var(--color-border-subtle)' : undefined,
                            }}
                        >
                            <div
                                role="listitem"
                                className="group relative flex min-w-0 items-center gap-1 overflow-hidden"
                                aria-label={[roastEventLabel(entry.event), payloadTitle, entry.time, entry.temp]
                                    .filter(Boolean)
                                    .join(' ')}
                            >
                                <span
                                    className="size-1.5 shrink-0 rounded-full"
                                    style={{
                                        background: entry.current
                                            ? STATUS_COLORS.active
                                            : eventMarkerCssColor(entry.event),
                                    }}
                                />
                                <span
                                    title={compactTitle}
                                    className="min-w-0 shrink truncate whitespace-nowrap text-[13px] font-medium leading-5"
                                    style={{ color: categoryTextColor }}
                                >
                                    {compactTitle}
                                </span>
                                <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted">
                                    {entry.time}
                                </span>
                                {entry.temp ? (
                                    <span className="@container flex min-w-0 flex-1 items-center">
                                        <span className="hidden whitespace-nowrap font-mono text-[11px] text-muted @[2.75rem]:inline">
                                            <span aria-hidden="true"> · </span>
                                            {entry.temp}
                                        </span>
                                    </span>
                                ) : null}
                                {reserveSlot ? (
                                    <div className="ml-auto shrink-0">{actions}</div>
                                ) : (
                                    <div className="absolute top-1/2 right-0 hidden -translate-y-1/2 bg-roast-bg pl-1 group-focus-within:block group-hover:block">
                                        {actions}
                                    </div>
                                )}
                            </div>
                            {editor}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
