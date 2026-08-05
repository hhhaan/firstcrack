import { describe, expect, it } from 'vitest';
import { buildMarkers, LABEL_BELOW_EVENTS } from './markers';
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
