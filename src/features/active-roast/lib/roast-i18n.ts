type Translate = (key: string) => string;

const EVENT_I18N_KEYS: Record<string, string> = {
    Charge: 'activeRoast.events.charge',
    Yellow: 'activeRoast.events.yellow',
    'FC Start': 'activeRoast.events.fcStart',
    'FC Rolling': 'activeRoast.events.fcRolling',
    'FC End': 'activeRoast.events.fcEnd',
    Drop: 'activeRoast.events.drop',
    End: 'activeRoast.events.end',
    Now: 'activeRoast.events.now',
    Note: 'activeRoast.events.note',
    TP: 'activeRoast.events.tp',
};

const PHASE_I18N_KEYS: Record<string, string> = {
    READY: 'activeRoast.phase.ready',
    PREHEATING: 'activeRoast.phase.preheating',
    IDLE: 'activeRoast.phase.idle',
    Drying: 'activeRoast.phase.drying',
    Maillard: 'activeRoast.phase.maillard',
    Development: 'activeRoast.phase.development',
};

/** UI label for a stored event type. Unknown types pass through (storage key unchanged). */
export const roastEventLabel = (event: string, t: Translate): string => {
    const key = EVENT_I18N_KEYS[event];
    return key ? t(key) : event;
};

/** UI label for an internal roast-phase name from getRoastPhaseName. */
export const roastPhaseLabel = (phaseName: string, t: Translate): string => {
    const key = PHASE_I18N_KEYS[phaseName];
    return key ? t(key) : phaseName;
};
