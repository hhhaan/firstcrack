import { describe, expect, it } from 'vitest';
import {
    CHANGE_LABEL_CHANNEL_GAP_PX,
    type ChangeLabelCandidate,
    findChangePoints,
    layoutChangeLabels,
} from './change-labels';

describe('findChangePoints', () => {
    it('labels the first reading and each displayed change, not every sample', () => {
        expect(findChangePoints([0, 1, 2, 3, 4], [30, 30, 30, 35, 35]).map((p) => [p.x, p.text])).toEqual([
            [0, '30'],
            [3, '35'],
        ]);
    });

    it('keeps a measured 0 and never invents one from null', () => {
        expect(findChangePoints([0, 1, 2, 3], [null, 0, null, 0]).map((p) => [p.x, p.text])).toEqual([[1, '0']]);
    });

    it('treats a null gap as missing, so an unchanged value after it is not a change', () => {
        expect(findChangePoints([0, 1, 2, 3], [40, null, 40, 45]).map((p) => p.x)).toEqual([0, 3]);
    });

    it('ignores sub-display noise but keeps one-decimal changes', () => {
        expect(findChangePoints([0, 1, 2], [55.01, 55.04, 55.3]).map((p) => p.text)).toEqual(['55', '55.3']);
    });
});

describe('layoutChangeLabels', () => {
    const rect = { x: 0, y: 0, width: 400, height: 80 };
    const at = (xPx: number, yPx: number, channel = 'heat', text = '50'): ChangeLabelCandidate => ({
        xPx,
        yPx,
        channel,
        text,
        color: '#000',
    });
    const overlap = (a: { left: number; top: number; width: number; height: number }, b: typeof a) =>
        a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

    it('never returns overlapping boxes, even for dense same-spot changes across channels', () => {
        const dense = Array.from({ length: 60 }, (_, i) => [
            at(100 + i * 2, 40, 'heat'),
            at(100 + i * 2, 42, 'fan'),
            at(100 + i * 2, 38, 'drum'),
        ]).flat();
        const laid = layoutChangeLabels(dense, rect);
        expect(laid.length).toBeGreaterThan(0);
        expect(laid.length).toBeLessThan(dense.length / 4);
        for (let i = 0; i < laid.length; i++) {
            for (let j = i + 1; j < laid.length; j++) expect(overlap(laid[i], laid[j])).toBe(false);
        }
    });

    it("spaces one channel's labels even when they would not overlap", () => {
        const burst = Array.from({ length: 20 }, (_, i) => at(380 - i * 10, i % 2 ? 20 : 70, 'fan'));
        const xs = layoutChangeLabels(burst, rect).map((l) => l.xPx);
        expect(xs[0]).toBe(380);
        for (let i = 1; i < xs.length; i++)
            expect(xs[i - 1] - xs[i]).toBeGreaterThanOrEqual(CHANGE_LABEL_CHANNEL_GAP_PX);
    });

    it('keeps the newest change when two collide', () => {
        const laid = layoutChangeLabels([at(100, 40, 'heat', '40'), at(104, 40, 'heat', '45')], rect);
        expect(laid.map((l) => l.text)).toEqual(['45']);
    });

    it('drops points outside the visible plot (zoom/pan) and keeps boxes inside it', () => {
        const laid = layoutChangeLabels([at(-5, 40), at(405, 40), at(398, 2), at(2, 78)], rect);
        expect(laid).toHaveLength(2);
        for (const box of laid) {
            expect(box.left).toBeGreaterThanOrEqual(rect.x);
            expect(box.left + box.width).toBeLessThanOrEqual(rect.x + rect.width);
            expect(box.top).toBeGreaterThanOrEqual(rect.y);
            expect(box.top + box.height).toBeLessThanOrEqual(rect.y + rect.height);
        }
    });

    it('places labels of different channels at the same time when there is room', () => {
        const laid = layoutChangeLabels([at(200, 20, 'heat'), at(200, 70, 'fan')], rect);
        expect(laid.map((l) => l.channel).sort()).toEqual(['fan', 'heat']);
    });
});
