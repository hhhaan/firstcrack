import { describe, expect, it } from 'vitest';
import { buildReferenceLog } from './reference-log';

describe('reference log', () => {
    it('keeps command changes including zero and never substitutes feedback', () => {
        const points = [
            { t: 0, bt: 190, heaterSet: 70, heater: 99 },
            { t: 20, bt: 130, heaterSet: 70 },
            { t: 40, bt: 120, heaterSet: 0 },
        ];
        const rows = buildReferenceLog([], points, 'F');
        expect(rows.map((row) => row.note)).toEqual(['70', '0']);
        expect(rows[1]).toMatchObject({ timeSec: 40, tempC: 120, temp: '248°F' });
        expect(points[0].heaterSet).toBe(70);
    });
    it('uses recorded events and a saved reference edit without mutating either', () => {
        const events = [{ id: 'original', type: 'Heater', time_sec: 10, temp_c: 140, note: '50%' }];
        expect(buildReferenceLog(events, [], 'C')[0].note).toBe('50%');
        expect(buildReferenceLog(events, [], 'C', [{ t: 12, bt: 145, heater: 40 }])[0]).toMatchObject({
            timeSec: 12,
            tempC: 145,
            note: '40',
        });
        expect(events[0].note).toBe('50%');
    });

    it('keeps BBP commands without suppressing the roast TSV command fallback', () => {
        const events = [{ id: 'bbp-heat', type: 'Heater', time_sec: -30, temp_c: 190, note: '70%' }];
        const points = [
            { t: 0, bt: 190, heaterSet: 70 },
            { t: 40, bt: 120, heaterSet: 0 },
        ];

        expect(buildReferenceLog(events, points, 'C')).toMatchObject([
            { id: 'bbp-heat', timeSec: -30, note: '70%' },
            { timeSec: 0, note: '70' },
            { timeSec: 40, note: '0' },
        ]);
    });

    it('does not substitute TSV commands for an empty saved override and keeps BBP commands', () => {
        const events = [{ id: 'bbp-heat', type: 'Heater', time_sec: -30, temp_c: 190, note: '70%' }];
        expect(buildReferenceLog(events, [{ t: 0, bt: 190, heaterSet: 70 }], 'C', [])).toMatchObject([
            { id: 'bbp-heat', timeSec: -30, note: '70%' },
        ]);
    });
});
