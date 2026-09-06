// model

export type { ChargeOnset, ChargeSample } from './lib/chargeOnset';
export { detectChargeOnset } from './lib/chargeOnset';
export type { RoastEventMarker } from './lib/chart-option';
export { isGreenRoastAlreadyClaimed } from './lib/f3-green-deduct';
export type { PhaseSegment } from './lib/phases';
export { computePhaseSegments } from './lib/phases';
// lib
export {
    formatTemp,
    fromDisplayTemp,
    rorUnitLabel,
    tempUnitLabel,
    toDisplayRoR,
    toDisplayTemp,
    toDisplayTempDelta,
} from './lib/temperature';
export type { TurningPoint } from './lib/turningPoints';
export { detectTurningPoints } from './lib/turningPoints';
export type { BbpSample, BbpSummary } from './model/bbp';
export { BBP_MAX_SECONDS, useBbpStore } from './model/bbp';
export type {
    EventMarkerStyle,
    PidDropBehavior,
    PollIntervalMs,
    RoastSettings,
    RorSpanSec,
    TemperatureUnit,
} from './model/settings';
export { coercePollIntervalForPlan, updateRoastSettings, useRoastSettings } from './model/settings';
export type { RoastingState, RoastPhase } from './model/status';
export { useRoastingStore } from './model/status';
export { useBbpTimer } from './model/useBbpTimer';
export type { DeductRoastStockParams } from './model/useDeductRoastStock';
export { useDeductRoastStock } from './model/useDeductRoastStock';
export { useEffectivePollIntervalMs } from './model/useEffectivePollInterval';
export { useRoastActions } from './model/useRoastActions';
export { useRoastKeyboardShortcuts } from './model/useRoastKeyboardShortcuts';
export type { SaveRoastFormData, SaveRoastParams, SaveRoastResult } from './model/useSaveRoast';
export { useSaveRoast } from './model/useSaveRoast';
export type { LiveRoastPoint } from './model/useSidecarPolling';
export { checkSidecarAndRecoverIdle, formatLookbackLabel, useSidecarPolling } from './model/useSidecarPolling';
export { RoastTempChart } from './ui/RoastTempChart';
