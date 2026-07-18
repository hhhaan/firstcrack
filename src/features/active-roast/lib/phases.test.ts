import type { LogEntry } from '@shared/types/roast';
import { describe, expect, it } from 'vitest';
import { computePhaseSegments } from './phases';

const entry = (event: string, timeSec: number): LogEntry => ({
    time: `${Math.floor(timeSec / 60)}:${String(timeSec % 60).padStart(2, '0')}`,
    timeSec,
    event,
    temp: '0',
    note: '',
});

describe('computePhaseSegments', () => {
    it('returns empty when not charged or elapsed 0', () => {
        expect(computePhaseSegments([entry('Yellow', 60)], 100, false)).toEqual([]);
        expect(computePhaseSegments([entry('Yellow', 60)], 0, true)).toEqual([]);
    });

    it('builds Drying → Maillard → Development from markers', () => {
        const logs = [entry('Yellow', 240), entry('FC Start', 480), entry('Drop', 600)];
        const segs = computePhaseSegments(logs, 600, true);

        expect(segs.map((s) => s.name)).toEqual(['Drying', 'Maillard', 'Development']);
        expect(segs[0]).toMatchObject({ startSec: 0, endSec: 240, durationSec: 240, pct: 40 });
        expect(segs[1]).toMatchObject({ startSec: 240, endSec: 480, durationSec: 240, pct: 40 });
        expect(segs[2]).toMatchObject({ startSec: 480, endSec: 600, durationSec: 120, pct: 20 });
    });

    it('uses elapsed as Drop when Drop missing', () => {
        const logs = [entry('Yellow', 100), entry('FC Start', 200)];
        const segs = computePhaseSegments(logs, 300, true);
        const dev = segs.find((s) => s.name === 'Development');
        expect(dev?.endSec).toBe(300);
        expect(dev?.durationSec).toBe(100);
    });

    it('omits Maillard/Development until markers exist', () => {
        const segs = computePhaseSegments([], 180, true);
        expect(segs).toHaveLength(1);
        expect(segs[0].name).toBe('Drying');
        expect(segs[0].endSec).toBe(180);
    });
});
