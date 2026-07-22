import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldAutoFulfillOnDispatch } from './auto-fulfill.ts';

describe('shouldAutoFulfillOnDispatch (C3)', () => {
    it('true only when not yet fulfilled and channel flag on', () => {
        expect(
            shouldAutoFulfillOnDispatch({ fulfilledAt: null, autoFulfillOnShipped: true }),
        ).toBe(true);
        expect(
            shouldAutoFulfillOnDispatch({ fulfilledAt: '2026-01-01', autoFulfillOnShipped: true }),
        ).toBe(false);
        expect(
            shouldAutoFulfillOnDispatch({ fulfilledAt: null, autoFulfillOnShipped: false }),
        ).toBe(false);
        expect(
            shouldAutoFulfillOnDispatch({ fulfilledAt: null, autoFulfillOnShipped: null }),
        ).toBe(false);
    });
});

describe('order-dispatch wires C3 fulfill_order', () => {
    it('calls shouldAutoFulfillOnDispatch and fulfill_order', () => {
        const dir = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(join(dir, '../../order-dispatch/index.ts'), 'utf8');
        expect(src).toContain('shouldAutoFulfillOnDispatch');
        expect(src).toContain("rpc('fulfill_order'");
    });
});
