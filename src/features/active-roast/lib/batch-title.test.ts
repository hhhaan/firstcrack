import { expect, it } from 'vitest';
import { automaticBatchTitle } from './batch-title';

it('shows an unnumbered source name before save', () => {
    expect(automaticBatchTitle({ name: ' Colombia Santander ' })).toBe('Colombia Santander');
    expect(automaticBatchTitle({ name: null })).toBe('Roast');
    expect(automaticBatchTitle({ name: 'x'.repeat(150) })).toHaveLength(120);
});
