import * as echarts from 'echarts';
import { describe, expect, it } from 'vitest';
import { curveLabelLeader, isCurveLabelLeaderHit, projectCurveLabels } from './curve-label-projection';
import type { CurveLabelItem } from './markers';
import { buildCurveLabelSeries } from './series';

const item = (timeSec: number, y = 170): CurveLabelItem => ({
    timeSec,
    y,
    text: `FC Start|${timeSec}|196.0°C`,
    color: '#123456',
    below: false,
    showDot: true,
    showLeader: true,
});
const plot = { x: 32, y: 10, width: 600, height: 240 };

describe('curve annotations', () => {
    it.each([1, 1.13, 1.5, 2])('keeps dense labels within the temperature plot at scale %s', (scale) => {
        const items = [item(220), item(225), item(230), item(630, 245)];
        const boxes = projectCurveLabels(items, (point) => point, plot, scale);
        expect(boxes).toHaveLength(items.length);
        for (const [index, box] of boxes.entries()) {
            expect(box.item).toBe(items[index]);
            expect([box.anchorX, box.anchorY]).toEqual([items[index].timeSec, items[index].y]);
            expect(box.left).toBeGreaterThanOrEqual(plot.x);
            expect(box.right).toBeLessThanOrEqual(plot.x + plot.width);
            expect(box.top).toBeGreaterThanOrEqual(plot.y);
            expect(box.bottom).toBeLessThanOrEqual(plot.y + plot.height);
            const line = curveLabelLeader(box);
            if (!line) throw new Error('Expected a visible connector');
            expect(line).toMatchObject({ x1: box.anchorX, y1: box.anchorY });
            expect(line.x2).toBeGreaterThanOrEqual(box.left);
            expect(line.x2).toBeLessThanOrEqual(box.right);
            expect(line.y2).toBeGreaterThanOrEqual(box.top);
            expect(line.y2).toBeLessThanOrEqual(box.bottom);
            const mid = { x: (line.x1 + line.x2) / 2, y: (line.y1 + line.y2) / 2 };
            expect(isCurveLabelLeaderHit(box, mid.x, mid.y, 4)).toBe(true);
            expect(isCurveLabelLeaderHit(box, mid.x + 500, mid.y, 4)).toBe(false);
            for (const other of boxes.slice(index + 1)) {
                expect(
                    box.right <= other.left ||
                        other.right <= box.left ||
                        box.bottom <= other.top ||
                        other.bottom <= box.top,
                ).toBe(true);
            }
        }
    });

    it('keeps source identity after filtering invalid or off-screen anchors', () => {
        const valid = item(200);
        const items = [item(20), item(100, 300), item(120, Number.NaN), valid];
        const boxes = projectCurveLabels(items, (point) => point, plot);
        expect(boxes).toHaveLength(1);
        expect(boxes[0].item).toBe(valid);
        expect(boxes[0].timeSec).toBe(200);
    });

    it('keeps top-pinned notes ahead of curve labels regardless of event time', () => {
        const note = {
            ...item(225),
            text: 'Gas 0\nAirflow 1.23 kPa\nDrum 55 RPM',
            showLeader: false,
            labelAtTop: true,
            below: true,
            topInsetPx: 8,
        };
        const boxes = projectCurveLabels([item(220, 60), note], (point) => point, plot, 2);
        expect(boxes[1].top).toBe(18);
        expect(boxes[1].bottom).toBeLessThanOrEqual(boxes[0].top);
        expect(curveLabelLeader(boxes[1])).toBeNull();
    });

    it('scales preferred leader offsets without changing data coordinates', () => {
        const [small] = projectCurveLabels([item(220)], (point) => point, plot);
        const [large] = projectCurveLabels([item(220)], (point) => point, plot, 2);
        expect(curveLabelLeader(small)).toEqual({ x1: 220, y1: 170, x2: 236, y2: 148 });
        expect(curveLabelLeader(large)).toEqual({ x1: 220, y1: 170, x2: 252, y2: 126 });
    });

    it('renders actual ECharts leaders through resize, axis changes, removal, and restoration', () => {
        const chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 900, height: 420 });
        const labels = [{ ...item(259, 148.9), opacity: 0.3 }];
        try {
            chart.setOption({
                animation: false,
                grid: { left: 32, right: 32, top: 10, bottom: 40 },
                xAxis: { min: 0, max: 640 },
                yAxis: { min: 50, max: 250 },
                series: [buildCurveLabelSeries(labels)],
            });
            const verifyAnchor = () => {
                expect(chart.renderToSVGString()).toContain('FC Start');
                const anchor = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [259, 148.9]);
                const lines = chart
                    .getZr()
                    .storage.getDisplayList()
                    .filter((element) => element.type === 'line');
                expect(lines).toContainEqual(
                    expect.objectContaining({
                        shape: expect.objectContaining({ x1: anchor[0], y1: anchor[1] }),
                        style: expect.objectContaining({ stroke: '#123456', opacity: 0.3 }),
                    }),
                );
                expect(chart.renderToSVGString()).toContain('FC Start');
            };
            verifyAnchor();
            chart.resize({ width: 600, height: 320 });
            verifyAnchor();
            chart.setOption({ xAxis: { min: 200, max: 400 } });
            verifyAnchor();
            chart.setOption({ xAxis: { min: 300, max: 400 } });
            expect(chart.renderToSVGString()).not.toContain('FC Start');
            chart.setOption({ xAxis: { min: 0, max: 640 } });
            verifyAnchor();
            chart.setOption({ series: [buildCurveLabelSeries([])] });
            expect(chart.renderToSVGString()).not.toContain('FC Start');
        } finally {
            chart.dispose();
        }
    });
});
