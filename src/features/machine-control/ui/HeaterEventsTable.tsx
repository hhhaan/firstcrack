import { logger } from '@shared/lib/logger';
import { inputCls } from '@shared/ui/form-styles';
import { Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    applyTimeEdit,
    BT_DECIMALS,
    commitEditTime,
    HEAT_DECIMALS,
    type HeaterDraftInput,
    isDecimalDraft,
    type TimeEditKind,
} from '../lib/heater-events';

export type DraftRow = HeaterDraftInput & {
    key: string;
};

export const HeaterEventsTable = ({
    unit,
    heaterUnit,
    busy,
    rows,
    selected,
    lockedCount,
    invalidCell,
    allowNegativeHeat,
    onSelect,
    onUpdate,
    onDelete,
}: {
    unit: 'C' | 'F';
    heaterUnit: string;
    busy: boolean;
    rows: DraftRow[];
    selected: number;
    lockedCount: number;
    invalidCell?: { row: number; field: 'time' | 'bt' | 'heat' } | null;
    allowNegativeHeat: boolean;
    onSelect: (index: number) => void;
    onUpdate: (key: string, patch: Partial<DraftRow>) => void;
    onDelete?: (key: string) => void;
}) => {
    const { t } = useTranslation();
    const timeEdit = useRef(
        new WeakMap<HTMLInputElement, { suppress: boolean; secondsOpen: boolean; digits: string }>(),
    );
    const pasteClaimed = useRef(new WeakMap<HTMLInputElement, boolean>());
    const unhandledTimeInputs = useRef(new WeakSet<HTMLInputElement>());
    const caretFix = useRef<{ el: HTMLInputElement; caret: number } | null>(null);
    const rootRef = useRef<HTMLFieldSetElement>(null);
    useLayoutEffect(() => {
        const fix = caretFix.current;
        if (!fix) return;
        caretFix.current = null;
        const place = () => {
            if (fix.el.isConnected && document.activeElement === fix.el) {
                fix.el.setSelectionRange(fix.caret, fix.caret);
            }
        };
        place();
        requestAnimationFrame(place);
    });
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const editTime = (input: HTMLInputElement, kind: TimeEditKind, text: string) => {
            const key = input.dataset.timeKey;
            if (!key) return;
            const start = input.selectionStart ?? 0;
            const end = input.selectionEnd ?? start;
            const prior = timeEdit.current.get(input);
            const res = applyTimeEdit(
                input.value,
                start,
                end,
                text,
                kind,
                prior?.suppress ?? false,
                prior?.secondsOpen ?? false,
                prior?.digits ?? '',
            );
            timeEdit.current.set(input, {
                suppress: res.suppress,
                secondsOpen: res.secondsOpen,
                digits: res.digits,
            });
            caretFix.current = { el: input, caret: res.caret };
            input.setSelectionRange(res.caret, res.caret);
            onUpdate(key, { t: res.value });
        };
        const claimPaste = (input: HTMLInputElement, text: string) => {
            if (pasteClaimed.current.get(input)) return;
            pasteClaimed.current.set(input, true);
            queueMicrotask(() => pasteClaimed.current.set(input, false));
            editTime(input, 'insert', text);
        };
        const isTimeInput = (target: EventTarget | null): target is HTMLInputElement =>
            target instanceof HTMLInputElement && target.dataset.timeKey != null && !target.readOnly;
        const onBefore = (event: Event) => {
            if (!(event instanceof InputEvent) || !isTimeInput(event.target)) return;
            const type = event.inputType;
            if (type === 'insertFromPaste') {
                event.preventDefault();
                claimPaste(event.target, event.data ?? '');
                return;
            }
            if (type === 'insertText' || type === 'insertReplacementText') {
                event.preventDefault();
                editTime(event.target, 'insert', event.data ?? '');
                return;
            }
            if (type === 'deleteContentBackward') {
                event.preventDefault();
                editTime(event.target, 'backspace', '');
                return;
            }
            if (type === 'deleteContentForward' || type === 'deleteByCut') {
                event.preventDefault();
                editTime(event.target, 'delete', '');
            }
        };
        const onPaste = (event: Event) => {
            if (!(event instanceof ClipboardEvent) || !isTimeInput(event.target)) return;
            event.preventDefault();
            claimPaste(event.target, event.clipboardData?.getData('text') ?? '');
        };
        const onBlur = (event: Event) => {
            if (!isTimeInput(event.target)) return;
            const committed = commitEditTime(event.target.value);
            if (committed === event.target.value) return;
            const key = event.target.dataset.timeKey;
            if (!key) return;
            timeEdit.current.set(event.target, { suppress: false, secondsOpen: false, digits: '' });
            onUpdate(key, { t: committed });
        };
        root.addEventListener('beforeinput', onBefore);
        root.addEventListener('paste', onPaste);
        root.addEventListener('focusout', onBlur);
        return () => {
            root.removeEventListener('beforeinput', onBefore);
            root.removeEventListener('paste', onPaste);
            root.removeEventListener('focusout', onBlur);
        };
    }, [onUpdate]);
    return (
        <fieldset
            ref={rootRef}
            disabled={busy}
            aria-labelledby="heater-events-steps-title"
            className="m-0 flex min-h-[350px] min-w-0 flex-1 flex-col border-0 px-6 py-5 lg:min-h-0"
        >
            <div className="mb-4 flex items-center justify-between">
                <h3 id="heater-events-steps-title" className="m-0 text-sm font-semibold text-primary">
                    {t('heaterEventsEditor.stepsTitle')}
                </h3>
                <span className="text-xs text-muted">{rows.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[280px] table-fixed border-separate border-spacing-y-1.5 text-xs">
                    <colgroup>
                        <col className="w-8" />
                        <col />
                        <col className="w-[84px]" />
                        <col className={onDelete ? 'w-8' : 'w-2'} />
                    </colgroup>
                    <thead>
                        <tr className="text-[11px] font-semibold text-muted">
                            <th className="sticky top-0 z-10 bg-main-bg" />
                            <th className="sticky top-0 z-10 bg-main-bg px-1 pb-1 text-left">
                                {t('heaterEventsEditor.condition')}
                            </th>
                            <th className="sticky top-0 z-10 bg-main-bg px-1 pb-1 text-left">
                                {t('heaterEventsEditor.heat')} ({heaterUnit})
                            </th>
                            <th className="sticky top-0 z-10 bg-main-bg" />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => {
                            const locked = i < lockedCount;
                            const cellInvalid = (field: 'time' | 'bt' | 'heat') =>
                                invalidCell?.row === i + 1 && invalidCell.field === field;
                            const cellClass =
                                i === selected
                                    ? 'border-(--color-control-heat) bg-surface-warm-solid'
                                    : 'border-border bg-main-bg';
                            return (
                                <tr
                                    key={row.key}
                                    aria-selected={i === selected}
                                    onClick={() => onSelect(i)}
                                    onFocus={() => onSelect(i)}
                                >
                                    <td
                                        className={`${cellClass} rounded-l-xl border-y border-l py-2 pl-2 text-[11px] font-semibold text-muted`}
                                    >
                                        {String(i + 1).padStart(2, '0')}
                                    </td>
                                    <td className={`${cellClass} border-y px-1 py-2`}>
                                        <div className="mb-1 text-[11px] font-semibold text-secondary">
                                            {row.trigger === 'time'
                                                ? `${t('heaterEventsEditor.conditionTime')} (m:ss)`
                                                : `${t('heaterEventsEditor.conditionBt')} (°${unit})`}
                                        </div>
                                        {row.trigger === 'time' ? (
                                            <input
                                                value={row.t}
                                                onChange={(event) => {
                                                    if (event.target.value === row.t) return;
                                                    if (!unhandledTimeInputs.current.has(event.target)) {
                                                        unhandledTimeInputs.current.add(event.target);
                                                        logger.capture(
                                                            new Error('Heater event time input bypassed beforeinput'),
                                                        );
                                                    }
                                                    onUpdate(row.key, { t: event.target.value });
                                                }}
                                                data-time-key={row.key}
                                                className={`${inputCls} min-w-0 px-2 py-1.5 text-xs${cellInvalid('time') ? ' border-red-500' : ''}`}
                                                aria-invalid={cellInvalid('time') || undefined}
                                                inputMode="numeric"
                                                autoComplete="off"
                                                spellCheck={false}
                                                aria-label={t('heaterEventsEditor.time')}
                                                readOnly={locked}
                                            />
                                        ) : (
                                            <input
                                                value={row.bt}
                                                onChange={(e) => {
                                                    if (isDecimalDraft(e.target.value, BT_DECIMALS))
                                                        onUpdate(row.key, { bt: e.target.value });
                                                }}
                                                className={`${inputCls} min-w-0 px-2 py-1.5 text-xs${cellInvalid('bt') ? ' border-red-500' : ''}`}
                                                aria-invalid={cellInvalid('bt') || undefined}
                                                inputMode="decimal"
                                                aria-label={t('heaterEventsEditor.bt')}
                                                readOnly={locked}
                                            />
                                        )}
                                    </td>
                                    <td className={`${cellClass} border-y px-1 py-2`}>
                                        <input
                                            value={row.heater}
                                            onChange={(e) => {
                                                if (isDecimalDraft(e.target.value, HEAT_DECIMALS, allowNegativeHeat))
                                                    onUpdate(row.key, { heater: e.target.value });
                                            }}
                                            className={`${inputCls} min-w-0 px-2 py-1.5 text-xs${cellInvalid('heat') ? ' border-red-500' : ''}`}
                                            aria-invalid={cellInvalid('heat') || undefined}
                                            inputMode="decimal"
                                            aria-label={t('heaterEventsEditor.heat')}
                                            readOnly={locked}
                                        />
                                    </td>
                                    <td className={`${cellClass} rounded-r-xl border-y border-r py-2 pr-1`}>
                                        {onDelete && (
                                            <button
                                                type="button"
                                                className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg border-none bg-transparent text-muted hover:bg-surface hover:text-red-600"
                                                aria-label={t('heaterEventsEditor.deleteRow')}
                                                disabled={locked}
                                                onClick={() => onDelete(row.key)}
                                            >
                                                <Trash2 size={14} strokeWidth={2} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {rows.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted">{t('heaterEventsEditor.empty')}</p>
                )}
            </div>
        </fieldset>
    );
};
