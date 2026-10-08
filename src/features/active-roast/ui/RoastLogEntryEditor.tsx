import { parseEditTime } from '@shared/lib/time-edit';
import type { LogEntry } from '@shared/types/roast';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyEventMarkerEdit, type EventMarkerPatch, type MarkerDragLivePoint } from '../lib/event-marker-drag';
import { fromDisplayTemp, toDisplayTemp } from '../lib/temperature';
import type { TemperatureUnit } from '../model/settings';

export type RoastLogEditOptions = {
    unit: TemperatureUnit;
    livePoints: ReadonlyArray<MarkerDragLivePoint>;
    maxTimeSec: number;
    onEditEntry: (id: string, patch: EventMarkerPatch) => void;
};

export function RoastLogEntryEditor({
    entry,
    options,
    onClose,
}: {
    entry: LogEntry;
    options: RoastLogEditOptions;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const displayTemp = (value: LogEntry) =>
        value.tempC == null ? '' : toDisplayTemp(value.tempC, options.unit).toFixed(1);
    const [draft, setDraft] = useState<{
        time: string;
        temp: string;
        patch: EventMarkerPatch;
        valid: boolean;
        field: 'time' | 'temp' | null;
    }>({
        time: entry.time,
        temp: displayTemp(entry),
        patch: {},
        valid: false,
        field: null,
    });
    const change = (field: 'time' | 'temp', value: string) => {
        const parsed = field === 'time' ? parseEditTime(value) : value.trim() === '' ? null : Number(value);
        const patch =
            field === 'time'
                ? { timeSec: parsed ?? Number.NaN }
                : { tempC: fromDisplayTemp(parsed ?? Number.NaN, options.unit) };
        const entries = [{ ...entry, timeSec: parseEditTime(draft.time) ?? entry.timeSec }];
        const next = applyEventMarkerEdit(
            entries,
            entry.id,
            patch,
            options.livePoints,
            options.unit,
            options.maxTimeSec,
        );
        const valid = parsed != null && Number.isFinite(parsed) && next !== entries;
        setDraft({
            time: valid ? next[0].time : draft.time,
            temp: valid ? displayTemp(next[0]) : draft.temp,
            [field]: value,
            patch,
            valid,
            field,
        });
    };
    return (
        <form
            className="mt-2 flex flex-col gap-1.5 text-xs"
            onSubmit={(event) => {
                event.preventDefault();
                if (!draft.valid || !entry.id) return;
                options.onEditEntry(entry.id, { ...draft.patch, timeSec: parseEditTime(draft.time) ?? undefined });
                onClose();
            }}
            onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') {
                    event.preventDefault();
                    onClose();
                }
            }}
        >
            <label className="flex items-center justify-between gap-1">
                {t('activeRoast.noteEntry.time')}
                <input
                    autoFocus
                    aria-label={t('activeRoast.noteEntry.time')}
                    className="w-20 min-w-0 rounded border border-border-subtle bg-surface px-1.5 py-1 font-mono"
                    value={draft.time}
                    aria-invalid={draft.field === 'time' && !draft.valid}
                    onChange={(event) => change('time', event.target.value)}
                />
            </label>
            <label className="flex items-center justify-between gap-1">
                {t('activeRoast.summary.temperature')} °{options.unit}
                <input
                    aria-label={`${t('activeRoast.summary.temperature')} °${options.unit}`}
                    inputMode="decimal"
                    className="w-20 min-w-0 rounded border border-border-subtle bg-surface px-1.5 py-1 font-mono"
                    value={draft.temp}
                    aria-invalid={draft.field === 'temp' && !draft.valid}
                    onChange={(event) => change('temp', event.target.value)}
                />
            </label>
            {draft.field && !draft.valid && (
                <p role="status" className="text-muted">
                    {t('activeRoast.log.editRangeHint')}
                </p>
            )}
            <div className="flex justify-end gap-1">
                <button type="button" className="rounded px-2 py-1 text-muted hover:text-primary" onClick={onClose}>
                    {t('common.cancel')}
                </button>
                <button
                    type="submit"
                    disabled={!draft.valid}
                    className="rounded bg-primary px-2 py-1 text-white disabled:opacity-40"
                >
                    {t('common.save')}
                </button>
            </div>
        </form>
    );
}
