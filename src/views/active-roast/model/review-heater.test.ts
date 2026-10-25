import { editedHeatSet } from '@features/machine-control/lib/heater-events';
import type { LogEntry } from '@shared/types/roast';
import { describe, expect, it } from 'vitest';
import { heaterEventsFromLog, reviewHeaterToSave } from './review-heater';

const heater = (id: string, timeSec: number, note: string, tempC: number | null = 160): LogEntry => ({
    id,
    time: `${timeSec}`,
    timeSec,
    event: 'Heater',
    temp: '',
    tempC,
    note,
});

describe('review heater plan', () => {
    const points = [
        { t: 0, heaterSet: 80 },
        { t: 30, heaterSet: 80 },
        { t: 60, heaterSet: 50 },
    ];

    it('stores an edited Heater mark as the history Heat set plan', () => {
        const previous = [heater('h', 30, '80%')];
        const next = [heater('h', 30, '70%', 155)];
        const plan = reviewHeaterToSave(previous, next, null, next);
        expect(plan).toEqual([{ t: 30, bt: 155, heater: 70 }]);
        expect(editedHeatSet(points, 90, plan)).toEqual([80, 70, 70]);
    });

    it('leaves a stored plan alone when the edit is not a Heater mark', () => {
        const stored = [{ t: 0, bt: 180, heater: 40 }];
        const log = [heater('h', 0, '40%')];
        expect(reviewHeaterToSave(log, log, stored, log)).toBe(stored);
    });

    it('clears the plan when the last Heater mark is removed', () => {
        expect(reviewHeaterToSave([heater('h', 30, '80%')], [], [{ t: 30, bt: 160, heater: 80 }], [])).toBeNull();
        expect(heaterEventsFromLog([], null, null)).toBeNull();
    });

    it('keeps Heater marks outside the edited view in the complete saved plan', () => {
        const previous = [heater('visible', 30, '80%')];
        const next = [heater('visible', 30, '70%')];
        expect(reviewHeaterToSave(previous, next, null, [heater('history', 10, '90%'), ...next])).toEqual([
            { t: 10, bt: 160, heater: 90 },
            { t: 30, bt: 160, heater: 70 },
        ]);
    });

    it('keeps each step condition and metadata when an edited Heater moves past another step', () => {
        const previous = [heater('first', 30, '80%'), heater('second', 60, '50%')];
        const next = [heater('first', 75, '70%', 170), previous[1]];
        const stored = [
            { t: 30, bt: 160, heater: 80, trigger: 'bt', extra: { keep: true } },
            { t: 60, bt: 160, heater: 50, trigger: 'time' },
        ];
        expect(reviewHeaterToSave(previous, next, stored, next)).toEqual([
            stored[1],
            { ...stored[0], t: 75, bt: 170, heater: 70 },
        ]);
    });

    it('keeps unseen step conditions when a visible Heater is deleted', () => {
        const unseen = heater('unseen', 60, '50%');
        const stored = [
            { t: 30, bt: 160, heater: 80, trigger: 'bt' },
            { t: 60, bt: 160, heater: 50, trigger: 'time' },
        ];
        expect(reviewHeaterToSave([heater('visible', 30, '80%')], [], stored, [unseen])).toEqual([stored[1]]);
    });
});
