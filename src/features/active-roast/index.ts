// model

export { ALERT_SOUND_KINDS, type AlertSoundKind, isAlertSoundKind, playAlertSound } from './lib/alertSound';
export type { RawTemperatureSample } from './lib/autoCharge';
export type { ChargeOnset, ChargeSample } from './lib/chargeOnset';
export { detectChargeOnset } from './lib/chargeOnset';
export type { RoastEventMarker } from './lib/chart-option';
export type { PhaseSegment } from './lib/phases';
export { computePhaseSegments } from './lib/phases';
export type { ObservationQuality, SensorObservation } from './lib/sensorObservation';
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
export type { BbpPoint, BbpSample, BbpSummary } from './model/bbp';
export { BBP_INPROGRESS_ID, BBP_MAX_SECONDS, useBbpStore } from './model/bbp';
export type {
    EventMarkerStyle,
    FontScalePct,
    PidDropBehavior,
    PollIntervalMs,
    RoastSettings,
    RorSpanSec,
    TemperatureUnit,
} from './model/settings';
export {
    AUTO_DROP_START_MIN_MAX,
    chartSpanSec,
    coercePollIntervalForPlan,
    FONT_SLIDER_MAX,
    FONT_SLIDER_MIN,
    fontScaleToSlider,
    sliderToFontScale,
    TIME_RANGE_MIN_DEFAULT,
    TIME_RANGE_PRESET_MIN,
    updateRoastSettings,
    useRoastSettings,
} from './model/settings';
export type { RoastingState, RoastPhase } from './model/status';
export { useRoastingStore } from './model/status';
export { useBbpTimer } from './model/useBbpTimer';
export type { DeductRoastStockParams } from './model/useDeductRoastStock';
export { useDeductRoastStock } from './model/useDeductRoastStock';
export { useEffectivePollIntervalMs } from './model/useEffectivePollInterval';
export { useRoastActions } from './model/useRoastActions';
export { isRoastShortcutBaseEnabled, useRoastKeyboardShortcuts } from './model/useRoastKeyboardShortcuts';
export type { SaveRoastFormData, SaveRoastParams, SaveRoastResult } from './model/useSaveRoast';
export { useSaveRoast } from './model/useSaveRoast';
export { RoastTempChart } from './ui/RoastTempChart';
