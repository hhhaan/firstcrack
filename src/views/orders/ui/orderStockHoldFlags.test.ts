import { describe, expect, it } from 'vitest';

/** Mirrors OrdersTab retry visibility without mounting the table. */
const canRetryHold = (input: { hold: boolean; fulfilled: boolean; cancelled: boolean; status: string }) =>
    input.hold && !input.fulfilled && !input.cancelled && (input.status === 'shipped' || input.status === 'delivered');

describe('order stock hold retry flag', () => {
    it('shows retry for shipped channel orders with an open hold', () => {
        expect(canRetryHold({ hold: true, fulfilled: false, cancelled: false, status: 'shipped' })).toBe(true);
    });

    it('hides retry once fulfilled or cancelled', () => {
        expect(canRetryHold({ hold: true, fulfilled: true, cancelled: false, status: 'shipped' })).toBe(false);
        expect(canRetryHold({ hold: true, fulfilled: false, cancelled: true, status: 'shipped' })).toBe(false);
    });
});
