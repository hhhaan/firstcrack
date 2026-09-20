import { describe, expect, it } from 'vitest';
import { normalizeDisplayName } from './lib';

describe('normalizeDisplayName', () => {
    it('rejects empty and whitespace-only names', () => {
        for (const raw of ['', ' ', '   ', '\t', '\n', ' \t\n ']) {
            expect(normalizeDisplayName(raw)).toBeNull();
        }
    });

    it('trims surrounding whitespace and keeps a real name', () => {
        expect(normalizeDisplayName('한승헌')).toBe('한승헌');
        expect(normalizeDisplayName('  Ada Lovelace  ')).toBe('Ada Lovelace');
    });
});
