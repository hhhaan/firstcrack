import { describe, expect, it } from 'vitest';
import { sessionDistinctTitle, sessionRoastTitle } from './sessionRoastTitle';

it('keeps batch titles separate from linked beans with a consistent legacy fallback', () => {
    const session = { batch_name: '  Batch C ', bean_label: 'Legacy title', beans: { name: 'Green B' } };
    expect(sessionRoastTitle(session)).toBe('Batch C');
    expect(sessionRoastTitle({ ...session, batch_name: '  ' })).toBe('Legacy title');
    expect(sessionRoastTitle({ ...session, batch_name: null, bean_label: null })).toBe('Green B');
    expect(sessionRoastTitle({ batch_name: null, bean_label: null, beans: null })).toBeNull();
    expect(session.beans.name).toBe('Green B');
});

describe('sessionDistinctTitle', () => {
    it('reports a title only when it says something the bean name does not', () => {
        const titled = { batch_name: 'Batch C', bean_label: null, beans: { name: 'Green B' } };
        expect(sessionDistinctTitle(titled)).toBe('Batch C');
        expect(sessionDistinctTitle({ ...titled, batch_name: 'green b' })).toBeNull();
        expect(sessionDistinctTitle({ ...titled, batch_name: null })).toBeNull();
        // Free text with no inventory bean is already the bean column — never repeat it as a title.
        expect(sessionDistinctTitle({ batch_name: null, bean_label: 'Legacy title', beans: null })).toBeNull();
        expect(sessionDistinctTitle({ batch_name: null, bean_label: 'Ethiopia', beans: null })).toBeNull();
        expect(sessionDistinctTitle({ batch_name: null, bean_label: 'Ethiopia', beans: { name: 'Green B' } })).toBe(
            'Ethiopia',
        );
    });
});
