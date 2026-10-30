import { makeBbpLogEntry } from '@features/active-roast/lib/bbp-events';
import { isRemovableLogEvent, isToggleableLogEvent, TP_MARKER_ID } from '@features/active-roast/lib/constants';
import {
    type EventMarkerPatch,
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
import { useBbpStore } from '@features/active-roast/model/bbp';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { isChargedPhase, useRoastingStore } from '@features/active-roast/model/status';
import type { useAutoDetection } from '@features/active-roast/model/useAutoDetection';
import type { useRoastLog } from '@features/active-roast/model/useRoastLog';
import type { RoastNoteControls } from '@shared/types/roast';
import { useCallback } from 'react';
import type { DisplayedRoastTimeline } from './useDisplayedRoastTimeline';
import { appendReviewEntry, type useReviewCurveEdit } from './useReviewCurveEdit';

type Params = {
    unit: TemperatureUnit;
    timeline: DisplayedRoastTimeline['editing'];
    log: Pick<ReturnType<typeof useRoastLog>, 'markEvent' | 'setLogEntries' | 'removeLogEntry'>;
    review: Pick<ReturnType<typeof useReviewCurveEdit>, 'applyReviewLog' | 'getReviewLog'>;
    turningPoint: Pick<ReturnType<typeof useAutoDetection>, 'confirmedTP' | 'turningPoints' | 'moveTurningPoint'>;
    recordDropWaitEvent: (
        event: string,
        note: string,
        controls?: RoastNoteControls,
        historical?: { timeSec: number; tempC: number | null },
    ) => boolean;
};

export const useRoastCurveEditing = ({ unit, timeline, log, review, turningPoint, recordDropWaitEvent }: Params) => {
    const { markEvent, setLogEntries, removeLogEntry } = log;
    const { applyReviewLog, getReviewLog } = review;
    const { confirmedTP, turningPoints, moveTurningPoint } = turningPoint;
    const readTarget = timeline.read;
    const current = timeline.current;
    const phase = useRoastingStore((state) => state.phase);

    const editMarker = useCallback(
        (logId: string, patch: EventMarkerPatch) => {
            const target = readTarget();
            if (target.kind === 'review') {
                if (logId === TP_MARKER_ID) {
                    if (patch.timeSec != null)
                        applyReviewLog(
                            upsertReviewTurningPoint(
                                getReviewLog(),
                                patch.timeSec,
                                target.points,
                                unit,
                                target.maxTimeSec,
                            ),
                        );
                    return;
                }
                const rowId = parseControlMarkerLogId(logId)?.id ?? logId;
                const entry = getReviewLog().find((row) => row.id === rowId);
                if (!entry || !isReviewEditableEvent(entry.event)) return;
                applyReviewLog(target.editEntries(getReviewLog(), logId, patch));
                return;
            }
            if (logId === TP_MARKER_ID) {
                if (patch.timeSec == null) return;
                const nearest = nearestLivePointAt(target.points, patch.timeSec);
                const temp =
                    nearest?.bt ?? confirmedTP?.temp ?? (turningPoints.length > 0 ? turningPoints[0].temp : null);
                if (temp != null && Number.isFinite(temp)) moveTurningPoint(patch.timeSec, temp);
                return;
            }
            if (target.kind === 'bbp') {
                useBbpStore.getState().setEvents((prev) => target.editEntries(prev, logId, patch));
                return;
            }
            setLogEntries((prev) => target.editEntries(prev, logId, patch));
        },
        [readTarget, applyReviewLog, getReviewLog, unit, confirmedTP, turningPoints, moveTurningPoint, setLogEntries],
    );
    const dragMarker = useCallback((logId: string, timeSec: number) => editMarker(logId, { timeSec }), [editMarker]);

    const addNote = useCallback(
        (body: string, timeSec: number, controls?: RoastNoteControls) => {
            const target = readTarget();
            const location = target.noteAt(timeSec);
            if (target.kind === 'review') {
                applyReviewLog(
                    appendReviewEntry(getReviewLog(), 'Note', body, location.timeSec, location.tempC, unit, controls),
                );
                return;
            }
            if (target.kind === 'bbp') {
                const entry = makeBbpLogEntry('Note', body, location.timeSec, location.tempC, unit, controls);
                if (entry) useBbpStore.getState().setEvents((prev) => [...prev, entry]);
                return;
            }
            if (!recordDropWaitEvent('Note', body, controls, location))
                markEvent('Note', body, undefined, location, controls);
        },
        [readTarget, applyReviewLog, getReviewLog, unit, recordDropWaitEvent, markEvent],
    );

    const addNoteNow = useCallback(
        (body: string) => {
            const target = readTarget();
            if (target.kind === 'review') {
                const location = target.noteNow();
                applyReviewLog(appendReviewEntry(getReviewLog(), 'Note', body, location.timeSec, location.tempC, unit));
                return;
            }
            if (target.kind === 'bbp') {
                const location = target.noteNow();
                const entry = makeBbpLogEntry('Note', body, location.timeSec, location.tempC, unit);
                if (entry) useBbpStore.getState().setEvents((prev) => [...prev, entry]);
                return;
            }
            if (!recordDropWaitEvent('Note', body)) markEvent('Note', body);
        },
        [readTarget, applyReviewLog, getReviewLog, unit, recordDropWaitEvent, markEvent],
    );

    const addEvent = useCallback(
        (event: string, timeSec: number, enteredTempC?: number) => {
            const target = readTarget();
            if (target.kind === 'review') {
                if (!reviewMarkToAdd(getReviewLog(), event, false)) return;
                const location = target.noteAt(timeSec);
                applyReviewLog(
                    appendReviewEntry(getReviewLog(), event, '', timeSec, enteredTempC ?? location.tempC, unit),
                );
                return;
            }
            if (target.kind !== 'live' || !isChargedPhase(target.phase) || target.phase === 'ended') return;
            markEvent(event, '', undefined, target.noteAt(timeSec));
        },
        [readTarget, getReviewLog, applyReviewLog, unit, markEvent],
    );

    const moveEvent = useCallback(
        (event: string, timeSec: number) => {
            const target = readTarget();
            if (target.kind !== 'review' || !isReviewEditableEvent(event)) return;
            const entry = getReviewLog().find((row) => row.event === event && row.id);
            if (!entry?.id) return;
            applyReviewLog(target.editEntries(getReviewLog(), entry.id, { timeSec }));
        },
        [readTarget, getReviewLog, applyReviewLog],
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
        current.kind === 'review' ||
        (phase !== 'ended' && (current.kind === 'bbp' || current.waiting || isChargedPhase(phase)));
    return {
        chartHandlers: {
            onEventMarkerDrag: canEdit ? dragMarker : undefined,
            onEventMarkerEdit: canEdit ? editMarker : undefined,
            onEventMarkerDelete: canEdit ? removeEntry : undefined,
            onAddNote: canEdit ? addNote : undefined,
            onAddEvent: canEdit && current.kind !== 'bbp' ? addEvent : undefined,
            onMoveEvent: current.kind === 'review' ? moveEvent : undefined,
        },
        logEditOptions: canEdit
            ? {
                  unit,
                  livePoints: current.points,
                  maxTimeSec: current.maxTimeSec,
                  onEditEntry: editMarker,
              }
            : undefined,
        addEvent,
        removeEntry,
        addNoteNow,
    };
};
