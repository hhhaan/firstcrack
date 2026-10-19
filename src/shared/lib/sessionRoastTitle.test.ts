import { expect, it } from 'vitest';
import { sessionRoastTitle } from './sessionRoastTitle';

it('keeps batch titles separate from linked beans with a consistent legacy fallback', () => {
    const session = { batch_name: '  Batch C ', bean_label: 'Legacy title', beans: { name: 'Green B' } };
    expect(sessionRoastTitle(session)).toBe('Batch C');
    expect(sessionRoastTitle({ ...session, batch_name: '  ' })).toBe('Legacy title');
    expect(sessionRoastTitle({ ...session, batch_name: null, bean_label: null })).toBe('Green B');
    expect(sessionRoastTitle({ batch_name: null, bean_label: null, beans: null })).toBeNull();
    expect(session.beans.name).toBe('Green B');
});
