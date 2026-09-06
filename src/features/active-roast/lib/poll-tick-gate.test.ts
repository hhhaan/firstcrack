import { describe, expect, it } from 'vitest';
import { HOST_TICK_MS, shouldAcceptTick } from './poll-tick-gate';

/** tick 도착 시각 목록을 게이트에 통과시켜 수락된 시각만 반환 */
const acceptedTimes = (arrivals: number[], pollIntervalMs: number, start = 0): number[] => {
    let last = start;
    const accepted: number[] = [];
    for (const now of arrivals) {
        if (shouldAcceptTick(now, last, pollIntervalMs)) {
            last = now;
            accepted.push(now);
        }
    }
    return accepted;
};

describe('shouldAcceptTick (host 500ms poll clock gate)', () => {
    it('500ms 설정: IPC 지터로 간격이 500보다 살짝 짧아도 모든 tick을 수락한다', () => {
        // 호스트는 정확히 500ms 간격, JS 수신 시각은 지터 ±10ms
        const arrivals = [505, 998, 1503, 2001, 2495, 3009];
        expect(acceptedTimes(arrivals, 500)).toEqual(arrivals);
    });

    it('1000ms 설정: 중간 tick(≈500ms)은 skip하고 ≈1000ms tick은 지터가 있어도 수락한다', () => {
        const arrivals = [498, 1004, 1502, 1996, 2500, 3003];
        expect(acceptedTimes(arrivals, 1000)).toEqual([1004, 1996, 3003]);
    });

    it('절전 복귀 시 밀린 이벤트 burst는 첫 tick만 수락하고 나머지는 흡수한다', () => {
        // 5초간 suspend 후 큐에 쌓인 tick이 한꺼번에 도착
        const arrivals = [5000, 5001, 5002, 5003, 5004];
        expect(acceptedTimes(arrivals, 500)).toEqual([5000]);
    });

    it('마진은 반 tick — 그보다 이른 tick은 skip한다', () => {
        expect(shouldAcceptTick(500 - HOST_TICK_MS / 2, 0, 500)).toBe(true);
        expect(shouldAcceptTick(500 - HOST_TICK_MS / 2 - 1, 0, 500)).toBe(false);
    });
});
