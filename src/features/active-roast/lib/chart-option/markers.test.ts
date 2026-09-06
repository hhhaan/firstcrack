import { describe, expect, it } from 'vitest';
import { buildMarkers, LABEL_BELOW_EVENTS, upcomingHeaterLabel } from './markers';
import type { ResolvedChartColors } from './types';

const colors = {
    phaseLines: '#aaa',
    currentTimeLine: '#bbb',
    nowLabel: '#ccc',
    tp: '#ddd',
    markerLabelColor: '#eee',
    fcBandFill: 'rgba(0,0,0,0.05)',
    axisLabel: '#111',
    targetDeltaWithin: '#0f0',
    targetDeltaOver: '#f00',
    targetDeltaUnder: '#00f',
} as unknown as ResolvedChartColors;

const baseParams = {
    charged: true,
    currentTimeSec: 600,
    xMin: 0,
    xMax: 700,
    turningPoints: [] as [],
    temperatureUnit: 'C' as const,
    unitLabel: '°C',
    xs: [480, 500, 520, 540],
    btActual: [196, 198, 200, 202] as (number | null)[],
    colors,
    tempYMin: 50,
    hasControlSeries: false,
    showFcBand: false,
};

describe('LABEL_BELOW_EVENTS', () => {
    it('puts FC Rolling / FC End / Drop below; FC Start / Yellow above', () => {
        expect(LABEL_BELOW_EVENTS.has('FC Rolling')).toBe(true);
        expect(LABEL_BELOW_EVENTS.has('FC End')).toBe(true);
        expect(LABEL_BELOW_EVENTS.has('Drop')).toBe(true);
        expect(LABEL_BELOW_EVENTS.has('FC Start')).toBe(false);
        expect(LABEL_BELOW_EVENTS.has('Yellow')).toBe(false);
    });
});

describe('buildMarkers label position', () => {
    it('point style: FC Start top, FC Rolling bottom', () => {
        const { markPointData } = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'point',
            eventMarkers: [
                { timeSec: 480, event: 'FC Start', color: '#1b', timeStr: '8:00', temp: '196°C' },
                { timeSec: 520, event: 'FC Rolling', color: '#5a9', timeStr: '8:40', temp: '200°C' },
            ],
        });
        const byName = Object.fromEntries(
            (markPointData as { name: string; label: { position: string } }[]).map((p) => [p.name, p.label.position]),
        );
        expect(byName['FC Start']).toBe('top');
        expect(byName['FC Rolling']).toBe('bottom');
    });

    it('line style: FC Start start(top), FC Rolling end(bottom)', () => {
        const { allMarkLines } = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'line',
            eventMarkers: [
                { timeSec: 480, event: 'FC Start', color: '#1b', timeStr: '8:00', temp: '196°C' },
                { timeSec: 520, event: 'FC Rolling', color: '#5a9', timeStr: '8:40', temp: '200°C' },
            ],
        });
        const eventLines = (
            allMarkLines as { xAxis?: number; label?: { position: string; formatter: string } }[]
        ).filter((l) => l.label?.formatter?.includes('FC'));
        const start = eventLines.find((l) => l.label?.formatter?.includes('FC Start'));
        const rolling = eventLines.find((l) => l.label?.formatter?.includes('FC Rolling'));
        expect(start?.label?.position).toBe('start');
        expect(rolling?.label?.position).toBe('end');
    });
});

describe('upcomingHeaterLabel', () => {
    it('shows heater percent and remaining N', () => {
        expect(upcomingHeaterLabel(70, 0)).toBe('70%');
        expect(upcomingHeaterLabel(70, 2)).toBe('70% +2');
        expect(upcomingHeaterLabel(60, 1, { display: 110, unitLabel: '°C' })).toBe('BT 110°C → 60% +1');
    });
});

describe('buildMarkers upcoming heater (#369)', () => {
    it('does not mark when upcomingHeaterMark is omitted', () => {
        const { heatMarkPoints, heatMarkLines, allMarkLines } = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'point',
            eventMarkers: [],
        });
        expect(heatMarkPoints).toEqual([]);
        expect(heatMarkLines).toEqual([]);
        expect((allMarkLines as { label?: { formatter?: string } }[]).some((l) => l.label?.formatter)).toBe(false);
    });

    it('puts the next time-axis event on the heat band with remaining N', () => {
        const { heatMarkPoints, heatMarkLines } = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'point',
            eventMarkers: [],
            hasControlSeries: true,
            showControlHeat: true,
            upcomingHeaterMark: { timeSec: 30, btC: 140, heater: 70, remainingAfter: 2, axis: 'time' },
        });
        expect(heatMarkLines).toEqual([expect.objectContaining({ xAxis: 30 })]);
        expect(heatMarkPoints).toEqual([
            expect.objectContaining({
                name: 'Replay',
                coord: [30, 70],
                label: expect.objectContaining({ formatter: '70% +2' }),
            }),
        ]);
    });

    it('falls back to a temp-chart time line when the heat band is off', () => {
        const { heatMarkPoints, allMarkLines } = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'point',
            eventMarkers: [],
            hasControlSeries: false,
            upcomingHeaterMark: { timeSec: 30, btC: 140, heater: 70, remainingAfter: 0, axis: 'time' },
        });
        expect(heatMarkPoints).toEqual([]);
        expect(allMarkLines).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    xAxis: 30,
                    label: expect.objectContaining({ formatter: '70%' }),
                }),
            ]),
        );
    });

    it('draws a BT guide for post-TP events', () => {
        const { heatMarkPoints, allMarkLines } = buildMarkers({
            ...baseParams,
            eventMarkerStyle: 'point',
            eventMarkers: [],
            hasControlSeries: true,
            showControlHeat: true,
            upcomingHeaterMark: { timeSec: 120, btC: 110, heater: 60, remainingAfter: 1, axis: 'bt' },
        });
        expect(heatMarkPoints).toEqual([]);
        expect(allMarkLines).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    yAxis: 110,
                    label: expect.objectContaining({ formatter: 'BT 110°C → 60% +1' }),
                }),
            ]),
        );
    });
});
