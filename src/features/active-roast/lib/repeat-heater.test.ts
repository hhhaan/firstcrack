import { describe, expect, it } from 'vitest';
import { controlValuesWithoutRepeatHeater, isRepeatHeaterCommit, omitRepeatHeaterMarks } from './repeat-heater';

const heater = (note: string, timeSec: number) => ({ event: 'Heater', note, timeSec });

describe('isRepeatHeaterCommit', () => {
    it('is false until a heater setpoint exists', () => {
        expect(isRepeatHeaterCommit([], 15)).toBe(false);
        expect(isRepeatHeaterCommit([heater('15%', 3)], 20)).toBe(false);
    });

    it('is true when the click matches the latest setpoint, including after an earlier different value', () => {
        expect(isRepeatHeaterCommit([heater('15%', 3), heater('15%', 8)], 15)).toBe(true);
        expect(isRepeatHeaterCommit([heater('15%', 3), heater('20%', 10)], 15)).toBe(false);
        expect(isRepeatHeaterCommit([heater('15kPa', 1)], 15)).toBe(true);
    });

    it('reads an acknowledged write when that is the latest setpoint', () => {
        expect(
            isRepeatHeaterCommit([{ event: 'Control', timeSec: 4, note: '', appliedControl: { heater: 15 } }], 15),
        ).toBe(true);
    });
});

describe('controlValuesWithoutRepeatHeater', () => {
    it('keeps the first acknowledged write even after its chart mark exists', () => {
        expect(controlValuesWithoutRepeatHeater([heater('15%', 3)], { heater: 15 })).toEqual({ heater: 15 });
    });

    it('drops only the repeated heater and keeps a fan that changed in the same write', () => {
        const previous = [{ event: 'Control', timeSec: 3, note: '', appliedControl: { heater: 15 } }];
        expect(controlValuesWithoutRepeatHeater(previous, { heater: 15, fan: 40 })).toEqual({ fan: 40 });
        expect(controlValuesWithoutRepeatHeater(previous, { heater: 20 })).toEqual({ heater: 20 });
    });
});

describe('omitRepeatHeaterMarks', () => {
    it('keeps the first label for a setpoint and a later return to that setpoint', () => {
        const marks = omitRepeatHeaterMarks([
            { event: 'Heater', note: '15%', timeSec: 8 },
            { event: 'Charge', note: '', timeSec: 0 },
            { event: 'Heater', note: '15%', timeSec: 4 },
            { event: '컬러 체인지', note: '', timeSec: 1 },
            { event: 'Heater', note: '20%', timeSec: 12 },
            { event: 'Heater', note: '15%', timeSec: 20 },
        ]);
        expect(marks.map((mark) => [mark.event, mark.timeSec])).toEqual([
            ['Charge', 0],
            ['Heater', 4],
            ['컬러 체인지', 1],
            ['Heater', 12],
            ['Heater', 20],
        ]);
    });
});
