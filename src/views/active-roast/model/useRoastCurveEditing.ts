import {
    bbpEventsForDisplay,
    bbpEventsFromDisplay,
    bbpStoredTime,
    makeBbpLogEntry,
} from '@features/active-roast/lib/bbp-events';
import { NEAREST_BT_MAX_SEC } from '@features/active-roast/lib/chart-option/markers';
import { isRemovableLogEvent, isToggleableLogEvent, TP_MARKER_ID } from '@features/active-roast/lib/constants';
import {
    applyEventMarkerEdit,
    type EventMarkerPatch,
    type MarkerDragLivePoint,
    nearestLivePointAt,
    upsertReviewTurningPoint,
} from '@features/active-roast/lib/event-marker-drag';
import { dropControlRole, parseControlMarkerLogId } from '@features/active-roast/lib/fan-drum-markers';
import { withoutLogEvent } from '@features/active-roast/lib/fc-dual-mark';
import {
    isReviewDeletableEvent,
    isReviewEditableEvent,
    reviewMarkToAdd,
} from '@features/active-roast/lib/review-record-events';
import { type CompletedRoastSnapshot, selectReviewSnapshot } from '@features/active-roast/model/batch';
import { useBbpStore } from '@features/active-roast/model/bbp';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { isChargedPhase, useRoastingStore } from '@features/active-roast/model/status';
import type { useAutoDetection } from '@features/active-roast/model/useAutoDetection';
import type { useRoastLog } from '@features/active-roast/model/useRoastLog';
import { formatElapsed } from '@shared/lib/format';
import type { RoastNoteControls } from '@shared/types/roast';
import { useCallback } from 'react';
import { appendReviewEntry, type useReviewCurveEdit } from './useReviewCurveEdit';

type EditTarget = { kind: 'review'; snapshot: CompletedRoastSnapshot } | { kind: 'bbp' } | { kind: 'live' };

type Params = {
    unit: TemperatureUnit;
    dropWaitOffset?: number | null;
    log: Pick<ReturnType<typeof useRoastLog>, 'markEvent' | 'setLogEntries' | 'removeLogEntry'>;
    review: Pick<ReturnType<typeof useReviewCurveEdit>, 'applyReviewLog' | 'getReviewLog'>;
    turningPoint: Pick<ReturnType<typeof useAutoDetection>, 'confirmedTP' | 'turningPoints' | 'moveTurningPoint'>;
    bbp: { active: boolean; nowSec: number; origin: number; points: MarkerDragLivePoint[] };
    recordDropWaitEvent: (
        event: string,
        note: string,
        controls?: RoastNoteControls,
        historical?: { timeSec: number; tempC: number | null },
    ) => boolean;
};

const temperatureAt = (points: readonly MarkerDragLivePoint[], timeSec: number): number | null => {
    const nearest = nearestLivePointAt(points, timeSec);
    return nearest && Math.abs(nearest.time - timeSec) <= NEAREST_BT_MAX_SEC ? nearest.bt : null;
};

export const useRoastCurveEditing = ({
    unit,
    log,
    review,
    turningPoint,
    bbp,
    recordDropWaitEvent,
    dropWaitOffset = null,
}: Params) => {
    const livePoints = useRoastingStore((state) => state.livePoints);
    const elapsed = useRoastingStore((state) => state.elapsed);
    const phase = useRoastingStore((state) => state.phase);
    const rawBT = useRoastingStore((state) => state.liveData?.bt ?? null);
    const snapshot = useRoastingStore(selectReviewSnapshot);
    const { markEvent, setLogEntries, removeLogEntry } = log;
    const { applyReviewLog, getReviewLog } = review;
    const { confirmedTP, turningPoints, moveTurningPoint } = turningPoint;
    const { active: bbpActive, nowSec: bbpNowSec, origin, points: bbpPoints } = bbp;

    const readTarget = useCallback((): EditTarget => {
        const current = selectReviewSnapshot(useRoastingStore.getState());
        if (current) return { kind: 'review', snapshot: current };
        return bbpActive ? { kind: 'bbp' } : { kind: 'live' };
    }, [bbpActive]);

    const editMarker = useCallback(
        (logId: string, patch: EventMarkerPatch) => {
            const target = readTarget();
            if (target.kind === 'review') {
                const frozen = target.snapshot;
                if (logId === TP_MARKER_ID) {
                    if (patch.timeSec != null) {
                        applyReviewLog(
                            upsertReviewTurningPoint(
                                getReviewLog(),
                                patch.timeSec,
                                frozen.livePoints,
                                unit,
                                frozen.elapsed,
                            ),
                        );
                    }
                    return;
                }
                const rowId = parseControlMarkerLogId(logId)?.id ?? logId;
                const entry = getReviewLog().find((row) => row.id === rowId);
                if (!entry || !isReviewEditableEvent(entry.event)) return;
                applyReviewLog(
                    applyEventMarkerEdit(getReviewLog(), logId, patch, frozen.livePoints, unit, frozen.elapsed),
                );
                return;
            }
            if (logId === TP_MARKER_ID) {
                if (patch.timeSec == null) return;
                const nearest = nearestLivePointAt(livePoints, patch.timeSec);
                const temp =
                    nearest?.bt ?? confirmedTP?.temp ?? (turningPoints.length > 0 ? turningPoints[0].temp : null);
                if (temp != null && Number.isFinite(temp)) moveTurningPoint(patch.timeSec, temp);
                return;
            }
            if (target.kind === 'bbp') {
                const display = bbpEventsForDisplay(useBbpStore.getState().events, origin);
                const next = applyEventMarkerEdit(
                    display,
                    logId,
                    patch,
                    bbpPoints,
                    unit,
                    Math.max(0, bbpNowSec - origin),
                );
                useBbpStore
                    .getState()
                    .setEvents((prev) => [
                        ...prev.filter((entry) => entry.timeSec != null && entry.timeSec < origin),
                        ...bbpEventsFromDisplay(next, origin),
                    ]);
                return;
            }
            if (dropWaitOffset != null) {
                setLogEntries((prev) => [
                    ...prev.filter((entry) => entry.timeSec == null || entry.timeSec < dropWaitOffset),
                    ...applyEventMarkerEdit(
                        bbpEventsForDisplay(prev, dropWaitOffset),
                        logId,
                        patch,
                        livePoints,
                        unit,
                        livePoints[livePoints.length - 1]?.time ?? 0,
                    ).map((entry) => {
                        const timeSec = (entry.timeSec ?? 0) + dropWaitOffset;
                        return { ...entry, timeSec, time: formatElapsed(timeSec) };
                    }),
                ]);
                return;
            }
            setLogEntries((prev) => applyEventMarkerEdit(prev, logId, patch, livePoints, unit, elapsed));
        },
        [
            readTarget,
            applyReviewLog,
            getReviewLog,
            unit,
            livePoints,
            confirmedTP,
            turningPoints,
            moveTurningPoint,
            origin,
            bbpPoints,
            bbpNowSec,
            setLogEntries,
            elapsed,
            dropWaitOffset,
        ],
    );
    const dragMarker = useCallback((logId: string, timeSec: number) => editMarker(logId, { timeSec }), [editMarker]);

    const addNote = useCallback(
        (body: string, timeSec: number, controls?: RoastNoteControls) => {
            const target = readTarget();
            if (target.kind === 'review') {
                applyReviewLog(
                    appendReviewEntry(
                        getReviewLog(),
                        'Note',
                        body,
                        timeSec,
                        temperatureAt(target.snapshot.livePoints, timeSec),
                        unit,
                        controls,
                    ),
                );
                return;
            }
            if (target.kind === 'bbp') {
                const entry = makeBbpLogEntry(
                    'Note',
                    body,
                    bbpStoredTime(timeSec, origin),
                    temperatureAt(bbpPoints, timeSec),
                    unit,
                    controls,
                );
                if (entry) useBbpStore.getState().setEvents((prev) => [...prev, entry]);
                return;
            }
            const historical = { timeSec, tempC: temperatureAt(livePoints, timeSec) };
            if (!recordDropWaitEvent('Note', body, controls, historical)) {
                markEvent('Note', body, undefined, historical, controls);
            }
        },
        [readTarget, applyReviewLog, getReviewLog, unit, origin, bbpPoints, livePoints, recordDropWaitEvent, markEvent],
    );

    const addNoteNow = useCallback(
        (body: string) => {
            const target = readTarget();
            if (target.kind === 'review') {
                const timeSec = Math.max(0, target.snapshot.elapsed);
                applyReviewLog(
                    appendReviewEntry(
                        getReviewLog(),
                        'Note',
                        body,
                        timeSec,
                        temperatureAt(target.snapshot.livePoints, timeSec),
                        unit,
                    ),
                );
                return;
            }
            if (target.kind === 'bbp') {
                const nearest = nearestLivePointAt(bbpPoints, Math.max(0, bbpNowSec - origin));
                const entry = makeBbpLogEntry('Note', body, bbpNowSec, nearest?.bt ?? rawBT, unit);
                if (entry) useBbpStore.getState().setEvents((prev) => [...prev, entry]);
                return;
            }
            if (!recordDropWaitEvent('Note', body)) markEvent('Note', body);
        },
        [
            readTarget,
            applyReviewLog,
            getReviewLog,
            unit,
            bbpPoints,
            bbpNowSec,
            origin,
            rawBT,
            recordDropWaitEvent,
            markEvent,
        ],
    );

    const addEvent = useCallback(
        (event: string, timeSec: number, enteredTempC?: number) => {
            const target = readTarget();
            if (target.kind === 'review') {
                if (!reviewMarkToAdd(getReviewLog(), event, false)) return;
                const tempC = enteredTempC ?? temperatureAt(target.snapshot.livePoints, timeSec);
                applyReviewLog(appendReviewEntry(getReviewLog(), event, '', timeSec, tempC, unit));
                return;
            }
            if (!isChargedPhase(phase) || phase === 'ended' || target.kind === 'bbp') return;
            markEvent(event, '', undefined, { timeSec, tempC: temperatureAt(livePoints, timeSec) });
        },
        [readTarget, getReviewLog, applyReviewLog, unit, phase, markEvent, livePoints],
    );

    const moveEvent = useCallback(
        (event: string, timeSec: number) => {
            const target = readTarget();
            if (target.kind !== 'review' || !isReviewEditableEvent(event)) return;
            const entry = getReviewLog().find((row) => row.event === event && row.id);
            if (!entry?.id) return;
            applyReviewLog(
                applyEventMarkerEdit(
                    getReviewLog(),
                    entry.id,
                    { timeSec },
                    target.snapshot.livePoints,
                    unit,
                    target.snapshot.elapsed,
                ),
            );
        },
        [readTarget, getReviewLog, applyReviewLog, unit],
    );

    const removeEntry = useCallback(
        (id: string) => {
            const target = readTarget();
            if (target.kind === 'bbp') {
                useBbpStore.getState().setEvents((prev) => {
                    if (parseControlMarkerLogId(id)) return dropControlRole(prev, id) ?? prev;
                    const entry = prev.find((row) => row.id === id);
                    if (!entry || !isRemovableLogEvent(entry.event)) return prev;
                    return prev.filter((row) => row.id !== id);
                });
                return;
            }
            if (parseControlMarkerLogId(id)) {
                const entries =
                    target.kind === 'review' ? getReviewLog() : useRoastingStore.getState().logState.entries;
                const next = dropControlRole(entries, id);
                if (!next) return;
                if (target.kind === 'review') applyReviewLog(next);
                else setLogEntries(next);
                return;
            }
            if (target.kind === 'review') {
                const entry = getReviewLog().find((row) => row.id === id);
                if (!entry || !isReviewDeletableEvent(entry.event)) return;
                applyReviewLog(
                    isToggleableLogEvent(entry.event)
                        ? withoutLogEvent(getReviewLog(), entry.event)
                        : getReviewLog().filter((row) => row.id !== id),
                );
                return;
            }
            removeLogEntry(id);
        },
        [readTarget, getReviewLog, applyReviewLog, setLogEntries, removeLogEntry],
    );

    const canEdit =
        snapshot != null || (phase !== 'ended' && (bbpActive || dropWaitOffset != null || isChargedPhase(phase)));
    return {
        chartHandlers: {
            onEventMarkerDrag: canEdit ? dragMarker : undefined,
            onEventMarkerEdit: canEdit ? editMarker : undefined,
            onEventMarkerDelete: canEdit ? removeEntry : undefined,
            onAddNote: canEdit ? addNote : undefined,
            onAddEvent: canEdit && (snapshot != null || !bbpActive) ? addEvent : undefined,
            onMoveEvent: snapshot ? moveEvent : undefined,
        },
        logEditOptions: canEdit
            ? {
                  unit,
                  livePoints: snapshot?.livePoints ?? (bbpActive ? bbpPoints : livePoints),
                  maxTimeSec:
                      snapshot?.elapsed ??
                      (bbpActive
                          ? Math.max(0, bbpNowSec - origin)
                          : dropWaitOffset != null
                            ? (livePoints[livePoints.length - 1]?.time ?? 0)
                            : elapsed),
                  onEditEntry: editMarker,
              }
            : undefined,
        addEvent,
        removeEntry,
        addNoteNow,
    };
};
