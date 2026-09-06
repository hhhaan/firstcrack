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
            dev_time_sec: 122,
            dev_pct: 17.7,
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
});
