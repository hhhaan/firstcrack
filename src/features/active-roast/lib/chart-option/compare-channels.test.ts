import { assert, describe, expect, it } from 'vitest';
import { type ComparePoint, compareChannels, compareChannelValue } from './compare-channels';

const point = (label: string, unit: string, value: number): ComparePoint => ({
    t: 0,
    bt: 180,
    et: null,
    ror: null,
    extraReadings: [{ id: 'extra_0', label, unit, value }],
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
