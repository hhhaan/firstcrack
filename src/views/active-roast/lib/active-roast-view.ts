import type { PhaseSegment, RoastEventMarker, RoastPhase, RoastSettings, TurningPoint } from '@features/active-roast';

/** Pure view decisions for the live roast screen. Hooks and effects stay on the component. */

export const orNull = <T>(value: T | null | undefined): T | null => value ?? null;

export const orEmpty = (value: string | null | undefined): string => value ?? '';

export const orZero = (value: number | null | undefined): number => value ?? 0;

export const bbpRuntime = (input: {
    featureOn: boolean;
    settingOn: boolean;
    elapsed: string | null;
    active: boolean;
    recording: boolean;
    awaitingNextCharge: boolean;
}) => {
    const enabled = input.featureOn && input.settingOn;
    return {
        enabled,
        timer: enabled ? input.elapsed : null,
        chargeWait: (input.active && input.recording) || input.awaitingNextCharge,
    };
};

export const chargedPhase = (phase: RoastPhase): boolean => phase === 'roasting' || phase === 'ended';

export const selectionEpoch = (ownerId: string | null | undefined, sessionId: string | null | undefined): string =>
    `${ownerId ?? ''}:${sessionId ?? 'pre'}`;

export const chargeTempC = (entries: readonly { event: string; tempC?: number | null }[]): number | null =>
    entries.find((entry) => entry.event === 'Charge')?.tempC ?? null;

export const replayPointsOf = <T>(profileId: string | null, curveLoading: boolean, points: T[]): T[] | null =>
    !profileId ? [] : curveLoading ? null : points;

export const waitingForChargeOf = (bbpActive: boolean, charged: boolean): boolean => bbpActive || !charged;

export const machineKeyMismatch = (referenceKey: string | null, currentKey: string | null): boolean =>
    referenceKey != null && currentKey != null && referenceKey !== currentKey;

export const lastSampleSec = (points: readonly { t: number }[]): number =>
    points.length > 0 ? points[points.length - 1].t : 0;

export const waitBandTemps = (
    waiting: boolean,
    bbpActive: boolean,
    bbpPoints: readonly { bt: number | null; et: number | null }[],
    livePoints: readonly { bt: number | null; et: number | null }[],
    targetPoints: readonly { bt: number | null; et: number | null }[],
): number[] =>
    waiting
        ? [
              ...(bbpActive ? bbpPoints : livePoints).flatMap((point) => [point.bt, point.et]),
              ...targetPoints.flatMap((point) => [point.bt, point.et]),
          ].filter((value): value is number => value != null)
        : [];

export const dropCanCancel = (
    completedRestore: { sessionId?: string | null } | null,
    completedSubmitted: boolean,
    charged: boolean,
    sessionId: string | null,
): boolean =>
    Boolean(completedRestore) &&
    !completedSubmitted &&
    !(charged && sessionId != null && sessionId !== completedRestore?.sessionId);

export const fcShortcut = <T>(enabled: boolean, cycle: T): T | undefined => (enabled ? cycle : undefined);

export const roastHeatHeld = (
    heatHoldAfterDrop: boolean,
    roastEnded: boolean,
    entries: readonly { event: string }[],
): boolean => heatHoldAfterDrop || roastEnded || entries.some((entry) => entry.event === 'Drop');

export const summaryFields = <T>(
    data: {
        selectedBeanId?: string | null;
        planBatchHandoff?: T | null;
        handoffBeanName?: string | null;
    } | null,
) => ({
    selectedBeanId: data?.selectedBeanId ?? null,
    planBatchHandoff: data?.planBatchHandoff ?? null,
    fallbackBeanName: data?.handoffBeanName ?? null,
});

const controlBandOpen = (settings: RoastSettings, hasTargetProfile: boolean): boolean =>
    settings.showControlChart &&
    (settings.showControlDrum ||
        settings.showControlHeat ||
        settings.showControlFan ||
        (settings.showTargetCurve &&
            hasTargetProfile &&
            (settings.showProfileDrum || settings.showProfileHeat || settings.showProfileFan)));

const markerEditsOpen = (charged: boolean, roastEnded: boolean, bbpActive: boolean): boolean =>
    charged && !roastEnded && !bbpActive;

type ControlSeries = {
    visibleControlXs: number[];
    visibleDrumTemp: (number | null)[];
    visibleHeatPower: (number | null)[];
    visibleFanSpeed: (number | null)[];
    visibleHeatSet: (number | null)[];
    visibleTargetXs: number[];
    visibleTargetDrum: (number | null)[];
    visibleTargetHeater: (number | null)[];
    visibleTargetFan: (number | null)[];
};

export const stageChrome = (input: {
    isFullscreen: boolean;
    bbpActive: boolean;
    bbpNowSec: number;
    bbpEndSec: number | undefined;
    summaryOpen: boolean;
    summaryData: { totalTime: string } | null;
    phase: RoastPhase;
    autoChargeEnabled: boolean;
    autoDropEnabled: boolean;
    hasRawTemperature: boolean;
}) => ({
    chartClass: input.isFullscreen
        ? 'fixed inset-0 z-9999 h-screen w-screen py-[30px] pl-2.5 pr-2.5'
        : 'rounded relative z-1 pl-2.5 pr-2.5 py-[30px] flex-1 dark:border dark:border-[#585d61]',
    bbpTestId: input.bbpActive ? 'bbp-target-status' : undefined,
    bbpElapsed: input.bbpActive ? Math.floor(input.bbpNowSec) : undefined,
    bbpSpan: input.bbpActive ? Math.floor(input.bbpEndSec ?? 0) : undefined,
    unsavedTime: !input.summaryOpen && input.summaryData ? input.summaryData.totalTime : null,
    showAutoCharge: input.phase === 'standby' && input.autoChargeEnabled && !input.hasRawTemperature,
    showAutoDrop: input.phase === 'roasting' && input.autoDropEnabled && !input.hasRawTemperature,
});

export const liveChartFields = (input: {
    settings: RoastSettings;
    targetProfileId: string | null;
    targetPointCount: number;
    targetCurveCount: number;
    bbpActive: boolean;
    bbpRecording: boolean;
    awaitingNextCharge: boolean;
    bbpRange: { start: number; end: number } | undefined;
    bbpNowSec: number;
    elapsed: number;
    charged: boolean;
    roastEnded: boolean;
    chart: ControlSeries;
    heatTarget: { xs: number[]; values: number[] } | undefined;
    eventMarkers: RoastEventMarker[];
    turningPoints: TurningPoint[];
    phaseSegments: PhaseSegment[];
    onEventMarkerDrag: (logId: string, newTimeSec: number) => void;
    onEventMarkerEdit: (logId: string, patch: { timeSec?: number; note?: string }) => void;
    onEventMarkerDelete: (logId: string) => void;
    onAddNote: (body: string, timeSec: number) => void;
}) => {
    const hasProfile = Boolean(input.targetProfileId);
    const editsOpen = markerEditsOpen(input.charged, input.roastEnded, input.bbpActive);
    return {
        bbpRange: input.bbpRange && {
            ...input.bbpRange,
            label: input.bbpRecording || input.awaitingNextCharge ? 'BBP' : 'PREHEAT',
        },
        showTargetCurve: input.settings.showTargetCurve && hasProfile && input.targetPointCount > 0,
        showTargetDeltaLabel:
            !input.bbpActive && input.settings.showTargetDeltaLabel && hasProfile && input.targetCurveCount > 0,
        controlData: controlBandOpen(input.settings, hasProfile)
            ? {
                  xs: input.chart.visibleControlXs,
                  drumTemp: input.chart.visibleDrumTemp,
                  heatPower: input.chart.visibleHeatPower,
                  fanSpeed: input.chart.visibleFanSpeed,
                  heatSet: input.chart.visibleHeatSet,
                  heatTarget: input.bbpActive ? undefined : input.heatTarget,
                  reference: input.chart.visibleTargetXs.length
                      ? {
                            xs: input.chart.visibleTargetXs,
                            drum: input.chart.visibleTargetDrum,
                            heater: input.chart.visibleTargetHeater,
                            fan: input.chart.visibleTargetFan,
                        }
                      : undefined,
              }
            : undefined,
        elapsed: input.bbpActive ? input.bbpNowSec : input.elapsed,
        charged: input.charged && !input.bbpActive,
        eventMarkers: input.bbpActive ? [] : input.eventMarkers,
        turningPoints: input.bbpActive ? [] : input.turningPoints,
        phaseSegments: input.bbpActive ? [] : input.phaseSegments,
        showFcBand: input.settings.showFcBand && !input.bbpActive,
        onEventMarkerDrag: editsOpen ? input.onEventMarkerDrag : undefined,
        onEventMarkerEdit: editsOpen ? input.onEventMarkerEdit : undefined,
        onEventMarkerDelete: editsOpen ? input.onEventMarkerDelete : undefined,
        onAddNote: editsOpen ? input.onAddNote : undefined,
    };
};
