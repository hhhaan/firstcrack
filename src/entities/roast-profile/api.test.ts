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
            description: null,
            source_session_id: 'session',
            target_level: 'Medium',
            charge_temp_celsius: 210,
            drop_temp_celsius: 208,
            duration_sec: 1003,
            dev_time_sec: null,
            dev_pct: null,
            heater_events: [{ time: 15, value: 65 }],
            machine_id: 'machine',
            machine_name: 'Virtual Machine',
            machine_brand: null,
            machine_protocol: null,
            machine_roaster_key: null,
            default_bean_id: 'bean',
            default_blend_id: null,
            source_session: {
                tsv_path: 'session.tsv',
                events: null,
                machine_id: 'machine',
                machine_name: 'Virtual Machine',
                machine_roaster_key: null,
                machine_protocol: null,
            },
            default_bean: { id: 'bean', name: 'Bean' },
            default_blend: null,
        } satisfies RoastProfileWithSource;

        expect(roastProfileCopyInsert(profile, 'Original (Copy)')).toEqual({
            user_id: 'workspace',
            name: 'Original (Copy)',
            description: null,
            source_session_id: 'session',
            target_level: 'Medium',
            charge_temp_celsius: 210,
            drop_temp_celsius: 208,
            duration_sec: 1003,
            dev_time_sec: null,
            dev_pct: null,
            heater_events: [{ time: 15, value: 65 }],
            machine_id: 'machine',
            machine_name: 'Virtual Machine',
            machine_brand: null,
            machine_protocol: null,
            machine_roaster_key: null,
            default_bean_id: 'bean',
            default_blend_id: null,
        });
    });
});
