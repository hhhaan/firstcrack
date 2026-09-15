import { describe, expect, it } from 'vitest';
import { getRoastPhaseColor, getRoastPhaseName, waitPhaseAfterRoastReset } from './roast-phase';

describe('waitPhaseAfterRoastReset', () => {
    it('BBP 구간은 charge 대기(standby), 첫 배치는 Roast Ready(preheating)', () => {
        expect(waitPhaseAfterRoastReset(true)).toBe('standby');
        expect(waitPhaseAfterRoastReset(false)).toBe('preheating');
    });
});

describe('getRoastPhaseName', () => {
    it('End 이후 BBP 중에는 CHARGE WAIT', () => {
        expect(getRoastPhaseName(false, 'preheating', 0, [], true)).toBe('CHARGE WAIT');
        expect(getRoastPhaseName(false, 'standby', 0, [], true)).toBe('CHARGE WAIT');
        expect(getRoastPhaseName(true, 'ended', 480, [], true)).toBe('CHARGE WAIT');
    });

    it('첫 배치 예열은 PREHEATING/READY를 유지한다', () => {
        expect(getRoastPhaseName(false, 'preheating', 0, [])).toBe('PREHEATING');
        expect(getRoastPhaseName(false, 'standby', 0, [])).toBe('READY');
    });
});

describe('getRoastPhaseColor', () => {
    it('CHARGE WAIT uses the ready (wait) color, not drying', () => {
        expect(getRoastPhaseColor(true, 'CHARGE WAIT')).toBe(getRoastPhaseColor(false, 'READY'));
    });
});
