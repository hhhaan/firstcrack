import { formatElapsed } from '@shared/lib/format';
import { describe, expect, it } from 'vitest';
import { fmtSec } from './axes';

describe('fmtSec', () => {
    it('wraps formatElapsed and prefixes negatives for axis ticks', () => {
        expect(fmtSec(90.6)).toBe(formatElapsed(90.6));
        expect(fmtSec(90.6)).toBe('1:30');
        expect(fmtSec(-90.6)).toBe(`-${formatElapsed(90.6)}`);
        expect(fmtSec(-90.6)).toBe('-1:30');
    });
});
