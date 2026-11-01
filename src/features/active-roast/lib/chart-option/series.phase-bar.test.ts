import { describe, expect, it } from 'vitest';
import { mockChartColors } from './chart-colors.fixture';
import { buildPhaseSeries } from './series';

describe('buildPhaseSeries', () => {
    it('draws a thin color line on the bottom edge of the plot', () => {
        const [line, label] = buildPhaseSeries({
            phaseSegments: [{ name: 'Drying', startSec: 0, endSec: 180, durationSec: 180, pct: 100, color: '#old' }],
            tempMinC: 50,
            tempMaxC: 250,
            temperatureUnit: 'C',
            colors: mockChartColors,
        });
        const api = {
            value: (index: number) => [0, 180, 180, 'Drying'][index],
            coord: (point: number[]) => [32 + point[0], 110],
        };
        const coordSys = { coordSys: { x: 32, y: 10, width: 400, height: 200 } };
        const drawn = line.renderItem(coordSys, api) as {
            type: string;
            shape: { y: number; height: number };
            style: { fill: string };
        };
        const caption = label.renderItem(coordSys, api) as { style: { text: string; y: number } };

        expect(line.z).toBe(0);
        expect(drawn).toMatchObject({
            type: 'rect',
            shape: { y: 204, height: 6 },
            style: { fill: '#31' },
        });
        expect(label.z).toBe(10);
        expect(caption.style).toMatchObject({ text: 'Drying  3:00', y: 202 });
    });
});
