/** Drop is a session-ending mark — undo is explicit cancel, not a toggle (#484). */
export const TOGGLEABLE_LOG_EVENTS = new Set(['Yellow', 'FC Start', 'FC Rolling', 'FC End']);
export const REMOVABLE_LOG_EVENTS = new Set(['Note', 'Heater']);

/** localStorage key for last-selected green bean on active roast (device-local preference). */
export const DEFAULT_BEAN_KEY = 'fc_default_bean_id';
