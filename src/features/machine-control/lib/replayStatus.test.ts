import { describe, expect, it } from 'vitest';
import {
    collapsedReplayTone,
    isGiesenRoasterKey,
    type ReplayDisableInput,
    resolveReplayDisableReason,
} from './replayStatus';

const ready: ReplayDisableInput = {
    active: false,
    machineMismatch: false,
    hasPlan: true,
    curveError: false,
    sidecarConnected: true,
    heaterWritable: true,
    pidEngaged: false,
    heaterUnacknowledged: false,
};

describe('resolveReplayDisableReason', () => {
    it('mismatch / 기록없음 / 쓰기불가 / 끊김 / PID / unack 를 접지 않는다', () => {
        expect(resolveReplayDisableReason({ ...ready, machineMismatch: true })).toBe('mismatch');
        expect(resolveReplayDisableReason({ ...ready, hasPlan: false })).toBe('noHeater');
        expect(resolveReplayDisableReason({ ...ready, hasPlan: false, curveError: true })).toBe('curveError');
        expect(resolveReplayDisableReason({ ...ready, sidecarConnected: false })).toBe('disconnected');
        expect(resolveReplayDisableReason({ ...ready, heaterWritable: false })).toBe('unwritable');
        expect(resolveReplayDisableReason({ ...ready, pidEngaged: true })).toBe('pid');
        expect(resolveReplayDisableReason({ ...ready, heaterUnacknowledged: true })).toBe('unacknowledged');
    });

    it('기록이 있으면 끊김·쓰기불가를 “기록 없음”으로 접지 않는다', () => {
        expect(
            resolveReplayDisableReason({
                ...ready,
                sidecarConnected: false,
                heaterWritable: false,
            }),
        ).toBe('disconnected');
        expect(resolveReplayDisableReason({ ...ready, heaterWritable: false })).toBe('unwritable');
    });

    it('재생 중이면 사유 없음 — 중지 문구는 stopReason이 담당', () => {
        expect(resolveReplayDisableReason({ ...ready, active: true, pidEngaged: true })).toBeNull();
        expect(resolveReplayDisableReason(ready)).toBeNull();
    });
});

describe('isGiesenRoasterKey', () => {
    it('기센 계열만 true — 이지스터/Phidget은 배너 없음', () => {
        expect(isGiesenRoasterKey('giesen_standard')).toBe(true);
        expect(isGiesenRoasterKey('giesen_w45a_w60a')).toBe(true);
        expect(isGiesenRoasterKey('easyster')).toBe(false);
        expect(isGiesenRoasterKey('phidget')).toBe(false);
        expect(isGiesenRoasterKey(null)).toBe(false);
    });
});

describe('collapsedReplayTone', () => {
    it('재생 중=active, 자동 중지=stopped, finished·off=점 없음', () => {
        expect(collapsedReplayTone(true, null)).toBe('active');
        expect(collapsedReplayTone(false, 'controlDiverged')).toBe('stopped');
        expect(collapsedReplayTone(false, 'pid')).toBe('stopped');
        expect(collapsedReplayTone(false, 'finished')).toBeNull();
        expect(collapsedReplayTone(false, null)).toBeNull();
    });
});
