// model

export type { PhaseSegment } from './lib/phases';
export { computePhaseSegments } from './lib/phases';
// lib
export { formatTemp, toDisplayRoR, toDisplayTemp } from './lib/temperature';
export type { TurningPoint } from './lib/turningPoints';
export { detectTurningPoints } from './lib/turningPoints';
export type {
    EventMarkerStyle,
    PollIntervalMs,
    RoastSettings,
    RorSpanSec,
    TemperatureUnit,
} from './model/settings';
export { updateRoastSettings, useRoastSettings } from './model/settings';
export type { RoastingState, RoastPhase } from './model/status';
export { useRoastingStore } from './model/status';
export type { DeductRoastStockParams } from './model/useDeductRoastStock';
export { useDeductRoastStock } from './model/useDeductRoastStock';
export { useRoastActions } from './model/useRoastActions';
export { useRoastKeyboardShortcuts } from './model/useRoastKeyboardShortcuts';
