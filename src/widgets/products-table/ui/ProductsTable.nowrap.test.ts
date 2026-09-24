import { describe, expect, it } from 'vitest';
import src from './ProductsTable.tsx?raw';

describe('ProductsTable row action pills (#516)', () => {
    it('ghost pills keep icon + CJK labels on one line', () => {
        const ghostBtn = src.match(/const ghostBtn =\s*'([^']+)'/)?.[1];
        expect(ghostBtn).toContain('whitespace-nowrap');
        expect(ghostBtn).toContain('shrink-0');
    });
});
