import { describe, expect, it } from 'vitest';
import { type RoastProfileWithSource, roastProfileCopyInsert } from './api';

describe('roastProfileCopyInsert', () => {
    it('copies the roast plan without reusing identity or joined data', () => {
        const profile = {
            id: 'original',
            created_at: '2026-09-21',
            updated_at: '2026-09-21',
            user_id: 'workspace',
            name: 'Original',
            source_session_id: 'session',
            target_level: 'Medium',
            heater_events: [{ time: 15, value: 65 }],
            machine_id: 'machine',
            default_bean_id: 'bean',
            source_session: { tsv_path: 'session.tsv', events: null },
            default_bean: { id: 'bean', name: 'Bean' },
            default_blend: null,
        } as RoastProfileWithSource;

        expect(roastProfileCopyInsert(profile, 'Original (Copy)')).toEqual({
            user_id: 'workspace',
            name: 'Original (Copy)',
            source_session_id: 'session',
            target_level: 'Medium',
            heater_events: [{ time: 15, value: 65 }],
            machine_id: 'machine',
            default_bean_id: 'bean',
        });
    });
});
