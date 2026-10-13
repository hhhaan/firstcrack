import { afterEach, describe, expect, it, vi } from 'vitest';
import { devRoasterControl } from './devRoasterPreview';

describe('devRoasterControl', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('shows W60 channels, doors, and PID', () => {
        vi.stubEnv('VITE_DEV_ROASTER', 'giesen_w45a_w60a');
        expect(devRoasterControl()).toEqual({
            writable: true,
            limits: {
                heater: { min: 0, max: 100, unit: '%' },
                fan: { min: 0, max: 100, unit: '%' },
                drum: { min: 0, max: 100, unit: '%' },
            },
            pid: { supported: true, sv_min: 50, sv_max: 250 },
        });
    });

    it('keeps a coarse Giesen on heater and drum', () => {
        vi.stubEnv('VITE_DEV_ROASTER', 'giesen_wxa_coarse');
        const control = devRoasterControl();
        expect(control?.limits.heater).toEqual({ min: 0, max: 100, unit: '%' });
        expect(control?.limits.drum).toEqual({ min: 0, max: 100, unit: '%' });
        expect(control?.limits.fan).toBeUndefined();
    });

    it('ignores a read-only protocol and an unknown key', () => {
        vi.stubEnv('VITE_DEV_ROASTER', 'custom_kaleido');
        expect(devRoasterControl()).toBeNull();
        vi.stubEnv('VITE_DEV_ROASTER', 'not-a-roaster');
        expect(devRoasterControl()).toBeNull();
        vi.stubEnv('VITE_DEV_ROASTER', 'buhler_rm60_240');
        expect(devRoasterControl()).toBeNull();
    });
});
