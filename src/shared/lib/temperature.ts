import type { TemperatureUnit } from '@shared/store/roastSettings';

export const toDisplayTemp = (celsius: number, unit: TemperatureUnit): number =>
    unit === 'F' ? celsius * 9 / 5 + 32 : celsius;

export const formatTemp = (celsius: number | null, unit: TemperatureUnit): string =>
    celsius == null ? '—' : `${toDisplayTemp(celsius, unit).toFixed(1)}°${unit}`;

/** RoR는 델타 온도 단위 — °F/min = °C/min × 9/5 */
export const toDisplayRoR = (cPerMin: number, unit: TemperatureUnit): number =>
    unit === 'F' ? cPerMin * 9 / 5 : cPerMin;
