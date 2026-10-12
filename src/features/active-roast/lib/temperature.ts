export type TemperatureUnit = 'C' | 'F';

export const toDisplayTemp = (celsius: number, unit: TemperatureUnit): number =>
    unit === 'F' ? (celsius * 9) / 5 + 32 : celsius;

/** toDisplayTemp의 역변환 — 표시 단위 값을 저장 단위(°C)로 되돌린다 */
export const fromDisplayTemp = (display: number, unit: TemperatureUnit): number =>
    unit === 'F' ? ((display - 32) * 5) / 9 : display;

export const normalizeTemperatureTicks = (values: unknown): number[] | null =>
    Array.isArray(values) &&
    values.length <= 100 &&
    values.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 500)
        ? [...new Set<number>(values)].sort((a, b) => a - b)
        : null;

export const parseTemperatureTicks = (input: string, unit: TemperatureUnit): number[] | null => {
    if (!input.trim()) return [];
    const values = input.split(',').map((value) => (value.trim() === '' ? Number.NaN : Number(value)));
    return normalizeTemperatureTicks(values.map((value) => fromDisplayTemp(value, unit)));
};

export const tempUnitLabel = (unit: TemperatureUnit): string => `°${unit}`;
export const rorUnitLabel = (unit: TemperatureUnit): string => `${tempUnitLabel(unit)}/min`;

export const formatTemp = (celsius: number | null, unit: TemperatureUnit): string =>
    celsius == null ? '—' : `${toDisplayTemp(celsius, unit).toFixed(1)}${tempUnitLabel(unit)}`;

/** RoR는 델타 온도 단위 — °F/min = °C/min × 9/5 */
export const toDisplayRoR = (cPerMin: number, unit: TemperatureUnit): number =>
    unit === 'F' ? (cPerMin * 9) / 5 : cPerMin;

/** toDisplayRoR의 역변환. °F도 델타라 +32는 없다. */
export const fromDisplayRoR = (display: number, unit: TemperatureUnit): number =>
    unit === 'F' ? (display * 5) / 9 : display;

/** Stored °C/min. Negatives are allowed; the axis range is −100…300. */
export const normalizeRorTicks = (values: unknown): number[] | null =>
    Array.isArray(values) &&
    values.length <= 100 &&
    values.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= -100 && value <= 300)
        ? [...new Set<number>(values)].sort((a, b) => a - b)
        : null;

export const parseRorTicks = (input: string, unit: TemperatureUnit): number[] | null => {
    if (!input.trim()) return [];
    const values = input.split(',').map((value) => (value.trim() === '' ? Number.NaN : Number(value)));
    return normalizeRorTicks(values.map((value) => fromDisplayRoR(value, unit)));
};

/** Drop-temp Δ / SD — same °C→°F scale as RoR (not absolute toDisplayTemp). */
export const toDisplayTempDelta = toDisplayRoR;
