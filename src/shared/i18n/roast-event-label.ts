import { i18n } from './index';

/** Stored roast-event ids whose on-screen name follows the active locale. */
const ROAST_EVENT_KEY: Record<string, string> = {
    Charge: 'roastEvent.charge',
    Yellow: 'roastEvent.yellow',
    'FC Start': 'roastEvent.fcStart',
    'FC Rolling': 'roastEvent.fcRolling',
    'FC End': 'roastEvent.fcEnd',
    Drop: 'roastEvent.drop',
    End: 'roastEvent.end',
    TP: 'roastEvent.tp',
};

/** Locale string, or `fallback` when i18n is not ready (unit tests, unknown key). */
export const localeText = (key: string, fallback: string): string => {
    if (!i18n.isInitialized) return fallback;
    const value = i18n.t(key);
    return typeof value === 'string' && value !== key ? value : fallback;
};

/** Display name for a stored event id. Unknown ids, including Note and Heater, stay as stored. */
export const roastEventLabel = (event: string): string => {
    const key = ROAST_EVENT_KEY[event];
    return key ? localeText(key, event) : event;
};

/** Mark Drop button. English stays "Mark Drop"; the Drop mark itself uses `roastEvent.drop`. */
export const markDropLabel = (): string => localeText('roastEvent.markDrop', 'Mark Drop');

export const endRoastLabel = (): string => localeText('roastEvent.endRoast', 'End Roast');

export const roastReadyLabel = (): string => localeText('roastEvent.roastReady', 'Roast Ready');
