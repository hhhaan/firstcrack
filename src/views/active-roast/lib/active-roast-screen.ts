import type { ControlData, RoastEventMarker } from '@features/active-roast/lib/chart-option';
import type { EventMarkerPatch } from '@features/active-roast/lib/event-marker-drag';
import type { PhaseSegment } from '@features/active-roast/lib/phases';
import { toDisplayRoR } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import type { RoastPhase } from '@features/active-roast/model/status';
import type { RoastNoteControls } from '@shared/types/roast';

type TempSample = { bt: number | null; et: number | null };

const FULLSCREEN_CHART_CLASS = 'fixed inset-0 z-9999 h-screen w-screen py-[30px] pl-2.5 pr-2.5';
const WINDOWED_CHART_CLASS = 'rounded relative z-1 pl-2.5 pr-2.5 py-[30px] flex-1 dark:border dark:border-[#585d61]';

export const orNull = <T>(value: T | null | undefined): T | null => value ?? null;

export const orEmpty = (value: string | null | undefined) => value ?? '';

export const bbpFeatureEnabled = (featureOn: boolean, settingOn: boolean) => featureOn && settingOn;

export const bbpElapsedWhenEnabled = <T>(enabled: boolean, elapsed: T): T | null => (enabled ? elapsed : null);

export const bbpChargeWaitActive = (bbpActive: boolean, bbpRecording: boolean, awaitingNextCharge: boolean) =>
    (bbpActive && bbpRecording) || awaitingNextCharge;

export const isChargedPhase = (phase: RoastPhase) => phase === 'roasting' || phase === 'ended';

export const profileSelectionEpoch = (
    workspaceOwnerId: string | null | undefined,
    sessionId: string | null | undefined,
) => `${workspaceOwnerId ?? ''}:${sessionId ?? 'pre'}`;

// Replay reconciles plans by curve identity, including a batch edit without a profile.
const EMPTY_REPLAY_POINTS: never[] = [];

export const replayPointsForProfile = <T>(
    targetProfileId: string | null,
    curveLoading: boolean,
    points: T[],
): T[] | null => (!targetProfileId ? EMPTY_REPLAY_POINTS : curveLoading ? null : points);

export const isWaitingForCharge = (bbpActive: boolean, charged: boolean) => bbpActive || !charged;

export const isReplayMachineMismatch = (referenceKey: string | null, currentKey: string | null) =>
    referenceKey != null && currentKey != null && referenceKey !== currentKey;

export const latestSampleTime = (points: { t: number }[]) => (points.length > 0 ? points[points.length - 1].t : 0);

export const chargeWaitTempBand = (input: {
    waiting: boolean;
    bbpActive: boolean;
    bbpPoints: TempSample[];
    livePoints: TempSample[];
    targetPoints: TempSample[];
    tempMinC: number;
    tempMaxC: number;
}) => {
    const samples = input.waiting
        ? [
              ...(input.bbpActive ? input.bbpPoints : input.livePoints).flatMap((point) => [point.bt, point.et]),
              ...input.targetPoints.flatMap((point) => [point.bt, point.et]),
          ].filter((temp): temp is number => temp != null)
        : [];
    return {
        tempMinC: Math.floor(Math.min(input.tempMinC, ...samples) / 10) * 10,
        tempMaxC: Math.ceil(Math.max(input.tempMaxC, ...samples) / 10) * 10,
    };
};

export const canCancelDrop = (input: {
    hasRestore: boolean;
    submitted: boolean;
    charged: boolean;
    sessionId: string | null;
    restoreSessionId: string | null | undefined;
}) =>
    input.hasRestore &&
    !input.submitted &&
    !(input.charged && input.sessionId != null && input.sessionId !== input.restoreSessionId);

export const formatDisplayRoR = (ror: number | null | undefined, unit: TemperatureUnit) =>
    toDisplayRoR(ror ?? 0, unit).toFixed(1);

export const cycleFcWhenEnabled = <T>(enabled: boolean, cycleFc: T): T | undefined => (enabled ? cycleFc : undefined);

export const batchRoastFinished = (heatHoldAfterDrop: boolean, roastEnded: boolean, dropped: boolean) =>
    heatHoldAfterDrop || roastEnded || dropped;

export const showPendingSummary = (summaryOpen: boolean, summaryData: unknown) => !summaryOpen && Boolean(summaryData);

export const autoChargeUnavailable = (phase: RoastPhase, enabled: boolean, hasRawTemperature: boolean) =>
    phase === 'standby' && enabled && !hasRawTemperature;

export const autoDropUnavailable = (phase: RoastPhase, enabled: boolean, hasRawTemperature: boolean) =>
    phase === 'roasting' && enabled && !hasRawTemperature;

const listUnlessBbp = <T>(bbpActive: boolean, items: T[]): T[] => (bbpActive ? [] : items);

const canEditChartMarkers = (charged: boolean, roastEnded: boolean, bbpActive: boolean) =>
    charged && !roastEnded && !bbpActive;

const anySeriesOn = (drum: boolean, heat: boolean, fan: boolean) => drum || heat || fan;

type ControlFrameInput = {
    showControlChart: boolean;
    showControlDrum: boolean;
    showControlHeat: boolean;
    showControlFan: boolean;
    showTargetCurve: boolean;
    targetProfileId: string | null;
    showProfileDrum: boolean;
    showProfileHeat: boolean;
    showProfileFan: boolean;
    bbpActive: boolean;
    controlXs: number[];
    drumTemp: (number | null)[];
    heatPower: (number | null)[];
    fanSpeed: (number | null)[];
    heatSet: (number | null)[] | undefined;
    heatTarget: ControlData['heatTarget'];
    referenceXs: number[];
    referenceDrum: (number | null)[];
    referenceHeater: (number | null)[];
    referenceFan: (number | null)[];
};

const profileControlRequested = (input: ControlFrameInput) =>
    input.showTargetCurve &&
    Boolean(input.targetProfileId) &&
    anySeriesOn(input.showProfileDrum, input.showProfileHeat, input.showProfileFan);

const chartControlData = (input: ControlFrameInput): ControlData | undefined => {
    const liveOpen = anySeriesOn(input.showControlDrum, input.showControlHeat, input.showControlFan);
    if (!input.showControlChart || (!liveOpen && !profileControlRequested(input))) return undefined;
    return {
        xs: input.controlXs,
        drumTemp: input.drumTemp,
        heatPower: input.heatPower,
        fanSpeed: input.fanSpeed,
        heatSet: input.heatSet,
        heatTarget: input.bbpActive ? undefined : input.heatTarget,
        reference:
            input.referenceXs.length > 0
                ? {
                      xs: input.referenceXs,
                      drum: input.referenceDrum,
                      heater: input.referenceHeater,
                      fan: input.referenceFan,
                  }
                : undefined,
    };
};

export const buildChartFrame = <TTurningPoint>(input: {
    isFullscreen: boolean;
    bbpActive: boolean;
    bbpNowSec: number;
    bbpRange: { start: number; end: number } | undefined;
    bbpRecording: boolean;
    awaitingNextCharge: boolean;
    showTargetCurve: boolean;
    targetProfileId: string | null;
    targetPointCount: number;
    showTargetDeltaLabel: boolean;
    targetCurvePointCount: number;
    showControlChart: boolean;
    showControlDrum: boolean;
    showControlHeat: boolean;
    showControlFan: boolean;
    showProfileDrum: boolean;
    showProfileHeat: boolean;
    showProfileFan: boolean;
    controlXs: number[];
    drumTemp: (number | null)[];
    heatPower: (number | null)[];
    fanSpeed: (number | null)[];
    heatSet: (number | null)[] | undefined;
    heatTarget: ControlData['heatTarget'];
    referenceXs: number[];
    referenceDrum: (number | null)[];
    referenceHeater: (number | null)[];
    referenceFan: (number | null)[];
    elapsed: number;
    charged: boolean;
    roastEnded: boolean;
    eventMarkers: RoastEventMarker[];
    turningPoints: TTurningPoint[];
    phaseSegments: PhaseSegment[];
    showFcBand: boolean;
    onEventMarkerDrag: (logId: string, newTimeSec: number) => void;
    onEventMarkerEdit: (logId: string, patch: EventMarkerPatch) => void;
    onEventMarkerDelete: (logId: string) => void;
    onAddNote: (body: string, timeSec: number, controls?: RoastNoteControls) => void;
    onAddEvent: (event: string, timeSec: number) => void;
}) => {
    const canEdit = canEditChartMarkers(input.charged, input.roastEnded, input.bbpActive);
    return {
        className: `bg-(--color-roast-bg) flex flex-col min-h-0 overflow-hidden ${
            input.isFullscreen ? FULLSCREEN_CHART_CLASS : WINDOWED_CHART_CLASS
        }`,
        testId: input.bbpActive ? 'bbp-target-status' : undefined,
        bbpElapsed: input.bbpActive ? Math.floor(input.bbpNowSec) : undefined,
        bbpSpan: input.bbpActive ? Math.floor(input.bbpRange?.end ?? 0) : undefined,
        bbpRange: input.bbpRange
            ? {
                  ...input.bbpRange,
                  label: input.bbpRecording || input.awaitingNextCharge ? ('BBP' as const) : ('PREHEAT' as const),
              }
            : undefined,
        showTargetCurve: input.showTargetCurve && !!input.targetProfileId && input.targetPointCount > 0,
        showTargetDeltaLabel:
            !input.bbpActive &&
            input.showTargetDeltaLabel &&
            !!input.targetProfileId &&
            input.targetCurvePointCount > 0,
        controlData: chartControlData(input),
        elapsed: input.bbpActive ? input.bbpNowSec : input.elapsed,
        charged: input.charged && !input.bbpActive,
        eventMarkers: listUnlessBbp(input.bbpActive, input.eventMarkers),
        turningPoints: listUnlessBbp(input.bbpActive, input.turningPoints),
        phaseSegments: listUnlessBbp(input.bbpActive, input.phaseSegments),
        showFcBand: input.showFcBand && !input.bbpActive,
        onEventMarkerDrag: canEdit ? input.onEventMarkerDrag : undefined,
        onEventMarkerEdit: canEdit ? input.onEventMarkerEdit : undefined,
        onEventMarkerDelete: canEdit ? input.onEventMarkerDelete : undefined,
        onAddNote: canEdit ? input.onAddNote : undefined,
        onAddEvent: canEdit ? input.onAddEvent : undefined,
    };
};
