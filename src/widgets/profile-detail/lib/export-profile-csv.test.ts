import { describe, expect, it } from 'vitest';
import { profileExportBasename, profileToCsv } from './export-profile-csv';

const profile = {
    name: 'Colombia, Pink Bourbon',
    description: 'line1\nline2',
    target_level: 'City',
    charge_temp_celsius: 180,
    drop_temp_celsius: 205,
    duration_sec: 720,
    dev_time_sec: 90,
    dev_pct: 12.5,
    default_bean: { id: 'b1', name: 'Santander' },
    default_blend: null,
};

describe('profileToCsv', () => {
    it('includes BOM, meta row, and curve points', () => {
        const csv = profileToCsv(
            profile,
            [
                { t: 0, bt: 180 },
                { t: 60, bt: 190.5 },
            ],
            'session',
        );
        expect(csv.startsWith('\uFEFF')).toBe(true);
        expect(csv).toContain('name,description,target_level');
        expect(csv).toContain('"Colombia, Pink Bourbon"');
        expect(csv).toContain('session');
        expect(csv).toContain('time_s,bt_c');
        expect(csv).toContain('0,180');
        expect(csv).toContain('60,190.5');
        expect(csv).toContain('Santander');
    });
});

describe('profileExportBasename', () => {
    it('sanitizes name and appends date', () => {
        const base = profileExportBasename('Colombia · Pink / Bourbon', new Date('2026-07-23T00:00:00Z'));
        expect(base).toBe('Colombia-Pink-Bourbon-2026-07-23');
    });
});
