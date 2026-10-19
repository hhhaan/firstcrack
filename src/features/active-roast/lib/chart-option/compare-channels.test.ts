import { assert, describe, expect, it } from 'vitest';
import { type ComparePoint, compareChannels, compareChannelValue, comparePointAtTime } from './compare-channels';

const point = (label: string, unit: string, value: number): ComparePoint => ({
    t: 0,
    bt: 180,
    et: null,
    ror: null,
    extraReadings: [{ id: 'extra_0', label, unit, value }],
});

describe('recorded Gas commands and cursor', () => {
    it('keeps command units separate, including zero, without using heater feedback', () => {
        const percent = { ...point('Inlet', 'C', 100), heaterSet: 0, heaterUnit: '%' };
        const pressure = { ...percent, heaterSet: 12, heaterUnit: 'Pa' };
        const legacy = { ...point('Inlet', 'C', 100), heater: 50 };
        const channels = compareChannels([{ points: [percent, pressure, legacy] }], 'F').filter(
            (c) => c.source === 'heaterSet',
        );
        expect(channels.map((c) => c.unit)).toEqual(['%', 'Pa']);
        expect(channels.map((c) => compareChannelValue(percent, c, 'F'))).toEqual([0, null]);
        expect(channels.map((c) => compareChannelValue(pressure, c, 'F'))).toEqual([null, 12]);
        expect(channels.map((c) => compareChannelValue(legacy, c, 'F'))).toEqual([null, null]);
        expect(compareChannels([{ points: [legacy] }], 'C').some((c) => c.source === 'heaterSet')).toBe(false);
    });

    it('reads the last recorded sample without interpolating steps, filling gaps or extending a batch', () => {
        const points = [
            { ...point('Inlet', 'C', 100), t: 0, heaterSet: 70 },
            { ...point('Inlet', 'C', 100), t: 5, heaterSet: null, et: null },
            { ...point('Inlet', 'C', 100), t: 10, heaterSet: 45 },
        ];
        expect(comparePointAtTime(points, 4)?.heaterSet).toBe(70);
        expect(comparePointAtTime(points, 9)).toBe(points[1]);
        expect(comparePointAtTime(points, 10)?.heaterSet).toBe(45);
        expect(comparePointAtTime(points, -1)).toBeUndefined();
        expect(comparePointAtTime(points, 11)).toBeUndefined();
        expect(comparePointAtTime([], 0)).toBeUndefined();
    });
});

describe('recorded extra sensor channels', () => {
    it.each(['C', '°C', ' c '])('converts %s temperatures onto the Fahrenheit temperature axis', (unit) => {
        const sample = point('Inlet', unit, 100);
        const channel = compareChannels([{ points: [sample] }], 'F').find((c) => c.source === 'extra');
        assert(channel);
        expect(channel).toMatchObject({ kind: 'temperature', unit: '°F' });
        expect(compareChannelValue(sample, channel, 'F')).toBe(212);
        expect(compareChannelValue(point('Inlet', unit, 0), channel, 'F')).toBe(32);
    });

    it.each(['C/min', '°C/min'])('converts %s as a rate without adding an offset', (unit) => {
        const sample = point('Inlet RoR', unit, 10);
        const channel = compareChannels([{ points: [sample] }], 'F').find((c) => c.source === 'extra');
        assert(channel);
        expect(channel).toMatchObject({ kind: 'ror', unit: '°F/min' });
        expect(compareChannelValue(sample, channel, 'F')).toBe(18);
        expect(compareChannelValue(point('Inlet RoR', unit, 0), channel, 'F')).toBe(0);
    });

    it('keeps different sensors with the same positional ID separate and leaves gaps', () => {
        const inlet = point('Inlet', 'C', 100);
        const exhaust = point('Exhaust', 'C', 200);
        const sameInlet = point('Inlet', '°C', 110);
        const channels = compareChannels([{ points: [inlet] }, { points: [exhaust, sameInlet] }], 'C').filter(
            (c) => c.source === 'extra',
        );
        expect(channels.map((c) => c.label)).toEqual(['Inlet', 'Exhaust']);
        expect(channels.map((c) => compareChannelValue(inlet, c, 'C'))).toEqual([100, null]);
        expect(channels.map((c) => compareChannelValue(exhaust, c, 'C'))).toEqual([null, 200]);
        expect(compareChannelValue(sameInlet, channels[0], 'C')).toBe(110);
    });

    it('preserves units whose source values are not Celsius', () => {
        const sample = point('External', '°F', 100);
        const channel = compareChannels([{ points: [sample] }], 'F').find((c) => c.source === 'extra');
        assert(channel);
        expect(channel).toMatchObject({ kind: 'other', unit: '°F' });
        expect(compareChannelValue(sample, channel, 'F')).toBe(100);
    });
});
