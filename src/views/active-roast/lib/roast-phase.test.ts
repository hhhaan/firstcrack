import { describe, expect, it } from 'vitest';
import { getRoastPhaseColor, getRoastPhaseName, waitPhaseAfterRoastReset } from './roast-phase';

describe('waitPhaseAfterRoastReset', () => {
    it('BBP 구간은 charge 대기(standby), 첫 배치는 Roast Ready(preheating)', () => {
        expect(waitPhaseAfterRoastReset(true)).toBe('standby');
        expect(waitPhaseAfterRoastReset(false)).toBe('preheating');
    });
});

describe('getRoastPhaseName', () => {
    it('BBP 대기(reset 후)는 CHARGE WAIT, ended는 ENDED (#484)', () => {
        expect(getRoastPhaseName(false, 'preheating', 0, [], true)).toBe('CHARGE WAIT');
        expect(getRoastPhaseName(false, 'standby', 0, [], true)).toBe('CHARGE WAIT');
        expect(getRoastPhaseName(true, 'ended', 480, [], true)).toBe('ENDED');
        expect(getRoastPhaseName(true, 'ended', 480, [])).toBe('ENDED');
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

    it('ENDED uses development color, not CHARGE WAIT ready', () => {
        expect(getRoastPhaseColor(true, 'ENDED')).toBe(getRoastPhaseColor(true, 'Development'));
        expect(getRoastPhaseColor(true, 'ENDED')).not.toBe(getRoastPhaseColor(true, 'CHARGE WAIT'));
    });
});
