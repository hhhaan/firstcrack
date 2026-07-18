import { describe, expect, it } from 'vitest';
import { generateCuppingToken, generateToken } from './token';

describe('generateToken', () => {
    it('returns base64url chars only', () => {
        const t = generateToken();
        expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(t.length).toBeGreaterThanOrEqual(20);
        expect(t.length).toBeLessThanOrEqual(24);
    });

    it('generateCuppingToken is an alias', () => {
        expect(typeof generateCuppingToken()).toBe('string');
    });
});
