import { logger } from '@shared/lib/logger';
import { useTimeEditRoot } from '@shared/lib/useTimeEditRoot';
import { inputCls } from '@shared/ui/form-styles';
import { ListOrdered, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BT_DECIMALS, HEAT_DECIMALS, type HeaterDraftInput, isDecimalDraft, isPartialTime } from '../lib/heater-events';

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
    dischargeOpenSupported,
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
    dischargeOpenSupported?: boolean;
    onSelect: (index: number) => void;
    onUpdate: (key: string, patch: Partial<DraftRow>) => void;
    onDelete?: (key: string) => void;
}) => {
    const { t } = useTranslation();
    const unhandledTimeInputs = useRef(new WeakSet<HTMLInputElement>());
    const setTimeRoot = useTimeEditRoot((key, value) => onUpdate(key, { t: value }));
    return (
        <fieldset
            ref={setTimeRoot}
            disabled={busy}
            aria-labelledby="heater-events-steps-title"
            className="m-0 flex min-h-40 min-w-0 flex-1 flex-col border-0 border-t border-border-subtle px-5 py-4"
        >
            <div className="mb-3 flex shrink-0 items-center gap-2">
                <h3 id="heater-events-steps-title" className="m-0 text-sm font-semibold text-primary">
                    {t('heaterEventsEditor.stepsTitle')}
                </h3>
                <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-medium text-secondary">
                    {rows.length}
                </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
                {rows.length === 0 ? (
                    <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-elevated px-5 py-5 text-center">
                        <ListOrdered size={22} strokeWidth={1.5} className="mb-2 text-muted" aria-hidden="true" />
                        <p className="m-0 text-sm font-medium text-primary">{t('heaterEventsEditor.empty')}</p>
                        <p className="mt-1 mb-0 max-w-80 text-xs leading-5 text-muted">
                            {t('heaterEventsEditor.emptyHint')}
                        </p>
                    </div>
                ) : (
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
                                    {dischargeOpenSupported
                                        ? t('heaterEventsEditor.action')
                                        : `${t('heaterEventsEditor.heat')} (${heaterUnit})`}
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
                                                        if (!isPartialTime(event.target.value)) {
                                                            event.target.value = row.t;
                                                            return;
                                                        }
                                                        if (!unhandledTimeInputs.current.has(event.target)) {
                                                            unhandledTimeInputs.current.add(event.target);
                                                            logger.capture(
                                                                new Error(
                                                                    'Heater event time input bypassed beforeinput',
                                                                ),
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
                                                        if (!isDecimalDraft(e.target.value, BT_DECIMALS)) {
                                                            e.target.value = row.bt;
                                                            return;
                                                        }
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
                                        <td className={`${cellClass} border-y px-1 py-2 align-bottom`}>
                                            {row.kind === 'discharge_open' ? (
                                                <span className="text-xs font-medium text-secondary">
                                                    {t('heaterEventsEditor.dischargeOpen')}
                                                </span>
                                            ) : (
                                                <input
                                                    value={row.heater}
                                                    onChange={(e) => {
                                                        if (
                                                            !isDecimalDraft(
                                                                e.target.value,
                                                                HEAT_DECIMALS,
                                                                allowNegativeHeat,
                                                            )
                                                        ) {
                                                            e.target.value = row.heater;
                                                            return;
                                                        }
                                                        onUpdate(row.key, { heater: e.target.value });
                                                    }}
                                                    className={`${inputCls} min-w-0 px-2 py-1.5 text-xs${cellInvalid('heat') ? ' border-red-500' : ''}`}
                                                    aria-invalid={cellInvalid('heat') || undefined}
                                                    inputMode="decimal"
                                                    aria-label={t('heaterEventsEditor.heat')}
                                                    readOnly={locked}
                                                />
                                            )}
                                        </td>
                                        <td
                                            className={`${cellClass} rounded-r-xl border-y border-r py-2 pr-1 align-bottom`}
                                        >
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
                )}
            </div>
        </fieldset>
    );
};
