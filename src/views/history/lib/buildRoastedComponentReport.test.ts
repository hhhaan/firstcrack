import { describe, expect, it } from 'vitest';
import { buildRoastedComponentReport } from './buildRoastedComponentReport';

describe('buildRoastedComponentReport', () => {
    it('aggregates green used and roasted produced per bean', () => {
        const rows = buildRoastedComponentReport(
            [
                { bean_id: 'b1', delta_grams: -10000 },
                { bean_id: 'b1', delta_grams: -5000 },
                { bean_id: 'b2', delta_grams: -3000 },
            ],
            [
                {
                    bean_id: 'b1',
                    blend_id: null,
                    delta_grams: 12600,
                    event_type: 'roast_inbound',
                    is_estimate: false,
                },
                {
                    bean_id: 'b2',
                    blend_id: null,
                    delta_grams: 2550,
                    event_type: 'roast_inbound',
                    is_estimate: true,
                },
                {
                    bean_id: null,
                    blend_id: 'x1',
                    delta_grams: 4900,
                    event_type: 'blend_produce',
                    is_estimate: false,
                },
            ],
            { b1: 'Ethiopia', b2: 'Colombia' },
        );
        expect(rows).toEqual([
            {
                beanId: 'b1',
                beanName: 'Ethiopia',
                greenUsedG: 15000,
                roastedInG: 12600,
                lossPct: 16,
                hasEstimate: false,
            },
            {
                beanId: 'b2',
                beanName: 'Colombia',
                greenUsedG: 3000,
                roastedInG: 2550,
                lossPct: 15,
                hasEstimate: true,
            },
        ]);
    });

    it('returns null lossPct when green usage is zero', () => {
        const rows = buildRoastedComponentReport(
            [],
            [
                {
                    bean_id: 'b1',
                    blend_id: null,
                    delta_grams: 500,
                    event_type: 'roast_inbound',
                    is_estimate: false,
                },
            ],
            { b1: 'Ethiopia' },
        );
        expect(rows[0].lossPct).toBeNull();
    });
});
