import * as echarts from 'echarts';
import { expect, it } from 'vitest';
import { buildPrintEventLabels } from './print-event-labels';

it.each([false, true])('alternates PDF callouts above and below the curve (legacy below: %s)', (below) => {
    const items = [
        { timeSec: 240, y: 185, text: 'FC Start|04:00|185.0°C', below: false },
        { timeSec: 560, y: 210, text: 'FC Rolling|09:20|210.0°C', below: false },
        { timeSec: 580, y: 211, text: 'FC End|09:40|211.0°C', below: false },
        { timeSec: 600, y: 211.1, text: 'Drop|10:00|211.1°C', below: true },
    ].map((item) => ({ ...item, below, color: '#123456', showDot: false }));
    const chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 538, height: 400 });
    try {
        chart.setOption({
            animation: false,
            grid: { left: 40, right: 40, top: 20, bottom: 40 },
            xAxis: { min: 0, max: 600 },
            yAxis: { min: 50, max: 300 },
            series: [
                buildPrintEventLabels(items, [{ axis: 'temperature', xs: [0, 600], values: [202, 202] }]),
                {
                    type: 'line',
                    data: [
                        [0, 202],
                        [600, 202],
                    ],
                },
            ],
        });
        chart.renderToSVGString();
        const elements = chart.getZr().storage.getDisplayList();
        const textBounds = [];
        const directions = [];
        for (const item of items) {
            const text = elements.find((element) => 'text' in element.style && element.style.text === item.text);
            if (!text) throw new Error('Expected a rendered callout');
            const bounds = text.getBoundingRect().clone();
            const transform = text.getComputedTransform();
            if (transform) bounds.applyTransform(transform);
            const curveY = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [0, 202])[1];
            expect(curveY < bounds.y || curveY > bounds.y + bounds.height).toBe(true);
            for (const previous of textBounds) {
                expect(
                    bounds.x >= previous.x + previous.width ||
                        bounds.x + bounds.width <= previous.x ||
                        bounds.y >= previous.y + previous.height ||
                        bounds.y + bounds.height <= previous.y,
                ).toBe(true);
            }
            textBounds.push(bounds);
            const anchor = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [item.timeSec, item.y]);
            const leader = elements.find(
                (element) =>
                    element instanceof echarts.graphic.Line &&
                    element.shape.x1 === anchor[0] &&
                    element.shape.y1 === anchor[1],
            );
            if (!(leader instanceof echarts.graphic.Line)) throw new Error('Expected a callout leader');
            directions.push(Math.sign(leader.shape.y2 - leader.shape.y1));
            expect(leader.shape.x2).toBeGreaterThanOrEqual(bounds.x - 0.01);
            expect(leader.shape.x2).toBeLessThanOrEqual(bounds.x + bounds.width + 0.01);
            expect(leader.shape.y2).toBeGreaterThanOrEqual(bounds.y - 0.01);
            expect(leader.shape.y2).toBeLessThanOrEqual(bounds.y + bounds.height + 0.01);
        }
        expect(directions).toEqual([-1, 1, -1, 1]);
    } finally {
        chart.dispose();
    }
});

it('uses the opposite side when a callout has no room above or below the plot edge', () => {
    const items = [
        { timeSec: 500, y: 55, text: 'Drop', color: '#123456', below: false, showDot: false },
        { timeSec: 100, y: 295, text: 'Charge', color: '#123456', below: false, showDot: false },
    ];
    const chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 538, height: 400 });
    try {
        chart.setOption({
            animation: false,
            grid: { left: 40, right: 40, top: 20, bottom: 40 },
            xAxis: { min: 0, max: 600 },
            yAxis: { min: 50, max: 300 },
            series: [buildPrintEventLabels(items)],
        });
        chart.renderToSVGString();
        const leaders = chart
            .getZr()
            .storage.getDisplayList()
            .filter((element) => element instanceof echarts.graphic.Line && element.style.stroke === '#123456');
        expect(leaders).toHaveLength(2);
        expect(leaders.map((leader) => Math.sign(leader.shape.y2 - leader.shape.y1))).toEqual([1, -1]);
        expect(items.map((item) => item.timeSec)).toEqual([500, 100]);
    } finally {
        chart.dispose();
    }
});

it('keeps Charge text above curves that block the intermediate positions', () => {
    const chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 538, height: 400 });
    const charge = { timeSec: 0, y: 200, text: 'Charge|00:00|200.0°C', color: '#123456', below: false, showDot: false };
    try {
        chart.setOption({
            animation: false,
            grid: { left: 40, right: 40, top: 20, bottom: 40 },
            xAxis: { min: 0, max: 600 },
            yAxis: { min: 50, max: 300 },
            series: [
                buildPrintEventLabels(
                    [charge],
                    [{ axis: 'ror', xs: [60, 75, 600], values: [-10, 28, 4], min: 0, max: 30 }],
                ),
            ],
        });
        chart.renderToSVGString();
        const text = chart
            .getZr()
            .storage.getDisplayList()
            .find((element) => 'text' in element.style && element.style.text === charge.text);
        if (!text) throw new Error('Expected the rendered Charge callout');
        const bounds = text.getBoundingRect().clone();
        const transform = text.getComputedTransform();
        if (transform) bounds.applyTransform(transform);
        expect(bounds.y).toBeGreaterThanOrEqual(24);
        expect(bounds.y + bounds.height + 4).toBeLessThanOrEqual(20 + 340 * (1 - 28 / 30));
    } finally {
        chart.dispose();
    }
});
