import { describe, expect, it } from 'vitest';
import { getRoastPhaseColor, getRoastPhaseName } from './roast-phase';

describe('getRoastPhaseName', () => {
    it('BBP 대기(reset 후)는 READY, ended는 ENDED (#484)', () => {
        expect(getRoastPhaseName(false, 'preheating', 0, [], true)).toBe('READY');
        expect(getRoastPhaseName(false, 'standby', 0, [], true)).toBe('READY');
        expect(getRoastPhaseName(true, 'ended', 480, [], true)).toBe('ENDED');
        expect(getRoastPhaseName(true, 'ended', 480, [])).toBe('ENDED');
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

    it('ENDED uses development color, not READY', () => {
        expect(getRoastPhaseColor(true, 'ENDED')).toBe(getRoastPhaseColor(true, 'Development'));
        expect(getRoastPhaseColor(true, 'ENDED')).not.toBe(getRoastPhaseColor(true, 'READY'));
    });
});
