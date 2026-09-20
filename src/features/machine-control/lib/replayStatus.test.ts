import { describe, expect, it } from 'vitest';
import { collapsedReplayTpChrome, resolveReplayTpWait } from './replayStatus';

const btNext = { t: 120, bt: 110, heater: 60 };
const timeNext = { t: 0, bt: 180, heater: 80 };
const tpTime = 60;

describe('resolveReplayTpWait', () => {
    it('다음이 BT이고 실제 TP가 없으면 waiting', () => {
        expect(
            resolveReplayTpWait({
                active: true,
                nextEvent: btNext,
                tpTime,
                confirmedTurningPoint: null,
            }),
        ).toBe('waiting');
    });

    it('fallback TP는 실감지와 구분한다', () => {
        expect(
            resolveReplayTpWait({
                active: true,
                nextEvent: btNext,
                tpTime,
                confirmedTurningPoint: { fallback: true },
            }),
        ).toBe('fallback');
    });

    it('실감지면 detected', () => {
        expect(
            resolveReplayTpWait({
                active: true,
                nextEvent: btNext,
                tpTime,
                confirmedTurningPoint: { fallback: false },
            }),
        ).toBe('detected');
        expect(
            resolveReplayTpWait({
                active: true,
                nextEvent: btNext,
                tpTime,
                confirmedTurningPoint: {},
            }),
        ).toBe('detected');
    });

    it('다음이 TIME이면 TP 대기 UI를 쓰지 않는다', () => {
        expect(
            resolveReplayTpWait({
                active: true,
                nextEvent: timeNext,
                tpTime,
                confirmedTurningPoint: null,
            }),
        ).toBeNull();
        expect(
            resolveReplayTpWait({
                active: true,
                nextEvent: { t: tpTime },
                tpTime,
                confirmedTurningPoint: { fallback: true },
            }),
        ).toBeNull();
    });

    it('꺼져 있거나 다음 이벤트가 없으면 상태 없음', () => {
        expect(
            resolveReplayTpWait({
                active: false,
                nextEvent: btNext,
                tpTime,
                confirmedTurningPoint: null,
            }),
        ).toBeNull();
        expect(
            resolveReplayTpWait({
                active: true,
                nextEvent: null,
                tpTime,
                confirmedTurningPoint: null,
            }),
        ).toBeNull();
    });

    it('fallback → 실감지 승격', () => {
        const facts = {
            active: true,
            nextEvent: btNext,
            tpTime,
            confirmedTurningPoint: { fallback: true } as { fallback?: boolean } | null,
        };
        expect(resolveReplayTpWait(facts)).toBe('fallback');
        facts.confirmedTurningPoint = { fallback: false };
        expect(resolveReplayTpWait(facts)).toBe('detected');
    });
});

describe('collapsedReplayTpChrome', () => {
    it('대기·폴백은 정상 재생과 다른 톤이다', () => {
        expect(collapsedReplayTpChrome(true, 'waiting')).toBe('waiting');
        expect(collapsedReplayTpChrome(true, 'fallback')).toBe('fallback');
        expect(collapsedReplayTpChrome(true, 'detected')).toBe('running');
        expect(collapsedReplayTpChrome(true, null)).toBe('running');
        expect(collapsedReplayTpChrome(false, 'waiting')).toBeNull();
    });
});
