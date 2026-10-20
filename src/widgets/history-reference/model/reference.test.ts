import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { expect, it } from 'vitest';
import { historyReferenceTitle, toHistoryReference } from './reference';

it('distinguishes same-day batches of the same bean and keeps the chosen reference title', () => {
    const session = {
        id: 'a',
        user_id: 'owner',
        tsv_path: 'curve.tsv',
        batch_name: 'Batch A',
        bean_label: 'Legacy label',
        beans: { name: 'Green B' },
        roasted_at: '2026-10-19T00:00:00Z',
    } as unknown as RoastSessionWithRelations;
    const next = { ...session, id: 'b', batch_name: 'Batch B' };
    expect(historyReferenceTitle(session)).toContain('Batch A');
    expect(historyReferenceTitle(next)).toContain('Batch B');
    expect(historyReferenceTitle(session)).not.toBe(historyReferenceTitle(next));
    expect(toHistoryReference(next, 'owner')).toMatchObject({ id: 'b', name: historyReferenceTitle(next) });
    expect(historyReferenceTitle({ ...session, batch_name: '  ' })).toContain('Legacy label');
    expect(historyReferenceTitle({ ...session, batch_name: null, bean_label: null })).toContain('Green B');
});
