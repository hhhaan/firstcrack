import { sanitizeDecimal } from '@shared/lib/format';
import type { RoastNoteControls } from '@shared/types/roast';

/** Built-in roast-record controls. A later analog panel uses this same list. */
export const MANUAL_CONTROL_IDS = ['gas', 'airflow', 'drum'] as const;
export type ManualControlId = (typeof MANUAL_CONTROL_IDS)[number];

export type ManualControlSetting = {
    id: string;
    /** Blank on a built-in row uses the translated name. Required on an added row. */
    label: string;
    /** Shown after a numeric value. Not stored on the roast. */
    unit: string;
    /** Inclusive bounds for a recorded number. Not stored on the roast. */
    min: number;
    max: number;
    enabled: boolean;
};

export const MANUAL_CONTROL_LABEL_MAX = 16;
export const MANUAL_CONTROL_UNIT_MAX = 8;
export const MANUAL_CONTROL_RANGE_LIMIT = 100_000;
export const VIRTUAL_CONTROL_LIMIT = 8;

const VIRTUAL_CONTROL_ID = /^v_[a-z0-9]{8,32}$/;

export const DEFAULT_MANUAL_CONTROLS: readonly ManualControlSetting[] = [
    { id: 'gas', label: '', unit: '%', min: 0, max: 100, enabled: true },
    { id: 'airflow', label: '', unit: '%', min: 0, max: 100, enabled: true },
    { id: 'drum', label: '', unit: 'RPM', min: 0, max: 100, enabled: true },
];

export const isBuiltinManualControlId = (id: string): id is ManualControlId =>
    (MANUAL_CONTROL_IDS as readonly string[]).includes(id);

/** Added in settings. Recorded on the note only, never sent to the machine. */
export const isVirtualControlId = (id: string): boolean => VIRTUAL_CONTROL_ID.test(id);

export const newVirtualControl = (label: string): ManualControlSetting => ({
    id: `v_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    label: label.trim().slice(0, MANUAL_CONTROL_LABEL_MAX),
    unit: '',
    min: 0,
    max: 100,
    enabled: true,
});

export type VirtualControlNameError = 'invalid' | 'limit';

/** Reject a blank, over-long, or duplicate name. `taken` includes built-in display names. */
export const virtualControlNameError = (
    name: string,
    taken: readonly string[],
    atLimit: boolean,
): VirtualControlNameError | null => {
    if (atLimit) return 'limit';
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > MANUAL_CONTROL_LABEL_MAX) return 'invalid';
    if (taken.some((item) => item.trim() === trimmed)) return 'invalid';
    return null;
};

const clip = (value: unknown, max: number, fallback: string) =>
    typeof value === 'string' ? value.slice(0, max) : fallback;

const rangeNumber = (value: unknown): number | undefined =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -MANUAL_CONTROL_RANGE_LIMIT &&
    value <= MANUAL_CONTROL_RANGE_LIMIT
        ? value
        : undefined;

const rangeOf = (
    row: Partial<ManualControlSetting> | undefined,
    fallback: Pick<ManualControlSetting, 'min' | 'max'>,
) => {
    const min = rangeNumber(row?.min);
    const max = rangeNumber(row?.max);
    if (min == null || max == null || min >= max) return { min: fallback.min, max: fallback.max };
    return { min, max };
};

export const normalizeManualControls = (raw: unknown): ManualControlSetting[] => {
    const byId = new Map<ManualControlId, Partial<ManualControlSetting>>();
    const virtual: ManualControlSetting[] = [];
    const seen = new Set<string>();
    const labels = new Set<string>();
    if (Array.isArray(raw)) {
        for (const item of raw) {
            if (!item || typeof item !== 'object') continue;
            const row = item as Partial<ManualControlSetting> & { id?: unknown };
            const id = row.id;
            if (typeof id !== 'string' || seen.has(id)) continue;
            if (isBuiltinManualControlId(id)) {
                seen.add(id);
                byId.set(id, row);
                continue;
            }
            if (!isVirtualControlId(id) || virtual.length >= VIRTUAL_CONTROL_LIMIT) continue;
            const label = clip(row.label, MANUAL_CONTROL_LABEL_MAX, '').trim();
            if (!label || labels.has(label)) continue;
            seen.add(id);
            labels.add(label);
            const fallback = { min: 0, max: 100 };
            virtual.push({
                id,
                label,
                unit: clip(row.unit, MANUAL_CONTROL_UNIT_MAX, '').trim(),
                ...rangeOf(row, fallback),
                enabled: row.enabled !== false,
            });
        }
    }
    const builtins = DEFAULT_MANUAL_CONTROLS.map((fallback) => {
        const id = fallback.id;
        const row = isBuiltinManualControlId(id) ? byId.get(id) : undefined;
        return { ...fallback, enabled: row ? row.enabled !== false : fallback.enabled };
    });
    return [...builtins, ...virtual];
};

/** One list per machine id. A missing id keeps the shared list. */
export const normalizeManualControlsByMachine = (raw: unknown): Record<string, ManualControlSetting[]> => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, ManualControlSetting[]> = {};
    for (const [id, value] of Object.entries(raw)) {
        const key = id.trim();
        if (!key || key.length > 80) continue;
        out[key] = normalizeManualControls(value);
    }
    return out;
};

/** Machine list when one is stored. Otherwise the shared list, including roasts with no machine. */
export const manualControlsFor = (
    settings: {
        manualControls?: readonly ManualControlSetting[] | null;
        manualControlsByMachine?: Record<string, ManualControlSetting[]> | null;
    },
    machineId: string | null | undefined,
): ManualControlSetting[] => {
    const shared = settings.manualControls ?? [...DEFAULT_MANUAL_CONTROLS];
    if (!machineId) return [...shared];
    return settings.manualControlsByMachine?.[machineId] ?? [...shared];
};

/** Keystrokes: digits and one decimal point. */
export const noteControlDraft = (value: string) => sanitizeDecimal(value);

/** Value to store. Drops a trailing dot left in the field while typing. */
export const noteControlValue = (value: string) => noteControlDraft(value).replace(/\.$/, '');

export const isNumericControlValue = (value: string) => /^\d+(\.\d+)?$/.test(value);

/** Enabled fields keep a number inside that machine's range. A hidden field keeps what was already recorded. */
export const commitManualControl = (id: string, value: string, controls: readonly ManualControlSetting[]) => {
    const row = controls.find((item) => item.id === id);
    if (row && !row.enabled) return value.trim();
    const numeric = noteControlValue(value);
    if (!row || numeric === '') return numeric;
    const parsed = Number(numeric);
    if (!Number.isFinite(parsed) || parsed < row.min || parsed > row.max) return '';
    return numeric;
};

/** Added-control numbers stored on a note. Unknown ids and words are dropped. */
export const virtualFromUnknown = (raw: unknown): Record<string, string> | undefined => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const out: Record<string, string> = {};
    for (const [id, value] of Object.entries(raw)) {
        if (!isVirtualControlId(id) || typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (!isNumericControlValue(trimmed)) continue;
        out[id] = trimmed;
    }
    return Object.keys(out).length ? out : undefined;
};

/** Builtin and virtual numbers to copy onto a note. Empty fields are omitted. */
export const noteControlFields = (controls?: RoastNoteControls | null): RoastNoteControls => {
    if (!controls) return {};
    const gas = controls.gas?.trim();
    const airflow = controls.airflow?.trim();
    const drum = controls.drum?.trim();
    const virtual = virtualFromUnknown(controls.virtual);
    return {
        ...(gas ? { gas } : {}),
        ...(airflow ? { airflow } : {}),
        ...(drum ? { drum } : {}),
        ...(virtual ? { virtual } : {}),
    };
};

export const hasNoteControl = (controls?: RoastNoteControls | null): boolean => {
    const fields = noteControlFields(controls);
    return Boolean(fields.gas || fields.airflow || fields.drum || fields.virtual);
};

export type ManualControlDraft = {
    gas: string;
    airflow: string;
    drum: string;
    virtual: Record<string, string>;
};

/** Numbers to store from the right-click form. A disabled row keeps its previous number. */
export const commitNoteControls = (
    values: ManualControlDraft,
    controls: readonly ManualControlSetting[],
    includeBuiltins: boolean,
): RoastNoteControls => {
    const draft: RoastNoteControls = {};
    const virtual: Record<string, string> = {};
    for (const row of controls) {
        if (isBuiltinManualControlId(row.id)) {
            if (!includeBuiltins) continue;
            const value = commitManualControl(row.id, values[row.id] ?? '', controls);
            if (value) draft[row.id] = value;
            continue;
        }
        if (!isVirtualControlId(row.id)) continue;
        const value = commitManualControl(row.id, values.virtual[row.id] ?? '', controls);
        if (value) virtual[row.id] = value;
    }
    return noteControlFields({ ...draft, ...(Object.keys(virtual).length ? { virtual } : {}) });
};
