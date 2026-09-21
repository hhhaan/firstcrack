import { summarizeSessionEvents } from '@entities/roast-profile';
import type { LogEntry } from '@shared/types/roast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveRoastPoint } from '../model/useSidecarPolling';
import { buildEventMarkers, calcDelta, calcDevTime, calcTargetDelta } from './display-derivatives';

// 0s:200° → 60s:180° 직선 타겟
const target = [
    { t: 0, bt: 200 },
    { t: 60, bt: 180 },
];

const live = (time: number, bt: number, et: number | null = bt + 10): LiveRoastPoint => ({
    time,
    label: '0:00',
    bt,
    et,
    ror: 0,
    ror_et: 0,
    heater: 0,
    fan: 0,
    drum: 0,
});

describe('calcDelta', () => {
    it('returns null with fewer than two post-charge points', () => {
        expect(calcDelta([], 'C')).toEqual({ deltaBT: null, deltaET: null });
        expect(calcDelta([live(0, 150)], 'C')).toEqual({ deltaBT: null, deltaET: null });
        expect(calcDelta([live(-5, 200), live(0, 150)], 'C')).toEqual({ deltaBT: null, deltaET: null });
    });

    it('compares current BT/ET against ~30s earlier (ignores pre-charge)', () => {
        const points = [live(-10, 220), live(0, 150), live(15, 160), live(30, 170), live(45, 180)];
        // current 45s vs closest to 15s → 180-160
        expect(calcDelta(points, 'C')).toEqual({ deltaBT: '20.0', deltaET: '20.0' });
    });

    it('converts delta into display unit', () => {
        const points = [live(0, 100), live(30, 110)];
        // 10°C → 18°F
        expect(calcDelta(points, 'F')).toEqual({ deltaBT: '18.0', deltaET: '18.0' });
    });

    it('finds the closest 30s-ago sample even with an out-of-order append', () => {
        // 15s arrived late (index order ≠ time order); it is still the closest to targetTime=15
        const points = [live(0, 150), live(20, 165), live(15, 160), live(45, 180)];
        expect(calcDelta(points, 'C')).toEqual({ deltaBT: '20.0', deltaET: '20.0' });
    });

    it('skips a pre-charge point sitting mid-array without stopping the scan', () => {
        const points = [live(0, 150), live(-5, 220), live(15, 160), live(45, 180)];
        expect(calcDelta(points, 'C')).toEqual({ deltaBT: '20.0', deltaET: '20.0' });
    });

    it('null ET delta when either sample lacks ET', () => {
        const points = [live(0, 100, null), live(30, 110, 120)];
        expect(calcDelta(points, 'C')).toEqual({ deltaBT: '10.0', deltaET: null });
    });
});

describe('calcTargetDelta', () => {
    it('classifies within band (±2°C)', () => {
        const r = calcTargetDelta(191, target, 30, 'C');
        expect(r).toEqual({ deltaDisplay: 1, status: 'within' });
    });

    it('classifies over / under beyond band', () => {
        expect(calcTargetDelta(195, target, 30, 'C')?.status).toBe('over');
        expect(calcTargetDelta(185, target, 30, 'C')?.status).toBe('under');
    });

    it('interpolates target at elapsed time', () => {
        const r = calcTargetDelta(190, target, 15, 'C');
        expect(r?.deltaDisplay).toBeCloseTo(-5); // target at 15s = 195
    });

    it('converts delta to display unit while banding in celsius', () => {
        const r = calcTargetDelta(203, target, 0, 'F');
        expect(r?.status).toBe('over'); // +3°C > 2°C band
        expect(r?.deltaDisplay).toBeCloseTo(5.4); // 3°C × 9/5
    });

    it('returns null without BT or target curve', () => {
        expect(calcTargetDelta(null, target, 30, 'C')).toBeNull();
        expect(calcTargetDelta(190, [], 30, 'C')).toBeNull();
    });
});

describe('buildEventMarkers', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('carries Note/Heater identity, body, and raw BT while excluding TP/unknown/Now', () => {
        vi.stubGlobal('document', { documentElement: {} });
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#abc' }));
        const entries: LogEntry[] = [
            { id: 'note', time: '1:00', timeSec: 60, event: 'Note', temp: '160.0°C', tempC: 160, note: 'aroma' },
            {
                id: 'heater',
                time: '2:00',
                timeSec: 120,
                event: 'Heater',
                temp: '180.0°C',
                tempC: 180,
                note: '50%',
            },
            { id: 'tp', time: '0:30', timeSec: 30, event: 'TP', temp: '90.0°C', tempC: 90, note: '' },
            { id: 'unknown', time: '3:00', timeSec: 180, event: 'Unknown', temp: '', note: '' },
            { time: '3:01', timeSec: 181, event: 'Now', temp: '', note: '', current: true },
        ];

        expect(buildEventMarkers(entries)).toEqual([
            {
                logId: 'note',
                timeSec: 60,
                event: 'Note',
                color: '#abc',
                timeStr: '1:00',
                temp: '160.0°C',
                tempC: 160,
                note: 'aroma',
            },
            {
                logId: 'heater',
                timeSec: 120,
                event: 'Heater',
                color: '#abc',
                timeStr: '2:00',
                temp: '180.0°C',
                tempC: 180,
                note: '50%',
            },
        ]);
    });
});

describe('calcDevTime', () => {
    const log = (event: string, timeSec: number): LogEntry => ({
        time: `${Math.floor(timeSec / 60)}:${String(timeSec % 60).padStart(2, '0')}`,
        timeSec,
        event,
        temp: '0',
        note: '',
    });

    it('freezes roast metrics at Drop while elapsed continues (480/600/660)', () => {
        const entries = [log('Charge', 0), log('FC Start', 480), log('Drop', 600)];
        const result = calcDevTime(entries, 660);
        expect(result.devTimeOnly).toBe('2:00');
        expect(result.dtrPct).toBe(20);
        expect(result.roastDurationSec).toBe(600);
        expect(result.rollingDtrPct).toBeNull();
    });

    it('uses live elapsed when Drop is missing', () => {
        const result = calcDevTime([log('FC Start', 480)], 660);
        expect(result.devTimeOnly).toBe('3:00');
        expect(result.dtrPct).toBeCloseTo(27.3, 1);
        expect(result.roastDurationSec).toBe(660);
    });

    it('recalculates after Drop undo', () => {
        const withDrop = calcDevTime([log('FC Start', 480), log('Drop', 600)], 630);
        expect(withDrop.roastDurationSec).toBe(600);
        const undone = calcDevTime([log('FC Start', 480)], 630);
        expect(undone.roastDurationSec).toBe(630);
        expect(undone.devTimeOnly).toBe('2:30');
    });

    it('agrees with profile-from-session summary on 480/600/660', () => {
        const entries = [log('Charge', 0), log('FC Start', 480), log('Drop', 600), log('End', 660)];
        const live = calcDevTime(entries, 660);
        const summary = summarizeSessionEvents(
            entries.map((e) => ({
                id: e.event,
                type: e.event,
                time_sec: e.timeSec ?? 0,
            })),
            { duration_seconds: 660, drop_temp_celsius: null },
        );
        expect(live.roastDurationSec).toBe(600);
        expect(summary.duration_sec).toBe(600);
        expect(summary.dev_time_sec).toBe(120);
        expect(summary.dev_pct).toBe(20);
        expect(live.devTimeOnly).toBe('2:00');
        expect(live.dtrPct).toBe(20);
    });
});
