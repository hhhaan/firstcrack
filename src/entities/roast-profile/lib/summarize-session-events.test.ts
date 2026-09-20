import type { StoredRoastEvent } from '@shared/types/roast';
import { describe, expect, it } from 'vitest';
import { summarizeSessionEvents } from './summarize-session-events';

const ev = (type: string, time_sec: number, temp_c: number | null = null): StoredRoastEvent => ({
    id: type,
    type,
    time_sec,
    temp_c,
});

const fallback = { duration_seconds: 305, drop_temp_celsius: 151 };

describe('summarizeSessionEvents', () => {
    it('derives every column from Charge / FC Start / Drop marks', () => {
        const events = [
            ev('Charge', 0, 209.9),
            ev('TP', 126.002, 130),
            ev('FC Start', 569.4, 195.4),
            ev('Drop', 690.6, 210.4),
            ev('End', 700, 190),
        ];
        expect(summarizeSessionEvents(events, fallback)).toEqual({
            charge_temp_celsius: 210,
            drop_temp_celsius: 210,
            duration_sec: 691,
            fc_time_sec: 569,
            dev_time_sec: 121,
            dev_pct: 17.5,
        });
    });

    it('without FC Start: no fc / dev values, rest still filled', () => {
        const events = [ev('Charge', 0, 210.1), ev('Drop', 269, 147)];
        expect(summarizeSessionEvents(events, fallback)).toMatchObject({
            charge_temp_celsius: 210,
            duration_sec: 269,
            fc_time_sec: null,
            dev_time_sec: null,
            dev_pct: null,
        });
    });

    it('without Drop: End time, then session fallbacks for duration and drop temp', () => {
        expect(summarizeSessionEvents([ev('Charge', 0, 210), ev('End', 305, 150.9)], fallback)).toMatchObject({
            duration_sec: 305,
            drop_temp_celsius: 151,
        });
        expect(summarizeSessionEvents([], { duration_seconds: 120.4, drop_temp_celsius: null })).toMatchObject({
            duration_sec: 120,
            drop_temp_celsius: null,
            charge_temp_celsius: null,
        });
    });

    it('Drop-first: FC=480 / Drop=600 / End=660 → 600 / 120 / 20 (record End ignored)', () => {
        expect(
            summarizeSessionEvents(
                [ev('Charge', 0, 200), ev('FC Start', 480, 190), ev('Drop', 600, 210), ev('End', 660, 180)],
                { duration_seconds: 660, drop_temp_celsius: 151 },
            ),
        ).toMatchObject({
            duration_sec: 600,
            fc_time_sec: 480,
            dev_time_sec: 120,
            dev_pct: 20,
            drop_temp_celsius: 210,
        });
    });

    it('no Drop, End=660 → 660 / 180 / ~27.3', () => {
        expect(summarizeSessionEvents([ev('Charge', 0), ev('FC Start', 480), ev('End', 660)], fallback)).toMatchObject({
            duration_sec: 660,
            fc_time_sec: 480,
            dev_time_sec: 180,
            dev_pct: 27.3,
        });
    });
});
