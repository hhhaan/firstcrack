import { describe, expect, it } from 'vitest';
import { beanMetaFromJoin, beanMetaLine } from './cupping-bean-meta.ts';

const row = {
    name: 'Kenya AA',
    origin: 'Kenya',
    region: 'Nyeri',
    variety: 'SL28',
    process: 'Washed',
    farm: 'Gathaithi',
};

describe('beanMetaFromJoin', () => {
    it('reads a many-to-one object embed', () => {
        expect(beanMetaFromJoin(row)).toEqual(row);
    });

    it('unwraps a supabase-js array embed', () => {
        expect(beanMetaFromJoin([row])).toEqual(row);
    });

    it('returns null for missing / empty joins', () => {
        expect(beanMetaFromJoin(null)).toBeNull();
        expect(beanMetaFromJoin(undefined)).toBeNull();
        expect(beanMetaFromJoin([])).toBeNull();
    });
});

describe('beanMetaLine', () => {
    it('joins origin through farm', () => {
        expect(beanMetaLine(row)).toBe('Kenya · Nyeri · SL28 · Washed · Gathaithi');
    });
});
