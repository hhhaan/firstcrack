import { describe, expect, it } from 'vitest';
import { getRoastPhaseColor, getRoastPhaseName, waitPhaseAfterRoastReset } from './roast-phase';

describe('waitPhaseAfterRoastReset', () => {
    it('BBP 구간은 charge 대기(standby), 첫 배치는 Roast Ready(preheating)', () => {
        expect(waitPhaseAfterRoastReset(true)).toBe('standby');
        expect(waitPhaseAfterRoastReset(false)).toBe('preheating');
    });
});

describe('getRoastPhaseName', () => {
    it('BBP 대기(reset 후)는 READY, 완료 후에는 READY (#484)', () => {
        expect(getRoastPhaseName(false, 'preheating', 0, [], true)).toBe('READY');
        expect(getRoastPhaseName(false, 'standby', 0, [], true)).toBe('READY');
        expect(getRoastPhaseName(false, 'standby', 0, [], true)).toBe('READY');
        expect(getRoastPhaseName(false, 'standby', 0, [])).toBe('READY');
    });

    it('첫 배치 예열은 PREHEATING/READY를 유지한다', () => {
        expect(getRoastPhaseName(false, 'preheating', 0, [])).toBe('PREHEATING');
        expect(getRoastPhaseName(false, 'standby', 0, [])).toBe('READY');
    });
});

describe('getRoastPhaseColor', () => {
    it('READY uses the ready (wait) color, not drying', () => {
        expect(getRoastPhaseColor(true, 'READY')).toBe(getRoastPhaseColor(false, 'READY'));
    });

    it('completed standby uses ready color', () => {
        expect(getRoastPhaseColor(false, 'READY')).toBe(getRoastPhaseColor(false, 'IDLE'));
    });
});
