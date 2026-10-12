import { describe, expect, it } from 'vitest';
import { createLeadingGate } from './leading-gate';

describe('createLeadingGate', () => {
    it('drops repeats inside the interval and allows the next one after it', () => {
        let at = 0;
        const gate = createLeadingGate(3000, () => at);
        expect(gate()).toBe(true);
        at = 2999;
        expect(gate()).toBe(false);
        at = 3000;
        expect(gate()).toBe(true);
    });
});
