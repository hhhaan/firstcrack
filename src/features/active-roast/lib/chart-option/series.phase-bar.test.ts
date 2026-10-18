import { describe, expect, it } from 'vitest';
import { phaseBarLabelMode } from './series';

const atScale1 = (width: number, name: string, durLabel: string) =>
    phaseBarLabelMode(width, name, durLabel, 10, 9, 6, 2, 30);

describe('phaseBarLabelMode', () => {
    it('keeps the name and the time when the segment is wide enough', () => {
        expect(atScale1(160, 'Drying', '4:00  50%')).toBe('both');
    });

    it('drops the name when the two labels would overlap', () => {
        expect(atScale1(100, 'Maillard', '2:30  31%')).toBe('time');
        expect(atScale1(100, 'Development', '1:30  19%')).toBe('time');
    });

    it('omits text when the time itself does not fit', () => {
        expect(atScale1(40, 'Maillard', '2:30  31%')).toBe('none');
        expect(atScale1(20, 'Drying', '4:00  50%')).toBe('none');
    });
});
