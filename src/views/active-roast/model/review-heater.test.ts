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
        const plan = reviewHeaterToSave(previous, next, null, next, previous);
        expect(plan).toEqual([{ t: 30, bt: 155, heater: 70 }]);
        expect(editedHeatSet(points, 90, plan)).toEqual([80, 70, 70]);
    });

    it('leaves a stored plan alone when the edit is not a Heater mark', () => {
        const stored = [{ t: 0, bt: 180, heater: 40 }];
        const log = [heater('h', 0, '40%')];
        expect(reviewHeaterToSave(log, log, stored, log, log)).toBe(stored);
    });

    it('clears the plan when the last Heater mark is removed', () => {
        expect(
            reviewHeaterToSave(
                [heater('h', 30, '80%')],
                [],
                [{ t: 30, bt: 160, heater: 80 }],
                [],
                [heater('h', 30, '80%')],
            ),
        ).toBeNull();
        expect(heaterEventsFromLog([], null, null)).toBeNull();
    });

    it('keeps Heater marks outside the edited view in the complete saved plan', () => {
        const previous = [heater('visible', 30, '80%')];
        const next = [heater('visible', 30, '70%')];
        expect(
            reviewHeaterToSave(
                previous,
                next,
                null,
                [heater('history', 10, '90%'), ...next],
                [heater('history', 10, '90%'), ...previous],
            ),
        ).toEqual([
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
        expect(reviewHeaterToSave(previous, next, stored, next, previous)).toEqual([
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
        expect(
            reviewHeaterToSave(
                [heater('visible', 30, '80%')],
                [],
                stored,
                [unseen],
                [heater('visible', 30, '80%'), unseen],
            ),
        ).toEqual([stored[1]]);
    });

    it('keeps distinct conditions for Heater rows at the same second after reordering', () => {
        const previous = [heater('a', 30, '80%'), heater('b', 30, '50%', 165)];
        const next = [{ ...previous[0], timeSec: 45 }, previous[1]];
        const stored = [
            { t: 30, bt: 160, heater: 80, trigger: 'bt' },
            { t: 30, bt: 165, heater: 50, trigger: 'time' },
        ];
        expect(reviewHeaterToSave(previous, next, stored, next, previous)).toEqual([
            stored[1],
            { ...stored[0], t: 45 },
        ]);
        expect(reviewHeaterToSave(previous, [previous[1]], stored, [previous[1]], previous)).toEqual([stored[1]]);
    });

    it('keeps separate conditions on identical-coordinate steps when the first one is deleted', () => {
        const previous = [heater('a', 30, '80%'), heater('b', 30, '80%')];
        const stored = [
            { t: 30, bt: 160, heater: 80, trigger: 'bt' },
            { t: 30, bt: 160, heater: 80, trigger: 'time' },
        ];
        expect(reviewHeaterToSave(previous, [previous[1]], stored, [previous[1]], previous)).toEqual([stored[1]]);
    });

    it('matches the current record condition after a stale review keeps an externally moved time', () => {
        const previous = [heater('a', 30, '80%')];
        const next = [heater('a', 30, '70%')];
        const stored = [{ t: 40, bt: 160, heater: 80, trigger: 'bt' }];
        expect(reviewHeaterToSave(previous, next, stored, [heater('a', 40, '70%')], [heater('a', 40, '80%')])).toEqual([
            { ...stored[0], heater: 70 },
        ]);
    });

    it('matches identical hidden and visible steps from the complete record rather than visible order', () => {
        const record = [heater('hidden', 30, '80%'), heater('visible', 30, '80%')];
        const next = [heater('visible', 45, '70%')];
        const stored = [
            { t: 30, bt: 160, heater: 80, trigger: 'bt' },
            { t: 30, bt: 160, heater: 80, trigger: 'time' },
        ];
        expect(reviewHeaterToSave([record[1]], next, stored, [record[0], ...next], record)).toEqual([
            stored[0],
            { ...stored[1], t: 45, heater: 70 },
        ]);
    });
});
