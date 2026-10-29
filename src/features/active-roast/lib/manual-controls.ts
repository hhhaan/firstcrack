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
    enabled: boolean;
};

export const MANUAL_CONTROL_LABEL_MAX = 16;
export const MANUAL_CONTROL_UNIT_MAX = 8;

export const DEFAULT_MANUAL_CONTROLS: readonly ManualControlSetting[] = [
    { id: 'gas', label: '', unit: '%', enabled: true },
    { id: 'airflow', label: '', unit: '%', enabled: true },
    { id: 'drum', label: '', unit: 'RPM', enabled: true },
];

const isManualControlId = (id: string): id is ManualControlId => (MANUAL_CONTROL_IDS as readonly string[]).includes(id);

const clip = (value: unknown, max: number, fallback: string) =>
    typeof value === 'string' ? value.slice(0, max) : fallback;

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
            enabled: row.enabled !== false,
        };
    });
};

/** Keystrokes: digits and one decimal point. */
export const noteControlDraft = (value: string) => sanitizeDecimal(value);

/** Value to store. Drops a trailing dot left in the field while typing. */
export const noteControlValue = (value: string) => noteControlDraft(value).replace(/\.$/, '');

export const isNumericControlValue = (value: string) => /^\d+(\.\d+)?$/.test(value);

/** Enabled fields keep a number. A hidden field keeps what was already recorded. */
export const commitManualControl = (id: ManualControlId, value: string, controls: readonly ManualControlSetting[]) => {
    const row = controls.find((item) => item.id === id);
    if (row && !row.enabled) return value.trim();
    return noteControlValue(value);
};
