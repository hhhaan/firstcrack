import { describe, expect, it } from 'vitest';
import { canConnectRoaster, roasterRequiresEnterprise } from './roasterAccess';

describe('canConnectRoaster', () => {
    it('limits Giesen W45A / W60A to the enterprise account plan', () => {
        expect(roasterRequiresEnterprise('giesen_w45a_w60a')).toBe(true);
        expect(canConnectRoaster('giesen_w45a_w60a', 'enterprise')).toBe(true);
        expect(canConnectRoaster('giesen_w45a_w60a', 'tester')).toBe(true);
        expect(canConnectRoaster('giesen_w45a_w60a', 'team')).toBe(false);
        expect(canConnectRoaster('giesen_w45a_w60a', 'pro_plus')).toBe(false);
        expect(canConnectRoaster('giesen_w45a_w60a', '')).toBe(false);
    });

    it('leaves other roasters open', () => {
        expect(roasterRequiresEnterprise('giesen_standard')).toBe(false);
        expect(canConnectRoaster('giesen_standard', 'trial')).toBe(true);
        expect(canConnectRoaster('giesen_w30a', 'tester')).toBe(true);
    });
});
