import { describe, expect, it } from 'vitest';
import { aggregateComponentReport } from './component-report';

describe('aggregateComponentReport', () => {
    it('sums green and output by bean_id', () => {
        const rows = aggregateComponentReport([
            {
                bean_id: 'b1',
                bean_label: null,
                weight_grams: 5000,
                output_weight_grams: 4200,
                beans: { name: 'Ethiopia' },
            },
            {
                bean_id: 'b1',
                bean_label: null,
                weight_grams: 3000,
                output_weight_grams: null,
                beans: { name: 'Ethiopia' },
            },
            {
                bean_id: 'b2',
                bean_label: null,
                weight_grams: 2000,
                output_weight_grams: 1700,
                beans: { name: 'Brazil' },
            },
        ]);
        expect(rows).toEqual([
            { key: 'b1', beanId: 'b1', beanName: 'Ethiopia', sessionCount: 2, greenGrams: 8000, outputGrams: 4200 },
            { key: 'b2', beanId: 'b2', beanName: 'Brazil', sessionCount: 1, greenGrams: 2000, outputGrams: 1700 },
        ]);
    });

    it('groups label-only sessions separately from inventory beans', () => {
        const rows = aggregateComponentReport([
            { bean_id: null, bean_label: 'sample', weight_grams: 500, output_weight_grams: 400, beans: null },
            { bean_id: 'b1', bean_label: null, weight_grams: 100, output_weight_grams: 80, beans: { name: 'Kenya' } },
        ]);
        expect(rows.map((r) => r.key)).toEqual(['label:sample', 'b1']);
        expect(rows[0]?.beanName).toBe('sample');
    });
});
