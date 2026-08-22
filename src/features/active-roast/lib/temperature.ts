import type { TemperatureUnit } from '../model/settings';

export const toDisplayTemp = (celsius: number, unit: TemperatureUnit): number =>
    unit === 'F' ? (celsius * 9) / 5 + 32 : celsius;

/** toDisplayTemp의 역변환 — 표시 단위 값을 저장 단위(°C)로 되돌린다 */
export const fromDisplayTemp = (display: number, unit: TemperatureUnit): number =>
    unit === 'F' ? ((display - 32) * 5) / 9 : display;

export const tempUnitLabel = (unit: TemperatureUnit): string => `°${unit}`;
export const rorUnitLabel = (unit: TemperatureUnit): string => `${tempUnitLabel(unit)}/min`;

export const formatTemp = (celsius: number | null, unit: TemperatureUnit): string =>
    celsius == null ? '—' : `${toDisplayTemp(celsius, unit).toFixed(1)}${tempUnitLabel(unit)}`;

/** RoR는 델타 온도 단위 — °F/min = °C/min × 9/5 */
export const toDisplayRoR = (cPerMin: number, unit: TemperatureUnit): number =>
    unit === 'F' ? (cPerMin * 9) / 5 : cPerMin;

/** Drop-temp Δ / SD — same °C→°F scale as RoR (not absolute toDisplayTemp). */
export const toDisplayTempDelta = toDisplayRoR;
