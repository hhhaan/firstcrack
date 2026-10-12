import type { TemperatureUnit } from '../model/settings';

/** Display-unit edits are stored as Celsius deltas, without the Fahrenheit +32 offset. */
export const parseRorAxis = (min: string, max: string, interval: string, unit: TemperatureUnit) => {
    if (![min, max, interval].every((value) => value.trim() !== '')) return null;
    const factor = unit === 'F' ? 5 / 9 : 1;
    const [rorYMin, rorYMax, rorGridInterval] = [min, max, interval].map((value) => Number(value) * factor);
    if (
        ![rorYMin, rorYMax, rorGridInterval].every(Number.isFinite) ||
        rorYMin < -100 ||
        rorYMax > 300 ||
        rorYMax <= rorYMin ||
        rorGridInterval < 0.1 ||
        rorGridInterval > 100
    )
        return null;
    return { rorYMin, rorYMax, rorGridInterval };
};
