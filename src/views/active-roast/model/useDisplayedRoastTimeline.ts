import { splitBatchBbp } from '@features/active-roast/lib/batch-timeline';
import { storedEventsToLogEntries } from '@features/active-roast/lib/serialize-roast-events';
import { selectReviewSnapshot } from '@features/active-roast/model/batch';
import { useBbpStore } from '@features/active-roast/model/bbp';
import type { RoastSettings } from '@features/active-roast/model/roast-settings';
import { chartSpanSec } from '@features/active-roast/model/settings';
import { isChargedPhase, type RoastingState, useRoastingStore } from '@features/active-roast/model/status';
import type { TsvPoint } from '@shared/lib/tsv';
import type { LogEntry } from '@shared/types/roast';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { chargeWaitTempBand } from '../lib/active-roast-screen';
import { resolveLiveChartView } from '../lib/live-chart-view';
import { createTimelineEditing, dropWaitOffsetFor, type TimelineRoastState } from '../lib/timeline-editing';
import { useChartPipeline } from './useChartPipeline';

type Settings = Pick<
    RoastSettings,
    | 'temperatureUnit'
    | 'bbpJoinCharge'
    | 'showRoRChart'
    | 'showControlChart'
    | 'tempMinC'
    | 'tempMaxC'
    | 'timeRangeCustom'
    | 'timeRangeMin'
    | 'timeRangePresetMin'
>;
type Params = {
    bbpEnabled: boolean;
    settings: Settings;
    reference: { roast: TsvPoint[]; bbp: TsvPoint[]; bbpError: boolean };
    reviewEntries: LogEntry[] | null;
};

const selectRoast = (state: RoastingState): TimelineRoastState => ({
    phase: state.phase,
    elapsed: state.elapsed,
    livePoints: state.livePoints,
    sessionId: state.sessionId,
    bbpCapture: state.bbpCapture,
    snapshot: selectReviewSnapshot(state),
    restore: state.completed?.restore,
    entries: state.logState.entries,
    rawBT: state.liveData?.bt ?? null,
});
const selectBbp = (state: ReturnType<typeof useBbpStore.getState>) => ({
    active: state.active,
    points: state.points,
    events: state.events,
    startMs: state.startMs,
});
type Bbp = ReturnType<typeof selectBbp>;

const projectView = (
    roast: Pick<TimelineRoastState, 'phase' | 'livePoints' | 'bbpCapture' | 'snapshot'>,
    bbp: Pick<Bbp, 'active' | 'points'>,
    {
        bbpEnabled,
        settings,
        reference,
    }: Pick<Params, 'bbpEnabled' | 'reference'> & { settings: Pick<Settings, 'bbpJoinCharge'> },
) =>
    resolveLiveChartView({
        bbpActive: roast.snapshot ? false : bbpEnabled && bbp.active,
        charged: isChargedPhase(roast.phase),
        livePoints: roast.snapshot?.livePoints ?? roast.livePoints,
        bbpPoints: bbp.points,
        roastTarget: reference.roast,
        bbpTarget: reference.bbp,
        bbpTargetError: reference.bbpError,
        bbpCapture: bbpEnabled ? (roast.snapshot?.bbpCapture ?? roast.bbpCapture) : null,
        joinBbp: settings.bbpJoinCharge,
    });

const editingFor = (roast: TimelineRoastState, bbp: Bbp, view: ReturnType<typeof projectView>, settings: Settings) => {
    if (roast.snapshot)
        return createTimelineEditing(
            { kind: 'review', snapshot: roast.snapshot },
            settings.temperatureUnit,
            roast.rawBT,
        );
    if (bbp.active)
        return createTimelineEditing(
            {
                kind: 'bbp',
                points: view.livePoints,
                nowSec: bbp.points[bbp.points.length - 1]?.t ?? 0,
                origin: view.eventTimeOrigin,
            },
            settings.temperatureUnit,
            roast.rawBT,
        );
    return createTimelineEditing(
        {
            kind: 'live',
            phase: roast.phase,
            points: roast.livePoints,
            elapsed: roast.elapsed,
            waitOffset: dropWaitOffsetFor(roast),
        },
        settings.temperatureUnit,
        roast.rawBT,
    );
};

export const useDisplayedRoastTimeline = (params: Params) => {
    const { bbpEnabled, settings, reference, reviewEntries } = params;
    const roast = useRoastingStore(useShallow(selectRoast));
    const bbp = useBbpStore(useShallow(selectBbp));
    const snapshot = roast.snapshot;
    const charged = isChargedPhase(roast.phase);
    const unit = settings.temperatureUnit;
    const curvePoints = snapshot?.livePoints ?? roast.livePoints;
    const curveEntries = snapshot ? (reviewEntries ?? snapshot.logEntries) : roast.entries;
    const { phase, livePoints, bbpCapture } = roast;
    const view = useMemo(
        () =>
            projectView(
                { phase, livePoints, bbpCapture, snapshot },
                { active: bbp.active, points: bbp.points },
                {
                    bbpEnabled,
                    settings: { bbpJoinCharge: settings.bbpJoinCharge },
                    reference: {
                        roast: reference.roast,
                        bbp: reference.bbp,
                        bbpError: reference.bbpError,
                    },
                },
            ),
        [
            phase,
            livePoints,
            bbpCapture,
            snapshot,
            bbp.active,
            bbp.points,
            bbpEnabled,
            settings.bbpJoinCharge,
            reference.roast,
            reference.bbp,
            reference.bbpError,
        ],
    );
    const currentEditing = useMemo(() => editingFor(roast, bbp, view, settings), [roast, bbp, view, settings]);
    const entries = useMemo(() => {
        if (
            !snapshot &&
            (currentEditing.kind === 'bbp' || (currentEditing.kind === 'live' && currentEditing.waiting))
        ) {
            return currentEditing.displayEntries(currentEditing.kind === 'bbp' ? bbp.events : curveEntries);
        }
        const capture = snapshot?.bbpCapture ?? roast.bbpCapture;
        const before =
            capture && bbpEnabled && settings.bbpJoinCharge ? (splitBatchBbp(capture).bbp?.events ?? []) : [];
        return [...storedEventsToLogEntries(before, unit, true), ...curveEntries];
    }, [
        snapshot,
        currentEditing,
        bbp.events,
        curveEntries,
        roast.bbpCapture,
        bbpEnabled,
        settings.bbpJoinCharge,
        unit,
    ]);
    const capture = bbpEnabled && settings.bbpJoinCharge ? (snapshot?.bbpCapture ?? roast.bbpCapture) : null;
    const identity = snapshot
        ? `review:${snapshot.sessionId}`
        : capture
          ? `wait:${capture.startMs}`
          : bbp.active
            ? `wait:${bbp.startMs}`
            : `roast:${roast.sessionId ?? 'pre'}`;
    const timelineKey = `${identity}:${chartSpanSec(settings)}${charged && !settings.bbpJoinCharge ? ':charge' : ''}`;
    const chart = useChartPipeline({
        livePoints: view.livePoints,
        targetCurvePoints: view.targetPoints,
        timelineKey,
        coordinateOrigin: view.axisOrigin,
        xMin: view.xMin,
        xMaxFloor: view.xMaxFloor ?? chartSpanSec(settings),
        showRoR: settings.showRoRChart,
        showControlChart: settings.showControlChart,
        unit,
    });
    const { setHoveredChartIndex } = chart;
    useEffect(() => {
        if (timelineKey) setHoveredChartIndex(null);
    }, [timelineKey, setHoveredChartIndex]);

    const latest = useRef(params);
    useLayoutEffect(() => {
        latest.current = params;
    });
    const readEditing = useCallback(() => {
        const currentRoast = selectRoast(useRoastingStore.getState());
        const currentBbp = selectBbp(useBbpStore.getState());
        return editingFor(
            currentRoast,
            currentBbp,
            projectView(currentRoast, currentBbp, latest.current),
            latest.current.settings,
        );
    }, []);
    const editing = useMemo(() => ({ current: currentEditing, read: readEditing }), [currentEditing, readEditing]);
    const bbpObservationNow = useCallback(() => {
        const currentRoast = selectRoast(useRoastingStore.getState());
        const currentBbp = selectBbp(useBbpStore.getState());
        const currentView = projectView(currentRoast, currentBbp, latest.current);
        return createTimelineEditing(
            {
                kind: 'bbp',
                points: currentView.livePoints,
                nowSec: currentBbp.points[currentBbp.points.length - 1]?.t ?? 0,
                origin: currentView.eventTimeOrigin,
            },
            latest.current.settings.temperatureUnit,
            currentRoast.rawBT,
        ).noteNow();
    }, []);
    const bbpNowSec = bbp.points[bbp.points.length - 1]?.t ?? 0;
    return {
        chart,
        entries,
        editing,
        bbpObservationNow,
        temperatureBand: chargeWaitTempBand({
            waiting: bbp.active || !charged,
            bbpActive: snapshot ? false : bbp.active,
            bbpPoints: bbp.points,
            livePoints: curvePoints,
            targetPoints: view.targetPoints,
            tempMinC: settings.tempMinC,
            tempMaxC: settings.tempMaxC,
        }),
        frame: {
            bbpNowSec,
            bbpRange: view.bbpRange,
            bbpRecorded: capture?.recording,
            targetPointCount: view.targetPoints.length,
            displayedElapsed:
                bbp.active && !snapshot
                    ? Math.max(0, bbpNowSec - view.eventTimeOrigin)
                    : (snapshot?.elapsed ?? roast.elapsed),
        },
    };
};

export type DisplayedRoastTimeline = ReturnType<typeof useDisplayedRoastTimeline>;
