import { expect, it } from 'vitest';
import { automaticBatchTitle } from './batch-title';

it('shows an unnumbered source name before save', () => {
    expect(automaticBatchTitle({ name: ' Colombia Santander ' })).toBe('Colombia Santander');
    expect(automaticBatchTitle({ name: null })).toBe('Roast');
    expect(automaticBatchTitle({ name: 'x'.repeat(150) })).toHaveLength(120);
});

it('formats preview modes without changing the source identity', () => {
    const identity = { name: 'Lot' };
    const numbers = { profile_batch_number: 3, total_batch_number: 12 };
    expect(automaticBatchTitle(identity, 'profile', numbers)).toBe('Lot #3');
    expect(automaticBatchTitle(identity, 'total', numbers)).toBe('Lot Σ#12');
    expect(automaticBatchTitle(identity, 'both', numbers)).toBe('Lot #3 · Σ#12');
    expect(automaticBatchTitle(identity, 'none', numbers)).toBe('Lot');
    expect(automaticBatchTitle(identity, 'both', { ...numbers, profile_batch_number: null })).toBe('Lot Σ#12');
    expect(identity).toEqual({ name: 'Lot' });
});

it('keeps the preview suffix within the title length limit', () => {
    const title = automaticBatchTitle({ name: 'x'.repeat(120) }, 'both', {
        profile_batch_number: 3,
        total_batch_number: 12,
    });
    expect(title).toHaveLength(120);
    expect(title.endsWith(' #3 · Σ#12')).toBe(true);
});
