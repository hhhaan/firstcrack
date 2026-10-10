import { describe, expect, it } from 'vitest';
import { canConnectRoaster, roasterRequiresEnterprise } from './roasterAccess';

const FACTORY_KEYS = ['giesen_w45a_w60a', 'giesen_w140a_v1', 'giesen_w140a_v2', 'buhler_rm60_240'] as const;

describe('canConnectRoaster', () => {
    it.each(FACTORY_KEYS)('limits %s to the enterprise account plan', (key) => {
        expect(roasterRequiresEnterprise(key)).toBe(true);
        expect(canConnectRoaster(key, 'enterprise')).toBe(true);
        expect(canConnectRoaster(key, 'tester')).toBe(true);
        expect(canConnectRoaster(key, 'team')).toBe(false);
        expect(canConnectRoaster(key, 'pro_plus')).toBe(false);
        expect(canConnectRoaster(key, '')).toBe(false);
    });

    it('leaves shop and mixed-size profiles open', () => {
        expect(roasterRequiresEnterprise('giesen_standard')).toBe(false);
        expect(canConnectRoaster('giesen_standard', 'trial')).toBe(true);
        expect(canConnectRoaster('giesen_w30a', 'pro')).toBe(true);
        expect(canConnectRoaster('buhler_rm20_simatic', 'pro')).toBe(true);
        expect(canConnectRoaster('loring_smart_roast', 'pro')).toBe(true);
        expect(canConnectRoaster('probat_gug_s7', 'pro')).toBe(true);
    });
});
