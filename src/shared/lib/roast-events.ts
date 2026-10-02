/** Fixed event vocabulary. Preferences control live marking, never stored history. */
export const CONFIGURABLE_ROAST_EVENTS = ['Yellow', 'Color Change', 'FC Start', 'FC End', 'SC Start'] as const;
export type ConfigurableRoastEvent = (typeof CONFIGURABLE_ROAST_EVENTS)[number];
export const ROAST_KEY_EVENT_ORDER = [
    'Charge',
    'TP',
    'Yellow',
    'Color Change',
    'FC Start',
    'FC Rolling',
    'FC End',
    'SC Start',
    'Drop',
    'End',
] as const;
export const ADDABLE_ROAST_EVENTS = [
    'TP',
    'Yellow',
    'Color Change',
    'FC Start',
    'FC Rolling',
    'FC End',
    'SC Start',
] as const;
