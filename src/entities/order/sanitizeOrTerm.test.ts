import { describe, expect, it } from 'vitest';
import { sanitizeOrTerm } from './api';

/** The search term is interpolated into a PostgREST `.or()` string — grammar chars must not leak. */
describe('sanitizeOrTerm', () => {
    it('strips the characters that would break out of the or() filter', () => {
        expect(sanitizeOrTerm('a,b')).toBe('a b');
        expect(sanitizeOrTerm('x),status.eq.(paid')).toBe('x status eq paid');
        expect(sanitizeOrTerm('a.b:c"d\'e\\f*g')).toBe('a b c d e f g');
        expect(sanitizeOrTerm('  kim  ')).toBe('kim');
    });

    it('keeps ilike wildcards and ordinary text intact', () => {
        expect(sanitizeOrTerm('김%')).toBe('김%');
        expect(sanitizeOrTerm('ORD-1024')).toBe('ORD-1024');
    });
});
