import { sanitizeDecimal } from '@shared/lib/format';

/** Roast-record controls the operator types by hand. A later analog panel uses this same list. */
export const MANUAL_CONTROL_IDS = ['gas', 'airflow', 'drum'] as const;
export type ManualControlId = (typeof MANUAL_CONTROL_IDS)[number];

export type ManualControlSetting = {
    id: ManualControlId;
    /** Blank uses the built-in name. */
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

export const DEFAULT_MANUAL_CONTROLS: readonly ManualControlSetting[] = [
    { id: 'gas', label: '', unit: '%', min: 0, max: 100, enabled: true },
    { id: 'airflow', label: '', unit: '%', min: 0, max: 100, enabled: true },
    { id: 'drum', label: '', unit: 'RPM', min: 0, max: 100, enabled: true },
];

const isManualControlId = (id: string): id is ManualControlId => (MANUAL_CONTROL_IDS as readonly string[]).includes(id);

const clip = (value: unknown, max: number, fallback: string) =>
    typeof value === 'string' ? value.slice(0, max) : fallback;

const rangeNumber = (value: unknown): number | undefined =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -MANUAL_CONTROL_RANGE_LIMIT &&
    value <= MANUAL_CONTROL_RANGE_LIMIT
        ? value
        : undefined;

const rangeOf = (row: Partial<ManualControlSetting> | undefined, fallback: ManualControlSetting) => {
    const min = rangeNumber(row?.min);
    const max = rangeNumber(row?.max);
    if (min == null || max == null || min >= max) return { min: fallback.min, max: fallback.max };
    return { min, max };
};

export const normalizeManualControls = (raw: unknown): ManualControlSetting[] => {
    const byId = new Map<ManualControlId, Partial<ManualControlSetting>>();
    if (Array.isArray(raw)) {
        for (const item of raw) {
            if (!item || typeof item !== 'object') continue;
            const id = (item as { id?: unknown }).id;
            if (typeof id !== 'string' || !isManualControlId(id) || byId.has(id)) continue;
            byId.set(id, item as Partial<ManualControlSetting>);
        }
    }
    return DEFAULT_MANUAL_CONTROLS.map((fallback) => {
        const row = byId.get(fallback.id);
        if (!row) return { ...fallback };
        return {
            id: fallback.id,
            label: clip(row.label, MANUAL_CONTROL_LABEL_MAX, ''),
            unit: clip(row.unit, MANUAL_CONTROL_UNIT_MAX, fallback.unit),
            ...rangeOf(row, fallback),
            enabled: row.enabled !== false,
        };
    });
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
export const commitManualControl = (id: ManualControlId, value: string, controls: readonly ManualControlSetting[]) => {
    const row = controls.find((item) => item.id === id);
    if (row && !row.enabled) return value.trim();
    const numeric = noteControlValue(value);
    if (!row || numeric === '') return numeric;
    const parsed = Number(numeric);
    if (!Number.isFinite(parsed) || parsed < row.min || parsed > row.max) return '';
    return numeric;
};
