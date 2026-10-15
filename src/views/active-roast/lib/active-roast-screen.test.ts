import { describe, expect, it } from 'vitest';
import {
    autoChargeUnavailable,
    autoDropUnavailable,
    buildChartFrame,
    canCancelDrop,
    chargeWaitTempBand,
    isReplayMachineMismatch,
    replayPointsForProfile,
    showPendingSummary,
} from './active-roast-screen';

const chartInput = {
    isFullscreen: false,
    bbpActive: false,
    bbpNowSec: 12.8,
    bbpRange: { start: 0, end: 40.2 },
    bbpRecording: false,
    awaitingNextCharge: false,
    showTargetCurve: true,
    targetProfileId: 'profile-1',
    targetPointCount: 2,
    showTargetDeltaLabel: true,
    targetCurvePointCount: 2,
    showControlChart: true,
    showControlDrum: false,
    showControlHeat: true,
    showControlFan: false,
    showProfileDrum: false,
    showProfileHeat: false,
    showProfileFan: false,
    controlXs: [0],
    drumTemp: [1],
    heatPower: [2],
    fanSpeed: [3],
    heatSet: [4],
    heatTarget: { xs: [0], values: [80] },
    referenceXs: [] as number[],
    referenceDrum: [] as (number | null)[],
    referenceHeater: [] as (number | null)[],
    referenceFan: [] as (number | null)[],
    elapsed: 90,
    charged: true,
    roastEnded: false,
    eventMarkers: [{ timeSec: 1, event: 'Note', color: '#fff', timeStr: '0:01', temp: '100' }],
    turningPoints: [{ timeSec: 1, temp: 2 }],
    phaseSegments: [],
    showFcBand: true,
    onEventMarkerDrag: () => {},
    onEventMarkerEdit: () => {},
    onEventMarkerDelete: () => {},
    onAddNote: () => {},
    onAddEvent: () => {},
    onMoveEvent: () => {},
};

describe('buildChartFrame', () => {
    it('keeps roast editing and the heat target while BBP is off', () => {
        const frame = buildChartFrame(chartInput);
        expect(frame.elapsed).toBe(90);
        expect(frame.charged).toBe(true);
        expect(frame.showFcBand).toBe(true);
        expect(frame.controlData?.heatTarget).toEqual({ xs: [0], values: [80] });
        expect(frame.onAddNote).toBe(chartInput.onAddNote);
        expect(frame.onAddEvent).toBe(chartInput.onAddEvent);
        expect(frame.bbpRange?.label).toBe('PREHEAT');
    });

    it('keeps marker edits available on a saved-curve review', () => {
        const frame = buildChartFrame({
            ...chartInput,
            charged: false,
            roastEnded: true,
            reviewing: true,
        });
        expect(frame.onEventMarkerEdit).toBe(chartInput.onEventMarkerEdit);
        expect(frame.onAddNote).toBe(chartInput.onAddNote);
        expect(frame.onEventMarkerDelete).toBe(chartInput.onEventMarkerDelete);
        expect(frame.onMoveEvent).toBe(chartInput.onMoveEvent);
    });

    it('hides roast markers and labels a recording wait as BBP', () => {
        const frame = buildChartFrame({
            ...chartInput,
            bbpActive: true,
            bbpRecording: true,
        });
        expect(frame.testId).toBe('bbp-target-status');
        expect(frame.bbpElapsed).toBe(12);
        expect(frame.bbpSpan).toBe(40);
        expect(frame.elapsed).toBe(12.8);
        expect(frame.charged).toBe(false);
        expect(frame.eventMarkers).toEqual([]);
        expect(frame.turningPoints).toEqual([]);
        expect(frame.showFcBand).toBe(false);
        expect(frame.controlData?.heatTarget).toBeUndefined();
        expect(frame.onEventMarkerDrag).toBeUndefined();
        expect(frame.onAddEvent).toBeUndefined();
        expect(frame.bbpRange?.label).toBe('BBP');
    });

    it('omits control data when every control series is hidden', () => {
        const frame = buildChartFrame({
            ...chartInput,
            showControlDrum: false,
            showControlHeat: false,
            showControlFan: false,
        });
        expect(frame.controlData).toBeUndefined();
    });

    it('keeps a stored profile control channel when the live series are hidden', () => {
        const frame = buildChartFrame({
            ...chartInput,
            showControlDrum: false,
            showControlHeat: false,
            showControlFan: false,
            showProfileHeat: true,
            referenceXs: [0, 30],
            referenceHeater: [60, null],
        });
        expect(frame.controlData?.reference).toEqual({
            xs: [0, 30],
            drum: [],
            heater: [60, null],
            fan: [],
        });
        expect(frame.controlData?.heatTarget).toEqual({ xs: [0], values: [80] });
    });
});

describe('active roast screen decisions', () => {
    it('pads the charge-wait temperature band to 10 degrees', () => {
        expect(
            chargeWaitTempBand({
                waiting: true,
                bbpActive: false,
                bbpPoints: [{ bt: 300, et: 300 }],
                livePoints: [{ bt: 23, et: null }],
                targetPoints: [{ bt: 215, et: 180 }],
                tempMinC: 50,
                tempMaxC: 200,
            }),
        ).toEqual({ tempMinC: 20, tempMaxC: 220 });
    });

    it('uses only the configured limits before charge wait', () => {
        expect(
            chargeWaitTempBand({
                waiting: false,
                bbpActive: true,
                bbpPoints: [{ bt: 1, et: 2 }],
                livePoints: [],
                targetPoints: [],
                tempMinC: 23,
                tempMaxC: 210,
            }),
        ).toEqual({ tempMinC: 20, tempMaxC: 210 });
    });

    it('selects replay points from profile load state', () => {
        const points = [{ t: 1 }];
        expect(replayPointsForProfile(null, false, points)).toEqual([]);
        expect(replayPointsForProfile('id', true, points)).toBeNull();
        expect(replayPointsForProfile('id', false, points)).toBe(points);
    });

    it('blocks replay only when both machine keys exist and differ', () => {
        expect(isReplayMachineMismatch(null, 'a')).toBe(false);
        expect(isReplayMachineMismatch('a', 'a')).toBe(false);
        expect(isReplayMachineMismatch('a', 'b')).toBe(true);
    });

    it('allows an old Standard profile only for the same machine migrated to W60', () => {
        expect(isReplayMachineMismatch('giesen_standard', 'giesen_w45a_w60a', 'm1', 'm1')).toBe(false);
        expect(isReplayMachineMismatch('giesen_standard', 'giesen_w45a_w60a', 'm1', 'm2')).toBe(true);
        expect(isReplayMachineMismatch('giesen_standard', 'giesen_w45a_w60a', null, 'm1')).toBe(true);
        expect(isReplayMachineMismatch('giesen_standard', 'giesen_w45a_w60a', 'm1', null)).toBe(true);
        expect(isReplayMachineMismatch('giesen_standard', 'giesen_w45a_w60a', '', '')).toBe(true);
        expect(isReplayMachineMismatch('giesen_standard', 'giesen_w6a_pro', 'm1', 'm1')).toBe(true);
    });

    it('allows Drop cancel only for the restored unsubmitted session', () => {
        const base = {
            hasRestore: true,
            submitted: false,
            charged: true,
            sessionId: 'same',
            restoreSessionId: 'same',
        };
        expect(canCancelDrop(base)).toBe(true);
        expect(canCancelDrop({ ...base, sessionId: 'other' })).toBe(false);
        expect(canCancelDrop({ ...base, submitted: true })).toBe(false);
        expect(canCancelDrop({ ...base, hasRestore: false })).toBe(false);
    });

    it('shows sensor notices only in the matching idle phase', () => {
        expect(autoChargeUnavailable('standby', true, false)).toBe(true);
        expect(autoChargeUnavailable('roasting', true, false)).toBe(false);
        expect(autoDropUnavailable('roasting', true, false)).toBe(true);
        expect(autoDropUnavailable('roasting', true, true)).toBe(false);
        expect(showPendingSummary(false, { totalTime: '1:00' })).toBe(true);
        expect(showPendingSummary(true, { totalTime: '1:00' })).toBe(false);
    });
});
